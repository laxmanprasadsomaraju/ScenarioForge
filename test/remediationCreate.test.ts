import { describe, expect, it } from 'vitest';
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
} from '../src/remediation/gateways';
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
