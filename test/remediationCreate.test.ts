import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeStore } from './helpers/fakeKvs';
import { InMemoryStorage } from '../shared/agents/storage';
import type { CreateRemediationWorkItemRequest, PrepareRemediationRequest } from '../shared/api';
import {
  approveRequest,
  REMEDIATION_LABEL,
  resolveFollowUpRequests,
  type JiraWriteCall,
} from '../shared/remediation';
import { ruleEngine } from '../src/analysis/ruleEngine';
import type { ConfluenceGateway, ConfluenceResponse } from '../src/confluence/client';
import type { JiraResponse } from '../src/jira/client';
import {
  createRemediationWorkItem,
  LOCK_EXPIRY_MS,
  MAX_AUDIT_ENTRIES,
  handleCreateRemediationWorkItem,
  remediationRecordKey,
  WRITE_NOT_PERMITTED_MESSAGE,
  writeErrorFromStatus,
  type CreateRemediationDeps,
  type JiraWriteGateway,
  type RemediationItemRecord,
} from '../src/remediation/create';
import {
  productionRemediationStorage,
  productionRemediationWriter,
  remediationCreateWiring,
} from '../src/remediation/gateways';
import { createJiraWriteGateway, type WriteTransportInit } from '../src/remediation/writeGateway';
import { prepareRemediationRequest, type RemediationJiraGateway } from '../src/remediation/prepare';
import { RB_AUTH_STEPS } from './fixtures/analysis/cases';

/**
 * M8 creation adapter against a fake write gateway that records every call.
 * No real Jira is involved; production wiring is asserted to have no writer.
 */

const SITE = 'https://example.atlassian.net';
const ME = '557058:aaaa-bbbb';
const SOMEONE_ELSE = '557058:cccc-dddd';
const AT = '2026-11-10T09:30:00.000Z';
const RB_TITLE = '[DEMO] RB-AUTH-01 Customer sign-in recovery';
const WEBUI = '/spaces/SFDEMO/pages/98305/DEMO+RB-AUTH-01';
const CHANGE =
  'Synthetic change for ScenarioForge testing.\n\nWe will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';

const INPUT: PrepareRemediationRequest = {
  changeKey: 'MC-62',
  findingId: 'MC-62:98305:3:legacyauth',
  fixId: 'rem-step',
  projectKey: 'OPS',
  issueTypeName: 'Task',
};

function respond(status: number, body: unknown = {}): JiraResponse & ConfluenceResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

interface Existing {
  key: string;
  labels: string[];
}

/** A fake site: reads are GETs; `existing` is what the label search returns. */
function site() {
  const state = { steps: [...RB_AUTH_STEPS], existing: [] as Existing[], searches: 0 };
  const jira: RemediationJiraGateway = {
    serverInfo: async () => respond(200, { baseUrl: SITE }),
    searchIssues: async () => {
      state.searches += 1;
      return respond(200, {
        issues: state.existing.map((e) => ({
          key: e.key,
          fields: { summary: 's', labels: e.labels },
        })),
        isLast: true,
      });
    },
    getIssue: async (key) =>
      respond(200, {
        key,
        fields: {
          summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
          description: {
            version: 1,
            type: 'doc',
            content: CHANGE.split('\n\n').map((p) => ({
              type: 'paragraph',
              content: [{ type: 'text', text: p }],
            })),
          },
          status: { name: 'To Do' },
          issuetype: { name: 'Change' },
          updated: '2026-11-09T10:00:00.000+0000',
        },
      }),
    getRemoteLinks: async () => respond(200, []),
  };
  const confluence: ConfluenceGateway = {
    searchContent: async () =>
      respond(200, { results: [{ content: { id: '98305', type: 'page', title: RB_TITLE } }] }),
    getPage: async (id) =>
      respond(200, {
        id,
        title: RB_TITLE,
        _links: { webui: WEBUI },
        body: {
          storage: {
            value: `<p>Related change: MC-62</p><ol>${state.steps.map((s) => `<li>${s.replace(/&/g, '&amp;')}</li>`).join('')}</ol>`,
          },
        },
      }),
  };
  return { state, jira, confluence };
}

type Script = (call: JiraWriteCall<unknown>) => Promise<JiraResponse>;

/** Records every write; `script` decides each answer. */
function fakeWriter(script: Script) {
  const sent: JiraWriteCall<unknown>[] = [];
  const writer: JiraWriteGateway = {
    send: async (call) => {
      sent.push(structuredClone(call));
      return script(call);
    },
  };
  return { sent, writer };
}

const created =
  (key = 'OPS-7'): Script =>
  async () =>
    respond(201, { id: '10007', key, self: `${SITE}/rest/api/3/issue/10007` });

async function setup(
  script: Script = async (call) =>
    call.path === '/rest/api/3/issue' ? created()(call) : respond(201),
) {
  const s = site();
  const { sent, writer } = fakeWriter(script);
  const storage = new InMemoryStorage();
  const deps: CreateRemediationDeps = {
    jira: s.jira,
    confluence: s.confluence,
    engine: ruleEngine,
    writer,
    storage,
    now: () => new Date(AT),
  };
  const prepared = await prepareRemediationRequest(deps, INPUT);
  if (!prepared.ok) throw new Error(prepared.error.message);
  const p = prepared.data;
  const approval = approveRequest(p.draft, { siteUrl: SITE }, ME, AT);
  const request: CreateRemediationWorkItemRequest = {
    ...INPUT,
    requestHash: p.requestHash,
    approval,
  };
  const label = p.draft.labels[1]!;
  const record = async () =>
    (await storage.get<RemediationItemRecord>(remediationRecordKey(label)))?.value;
  return { s, sent, writer, storage, deps, prepared: p, request, label, record };
}

const creates = (sent: JiraWriteCall<unknown>[]) =>
  sent.filter((c) => c.path === '/rest/api/3/issue');

describe('production wiring', () => {
  it('has no write gateway and no store, so the create path is disabled', () => {
    expect(productionRemediationWriter()).toBeNull();
    expect(productionRemediationStorage()).toBeNull();
  });

  it('answers WRITE_NOT_PERMITTED before reading anything when there is no writer', async () => {
    let reads = 0;
    const count = async () => {
      reads += 1;
      return respond(200);
    };
    const result = await handleCreateRemediationWorkItem(
      {
        jira: { serverInfo: count, searchIssues: count, getIssue: count, getRemoteLinks: count },
        confluence: { searchContent: count, getPage: count },
        engine: ruleEngine,
        writer: productionRemediationWriter(),
        storage: productionRemediationStorage(),
      },
      { anything: true },
      ME,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'WRITE_NOT_PERMITTED', message: WRITE_NOT_PERMITTED_MESSAGE },
    });
    expect(reads).toBe(0);
  });

  it('refuses without a store even when a writer exists', async () => {
    const t = await setup();
    const result = await createRemediationWorkItem({ ...t.deps, storage: null }, t.request, ME);
    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(t.sent).toEqual([]);
  });
});

describe('createRemediationWorkItem', () => {
  it('creates, links and remote-links with exactly the approved bodies', async () => {
    const t = await setup();
    t.s.state.searches = 0;
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toEqual({
      ok: true,
      data: {
        outcome: 'created',
        issueKey: 'OPS-7',
        issueUrl: `${SITE}/browse/OPS-7`,
        adopted: false,
        issueLink: { status: 'added' },
        remoteLink: { status: 'added' },
        idempotencyLabel: t.label,
        message: 'OPS-7 was created.',
      },
    });
    const follow = resolveFollowUpRequests(t.prepared.request, 'OPS-7');
    if (!follow.ok) throw new Error(follow.message);
    // Exact bodies, in order: the fingerprinted request with only the key filled in.
    expect(t.sent).toEqual([t.prepared.request.createIssue, follow.issueLink, follow.remoteLink]);
    expect(t.sent[0]!.body).toMatchObject({
      fields: { labels: [REMEDIATION_LABEL, t.label] },
    });
    // Duplicate searched by prepare and again right before the create.
    expect(t.s.state.searches).toBe(2);
    const record = await t.record();
    expect(record?.state).toMatchObject({ status: 'created', issueKey: 'OPS-7', adopted: false });
    expect(record?.audit.map((a) => `${a.step}:${a.outcome}`)).toEqual([
      'approval-check:valid',
      'lock:creating',
      'duplicate-check:none',
      'create-issue:created',
      'issue-link:added',
      'remote-link:added',
    ]);
    expect(record?.audit[0]?.actorAccountId).toBe(ME);
  });

  it('keeps the actor account id in storage only, never in a browser response', async () => {
    const t = await setup();
    const first = await createRemediationWorkItem(t.deps, t.request, ME);
    const again = await createRemediationWorkItem(t.deps, t.request, ME);
    const wrong = await createRemediationWorkItem(t.deps, t.request, '557058:someone-else');
    expect((await t.record())?.audit[0]?.actorAccountId).toBe(ME);
    for (const response of [first, again, wrong]) {
      const text = JSON.stringify(response);
      expect(text).not.toContain(ME);
      expect(text).not.toContain('someone-else');
      expect(text).not.toContain('actorAccountId');
      expect(text).not.toContain('audit');
    }
  });

  it('never creates twice: a second call returns the stored work item', async () => {
    const t = await setup();
    await createRemediationWorkItem(t.deps, t.request, ME);
    const again = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(again).toMatchObject({ ok: true, data: { outcome: 'created', issueKey: 'OPS-7' } });
    expect(creates(t.sent)).toHaveLength(1);
  });

  it('two concurrent calls create once (conditional write)', async () => {
    const t = await setup();
    const [a, b] = await Promise.all([
      createRemediationWorkItem(t.deps, t.request, ME),
      createRemediationWorkItem(t.deps, t.request, ME),
    ]);
    expect(creates(t.sent)).toHaveLength(1);
    const codes = [a, b].map((r) => (r.ok ? r.data.outcome : r.error.code)).sort();
    expect(codes).toEqual(['CONFLICT', 'created']);
  });

  it('refuses an approval older than 24 hours', async () => {
    const t = await setup();
    const old = new Date(Date.parse(AT) - 24 * 3600_000 - 1).toISOString();
    const result = await createRemediationWorkItem(
      t.deps,
      { ...t.request, approval: { ...t.request.approval, approvedAt: old } },
      ME,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'APPROVAL_INVALID' } });
    if (!result.ok) expect(result.error.message).toMatch(/older than 24 hours/);
    expect(t.sent).toEqual([]);
  });

  it('refuses a stale approval when the runbook step changed since', async () => {
    const t = await setup();
    t.s.state.steps[2] = `${t.s.state.steps[2]} (edited)`;
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toMatchObject({ ok: false, error: { code: 'APPROVAL_INVALID' } });
    if (!result.ok) expect(result.error.message).toMatch(/stale/);
    expect(t.sent).toEqual([]);
  });

  it('refuses a draft-only approval and an unseen request hash', async () => {
    const t = await setup();
    const draftOnly = { ...t.request.approval };
    delete draftOnly.requestHash;
    expect(
      await createRemediationWorkItem(t.deps, { ...t.request, approval: draftOnly }, ME),
    ).toMatchObject({ ok: false, error: { code: 'APPROVAL_INVALID' } });
    expect(
      await createRemediationWorkItem(t.deps, { ...t.request, requestHash: '0'.repeat(64) }, ME),
    ).toMatchObject({ ok: false, error: { code: 'APPROVAL_INVALID' } });
    expect(t.sent).toEqual([]);
  });

  it('refuses when the caller is not the approver', async () => {
    const t = await setup();
    const result = await createRemediationWorkItem(t.deps, t.request, SOMEONE_ELSE);
    expect(result).toMatchObject({ ok: false, error: { code: 'APPROVAL_INVALID' } });
    if (!result.ok) expect(result.error.message).toMatch(/Only the person who approved/);
    expect(t.sent).toEqual([]);
  });

  it('adopts an existing work item with the label instead of creating', async () => {
    const t = await setup();
    t.s.state.existing = [{ key: 'OPS-3', labels: [REMEDIATION_LABEL, t.label] }];
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toMatchObject({
      ok: true,
      data: { outcome: 'created', issueKey: 'OPS-3', adopted: true },
    });
    expect(t.sent).toEqual([]);
  });

  it('refuses an ambiguous duplicate check', async () => {
    const t = await setup();
    t.s.state.existing = [
      { key: 'OPS-3', labels: [REMEDIATION_LABEL, t.label] },
      { key: 'OPS-4', labels: [REMEDIATION_LABEL, t.label] },
    ];
    expect(await createRemediationWorkItem(t.deps, t.request, ME)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(t.sent).toEqual([]);
  });

  it('adopts by label after a timeout, and checking again never re-sends the create', async () => {
    const ctx: { world?: ReturnType<typeof site>['state']; label: string } = { label: '' };
    const t = await setup(async (call) => {
      if (call.path === '/rest/api/3/issue') {
        // The create lands in Jira, but the answer never arrives.
        ctx.world!.existing = [{ key: 'OPS-9', labels: [REMEDIATION_LABEL, ctx.label] }];
        throw new Error('timeout');
      }
      return respond(201);
    });
    ctx.world = t.s.state;
    ctx.label = t.label;
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toMatchObject({
      ok: true,
      data: { outcome: 'created', issueKey: 'OPS-9', adopted: true },
    });
    expect(creates(t.sent)).toHaveLength(1);
    // Links still go to the adopted work item.
    expect(t.sent.map((c) => c.path)).toEqual([
      '/rest/api/3/issue',
      '/rest/api/3/issueLink',
      '/rest/api/3/issue/OPS-9/remotelink',
    ]);
    const steps = (await t.record())?.audit.map((a) => `${a.step}:${a.outcome}`);
    expect(steps).toContain('create-issue:unknown');
    expect(steps).toContain('adopt:adopted');
  });

  it('stays unknown while the label search finds nothing, without a second create', async () => {
    const t = await setup(async () => {
      throw new Error('timeout');
    });
    const first = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(first).toMatchObject({ ok: true, data: { outcome: 'unknown' } });
    const second = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(second).toMatchObject({ ok: true, data: { outcome: 'unknown' } });
    expect(creates(t.sent)).toHaveLength(1);
    // Later the item shows up in search: adopted.
    t.s.state.existing = [{ key: 'OPS-11', labels: [REMEDIATION_LABEL, t.label] }];
    const third = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(third).toMatchObject({ ok: true, data: { issueKey: 'OPS-11', adopted: true } });
    expect(creates(t.sent)).toHaveLength(1);
  });

  it('treats a 5xx on create as unknown, not as a failure to retry', async () => {
    const t = await setup(async () => respond(503));
    expect(await createRemediationWorkItem(t.deps, t.request, ME)).toMatchObject({
      ok: true,
      data: { outcome: 'unknown' },
    });
    await createRemediationWorkItem(t.deps, t.request, ME);
    expect(creates(t.sent)).toHaveLength(1);
  });

  it('records created with follow-up when the issue link fails, and never re-creates', async () => {
    const t = await setup(async (call) => {
      if (call.path === '/rest/api/3/issue') return created('OPS-8')(call);
      if (call.path === '/rest/api/3/issueLink') return respond(403);
      return respond(201);
    });
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toMatchObject({
      ok: true,
      data: {
        outcome: 'created-with-follow-up',
        issueKey: 'OPS-8',
        issueLink: { status: 'failed', upstreamStatus: 403 },
        remoteLink: { status: 'added' },
      },
    });
    const again = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(again).toMatchObject({ ok: true, data: { outcome: 'created-with-follow-up' } });
    expect(creates(t.sent)).toHaveLength(1);
  });

  it('maps a 403 on create to a permission-safe failure and records it', async () => {
    const t = await setup(async () => respond(403, { errorMessages: ['secret detail'] }));
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to create the work item in this project.',
        upstreamStatus: 403,
      },
    });
    expect((await t.record())?.state.status).toBe('failed');
    expect(creates(t.sent)).toHaveLength(1);
  });

  it('maps every write status without echoing Jira text', () => {
    expect(
      [400, 401, 403, 404, 429, 500, 502].map((s) => writeErrorFromStatus(s, 'create-issue').code),
    ).toEqual([
      'INVALID_REQUEST',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'RATE_LIMITED',
      'UPSTREAM_ERROR',
      'UPSTREAM_ERROR',
    ]);
    expect(writeErrorFromStatus(404, 'create-issue').message).toBe(
      'The project or work item was not found, or you cannot see it.',
    );
  });
});

// ---------------------------------------------------------------------------
// M8 write gateway (code only; no real Jira, no write scope in the manifest).
// ---------------------------------------------------------------------------

type Transport = (path: string, init: WriteTransportInit) => Promise<JiraResponse>;

/** Wires a gateway over a fake transport into a prepared setup. */
async function gatewaySetup(transport: Transport, timeoutMs?: number) {
  const t = await setup();
  const calls: { path: string; init: WriteTransportInit }[] = [];
  const writer = createJiraWriteGateway({
    transport: async (path, init) => {
      calls.push({ path, init });
      return transport(path, init);
    },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  return { ...t, calls, deps: { ...t.deps, writer } };
}

const okTransport: Transport = async (path) =>
  path === '/rest/api/3/issue' ? respond(201, { id: '1', key: 'OPS-7' }) : respond(201);

describe('write gateway over a fake Jira', () => {
  it('sends exactly the three approved bodies as POST JSON', async () => {
    const t = await gatewaySetup(okTransport);
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toMatchObject({ ok: true, data: { outcome: 'created', issueKey: 'OPS-7' } });
    const follow = resolveFollowUpRequests(t.prepared.request, 'OPS-7');
    if (!follow.ok) throw new Error('follow-up');
    expect(t.calls.map((c) => c.path)).toEqual([
      '/rest/api/3/issue',
      '/rest/api/3/issueLink',
      '/rest/api/3/issue/OPS-7/remotelink',
    ]);
    expect(t.calls.map((c) => JSON.parse(c.init.body))).toEqual([
      t.prepared.request.createIssue.body,
      follow.issueLink.body,
      follow.remoteLink!.body,
    ]);
    for (const c of t.calls) {
      expect(c.init.method).toBe('POST');
      expect(c.init.headers['Content-Type']).toBe('application/json');
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('refuses any call outside the three permitted ones before a request', async () => {
    const calls: string[] = [];
    const gw = createJiraWriteGateway({
      transport: async (p) => (calls.push(p), respond(200)),
    });
    const bad = [
      { method: 'PUT', path: '/rest/api/3/issue/OPS-1', body: {} },
      { method: 'DELETE', path: '/rest/api/3/issue/OPS-1', body: {} },
      { method: 'POST', path: '/rest/api/3/issue/OPS-1/comment', body: {} },
      { method: 'POST', path: '/rest/api/3/issue/ops-1/remotelink', body: {} },
      { method: 'POST', path: '/rest/api/3/issue/../x/remotelink', body: {} },
    ];
    for (const call of bad) {
      await expect(gw.send(call as unknown as JiraWriteCall<unknown>)).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });

  it.each([
    [400, 'INVALID_REQUEST'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
  ])('maps a %i on create and records a failed state', async (status, code) => {
    const t = await gatewaySetup(async () => respond(status, { errorMessages: ['secret'] }));
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toMatchObject({ ok: false, error: { code, upstreamStatus: status } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect((await t.record())?.state.status).toBe('failed');
    expect(t.calls).toHaveLength(1);
  });

  it('treats a 5xx on create as unknown and never sends a second create', async () => {
    const t = await gatewaySetup(async () => respond(503));
    const first = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(first).toMatchObject({ ok: true, data: { outcome: 'unknown' } });
    await createRemediationWorkItem(t.deps, t.request, ME);
    expect(t.calls.filter((c) => c.path === '/rest/api/3/issue')).toHaveLength(1);
  });

  it('times out with an abort signal and records unknown', async () => {
    const t = await gatewaySetup(
      (_p, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      20,
    );
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toMatchObject({ ok: true, data: { outcome: 'unknown' } });
    expect(t.calls[0]!.init.signal.aborted).toBe(true);
    expect((await t.record())?.state.status).toBe('unknown');
  });

  it('treats a malformed or unexpected create answer as unknown', async () => {
    for (const bad of [
      async () => ({ ok: true, status: 201, json: async () => ({ key: 'not a key' }) }),
      async () => ({
        ok: true,
        status: 201,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      }),
      async () => respond(200, { key: 'OPS-7' }),
      async () => respond(204),
    ] as Transport[]) {
      const t = await gatewaySetup(bad);
      const result = await createRemediationWorkItem(t.deps, t.request, ME);
      expect(result).toMatchObject({ ok: true, data: { outcome: 'unknown' } });
      expect(t.calls).toHaveLength(1);
    }
  });

  it('records created-with-follow-up when links fail, then never creates again', async () => {
    const t = await gatewaySetup(async (path) =>
      path === '/rest/api/3/issue'
        ? respond(201, { key: 'OPS-7' })
        : path === '/rest/api/3/issueLink'
          ? respond(403)
          : respond(202),
    );
    const first = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(first).toMatchObject({
      ok: true,
      data: {
        outcome: 'created-with-follow-up',
        issueKey: 'OPS-7',
        issueLink: { status: 'failed', upstreamStatus: 403 },
        remoteLink: { status: 'failed', upstreamStatus: 502 },
      },
    });
    const again = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(again).toMatchObject({ ok: true, data: { issueKey: 'OPS-7' } });
    expect(t.calls.filter((c) => c.path === '/rest/api/3/issue')).toHaveLength(1);
    expect(t.calls).toHaveLength(3);
  });

  it('a link that errors is a recorded failure, not a second issue', async () => {
    const t = await gatewaySetup(async (path) => {
      if (path === '/rest/api/3/issue') return respond(201, { key: 'OPS-7' });
      throw new Error('network');
    });
    const result = await createRemediationWorkItem(t.deps, t.request, ME);
    expect(result).toMatchObject({ ok: true, data: { outcome: 'created-with-follow-up' } });
  });

  it('audit steps hold ids only, no draft text', async () => {
    const t = await gatewaySetup(okTransport);
    await createRemediationWorkItem(t.deps, t.request, ME);
    const record = (await t.record())!;
    const audit = JSON.stringify(record.audit);
    expect(audit).not.toContain(t.prepared.draft.summary);
    expect(audit).not.toContain('LegacyAuth');
    for (const e of record.audit) {
      expect(Object.keys(e).every((k) => k !== 'summary' && k !== 'description')).toBe(true);
    }
  });
});

describe('lock expiry and recovery', () => {
  async function stuck() {
    const t = await setup(async () => {
      throw new Error('crash');
    });
    await createRemediationWorkItem(t.deps, t.request, ME);
    return t;
  }

  it('keeps a fresh lock checking without a second create', async () => {
    const t = await stuck();
    const later = { ...t.deps, now: () => new Date(Date.parse(AT) + LOCK_EXPIRY_MS - 1000) };
    const r = await createRemediationWorkItem(later, t.request, ME);
    expect(r).toMatchObject({ ok: true, data: { outcome: 'unknown' } });
    expect(creates(t.sent)).toHaveLength(1);
  });

  it('releases an expired lock when no labelled item exists, then a retry creates once', async () => {
    const t = await stuck();
    const later = { ...t.deps, now: () => new Date(Date.parse(AT) + LOCK_EXPIRY_MS + 1000) };
    const released = await createRemediationWorkItem(later, t.request, ME);
    expect(released).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect((await t.record())?.state.status).toBe('failed');
    const { writer, sent } = fakeWriter(async (call) =>
      call.path === '/rest/api/3/issue' ? created('OPS-9')(call) : respond(201),
    );
    const retry = await createRemediationWorkItem({ ...later, writer }, t.request, ME);
    expect(retry).toMatchObject({ ok: true, data: { outcome: 'created', issueKey: 'OPS-9' } });
    expect(creates(sent)).toHaveLength(1);
  });

  it('adopts instead of releasing when the labelled item exists', async () => {
    const t = await stuck();
    t.s.state.existing = [{ key: 'OPS-12', labels: [REMEDIATION_LABEL, t.label] }];
    const later = { ...t.deps, now: () => new Date(Date.parse(AT) + LOCK_EXPIRY_MS + 1000) };
    const r = await createRemediationWorkItem(later, t.request, ME);
    expect(r).toMatchObject({ ok: true, data: { issueKey: 'OPS-12', adopted: true } });
  });
});

describe('record binding and growth', () => {
  it('does not reveal a stored work item to a different request for the same label', async () => {
    const t = await setup();
    await createRemediationWorkItem(t.deps, t.request, ME);
    const other = { ...INPUT, projectKey: 'ZZZ' };
    const p2 = await prepareRemediationRequest(t.deps, other);
    if (!p2.ok) throw new Error(p2.error.message);
    const approval = approveRequest(p2.data.draft, { siteUrl: SITE }, SOMEONE_ELSE, AT);
    const r = await createRemediationWorkItem(
      t.deps,
      { ...other, requestHash: p2.data.requestHash, approval },
      SOMEONE_ELSE,
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(JSON.stringify(r)).not.toContain('OPS-7');
    expect(creates(t.sent)).toHaveLength(1);
  });

  it('caps the audit trail so repeated checks cannot grow the record without bound', async () => {
    const t = await setup(async () => {
      throw new Error('crash');
    });
    for (let i = 0; i < 250; i += 1) await createRemediationWorkItem(t.deps, t.request, ME);
    const rec = await t.record();
    expect(rec!.audit.length).toBeLessThanOrEqual(MAX_AUDIT_ENTRIES);
    expect(rec!.state.status).toBe('unknown');
    expect(creates(t.sent)).toHaveLength(1);
  });
});

describe('disabled by default', () => {
  const never = async (): Promise<JiraResponse> => {
    throw new Error('network must not be touched');
  };

  it('returns no writer or store unless the flag and SF_STORAGE are both exact', () => {
    const { clientFor } = fakeStore();
    for (const env of [
      {},
      { SF_STORAGE: 'enabled' },
      { SF_REMEDIATION_WRITE: 'enabled' },
      { SF_REMEDIATION_WRITE: 'true', SF_STORAGE: 'enabled' },
      { SF_REMEDIATION_WRITE: 'enabled ', SF_STORAGE: 'enabled' },
    ]) {
      expect(remediationCreateWiring({ env, clientFor, transport: never })).toEqual({
        writer: null,
        storage: null,
      });
    }
    const both = remediationCreateWiring({
      env: { SF_REMEDIATION_WRITE: 'enabled', SF_STORAGE: 'enabled' },
      clientFor,
      transport: never,
    });
    expect(both.writer).not.toBeNull();
    expect(both.storage).not.toBeNull();
  });

  it('makes no network call with the flag off', async () => {
    let calls = 0;
    const transport: Transport = async () => {
      calls += 1;
      return respond(201);
    };
    const wiring = remediationCreateWiring({ env: {}, transport });
    const t = await setup();
    const result = await handleCreateRemediationWorkItem({ ...t.deps, ...wiring }, t.request, ME);
    expect(result).toMatchObject({ ok: false, error: { code: 'WRITE_NOT_PERMITTED' } });
    expect(calls).toBe(0);
    expect(t.sent).toEqual([]);
  });

  it('stores records in the existing rehearsal-history entity, no new entity', async () => {
    const { clientFor, entities } = fakeStore();
    const storage = remediationCreateWiring({
      env: { SF_REMEDIATION_WRITE: 'enabled', SF_STORAGE: 'enabled' },
      clientFor,
      transport: never,
    }).storage!;
    expect(await storage.set('remediation-item:sf-rem-x', { a: 1 }, null)).toMatchObject({
      ok: true,
    });
    expect([...entities.keys()]).toEqual(['rehearsal-history']);
  });

  it('src/remediation has no PUT, DELETE, PATCH or asApp', () => {
    const dir = new URL('../src/remediation/', import.meta.url);
    for (const file of readdirSync(dir)) {
      const code = readFileSync(new URL(file, dir), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      expect(code, file).not.toMatch(/asApp/);
      expect(code, file).not.toMatch(/['"`](PUT|DELETE|PATCH)['"`]/);
    }
  });

  // Defence in depth: even if SF_REMEDIATION_WRITE were mis-set in a deployed
  // environment, the manifest requests no Jira write scope, so Jira refuses.
  it('manifest has no Jira write scope', () => {
    const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
    expect(manifest).not.toMatch(/write:jira-work/);
    expect(manifest).not.toMatch(/^\s*-\s*write:/m);
    expect(manifest).not.toMatch(/delete:jira/);
  });
});
