import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ruleEngine } from '../src/analysis/ruleEngine';
import type { ConfluenceGateway, ConfluenceResponse } from '../src/confluence/client';
import type { JiraResponse } from '../src/jira/client';
import {
  checkRemediationApproval,
  DUPLICATE_SEARCH_MAX_RESULTS,
  prepareRemediationRequest,
  type RemediationJiraGateway,
} from '../src/remediation/prepare';
import { isLinkOnSite, readTrustedSite, trustedSiteUrl } from '../src/remediation/site';
import {
  parseCheckRemediationApprovalRequest,
  parsePrepareRemediationRequest,
} from '../src/remediation/validation';
import type { PrepareRemediationRequest } from '../shared/api';
import {
  approveDraft,
  approveRequest,
  buildCreateIssueRequest,
  checkApproval,
  checkRequestApproval,
  CREATED_ISSUE_KEY,
  descriptionToAdf,
  draftHash,
  REMEDIATION_LABEL,
  requestHash,
  resolveFollowUpRequests,
  type RemediationRequest,
  type WorkItemDraft,
} from '../shared/remediation';
import { canonicalJson } from '../shared/simulation/replay';
import { sha256Hex } from '../shared/remediation';
import { RB_AUTH_STEPS } from './fixtures/analysis/cases';

/**
 * M8 preparation: exact Jira request bodies, their fingerprint, the trusted
 * site address, and the read-only resolvers against fake Jira and Confluence
 * that record every call. Nothing here can write: the fakes have no write
 * method, and every recorded call is asserted to be a GET.
 */

const SITE = 'https://example.atlassian.net';
const ME = '557058:aaaa-bbbb';
const SOMEONE_ELSE = '557058:cccc-dddd';
const AT = '2026-11-10T09:30:00.000Z';
const RB_TITLE = '[DEMO] RB-AUTH-01 Customer sign-in recovery';
const WEBUI = '/spaces/SFDEMO/pages/98305/DEMO+RB-AUTH-01';
const PAGE_URL = `${SITE}/wiki${WEBUI}`;
const CHANGE_QUOTE = 'We will decommission the LegacyAuth tenant on 30 November.';

interface Call {
  method: string;
  path: string;
}

function respond(status: number, body: unknown = {}): JiraResponse & ConfluenceResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Mutable source texts, so tests can change Jira or Confluence between calls. */
interface World {
  changeDescription: string;
  steps: string[];
  serverInfo: JiraResponse;
  search: (jql: string) => JiraResponse;
}

function world(overrides: Partial<World> = {}): World {
  return {
    changeDescription: `Synthetic change for ScenarioForge testing.\n\n${CHANGE_QUOTE} NimbusID replaces LegacyAuth as the secondary identity provider.`,
    steps: [...RB_AUTH_STEPS],
    serverInfo: respond(200, { baseUrl: SITE, deploymentType: 'Cloud' }),
    search: () => respond(200, { issues: [], isLast: true }),
    ...overrides,
  };
}

function adfParagraphs(text: string) {
  return {
    version: 1,
    type: 'doc',
    content: text
      .split('\n\n')
      .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  };
}

/** Fake gateways: only GET-shaped reads exist, and each is recorded with its method. */
function fakes(w: World) {
  const calls: Call[] = [];
  const get = (path: string) => calls.push({ method: 'GET', path });
  const jira: RemediationJiraGateway = {
    serverInfo: async () => {
      get('/rest/api/3/serverInfo');
      return w.serverInfo;
    },
    searchIssues: async (params) => {
      get(`/rest/api/3/search/jql?${params}`);
      return w.search(params.get('jql') ?? '');
    },
    getIssue: async (key, params) => {
      get(`/rest/api/3/issue/${key}?${params}`);
      return respond(200, {
        key,
        fields: {
          summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
          description: adfParagraphs(w.changeDescription),
          status: { name: 'To Do' },
          issuetype: { name: 'Change' },
          updated: '2026-11-09T10:00:00.000+0000',
        },
      });
    },
    getRemoteLinks: async (key) => {
      get(`/rest/api/3/issue/${key}/remotelink`);
      return respond(200, []);
    },
  };
  const confluence: ConfluenceGateway = {
    searchContent: async (params) => {
      get(`/wiki/rest/api/search?${params}`);
      return respond(200, {
        results: [{ content: { id: '98305', type: 'page', title: RB_TITLE } }],
        size: 1,
      });
    },
    getPage: async (id, params) => {
      get(`/wiki/api/v2/pages/${id}?${params}`);
      return respond(200, {
        id,
        title: RB_TITLE,
        _links: { webui: WEBUI },
        body: {
          storage: {
            value: `<p>Related change: MC-62</p><ol>${w.steps.map((s) => `<li>${s.replace(/&/g, '&amp;')}</li>`).join('')}</ol>`,
          },
        },
      });
    },
  };
  let tick = 0;
  const now = () => new Date(Date.parse(AT) + 60_000 * tick++);
  return { calls, deps: { jira, confluence, engine: ruleEngine, now } };
}

const FINDING_ID = 'MC-62:98305:3:legacyauth';
const INPUT: PrepareRemediationRequest = {
  changeKey: 'MC-62',
  findingId: FINDING_ID,
  fixId: 'rem-step',
  projectKey: 'OPS',
  issueTypeName: 'Task',
};

async function prepared(w = world(), input = INPUT) {
  const { calls, deps } = fakes(w);
  const result = await prepareRemediationRequest(deps, input);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return { calls, data: result.data };
}

function expectOnlyGets(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
}

describe('prepareRemediationRequest', () => {
  it('builds the exact request bodies from a fresh analysis', async () => {
    const { data, calls } = await prepared();
    const { draft, request } = data;
    expect(draft.source).toMatchObject({ changeKey: 'MC-62', findingId: FINDING_ID });
    const label = draft.labels[1]!;
    expect(request).toEqual({
      schemaVersion: 1,
      createIssue: {
        method: 'POST',
        path: '/rest/api/3/issue',
        body: {
          fields: {
            project: { key: 'OPS' },
            issuetype: { name: 'Task' },
            summary: `Update ${RB_TITLE} step 3: LegacyAuth retired by MC-62`,
            description: descriptionToAdf(draft.description, SITE),
            labels: [REMEDIATION_LABEL, label],
          },
        },
      },
      issueLink: {
        method: 'POST',
        path: '/rest/api/3/issueLink',
        body: {
          type: { name: 'Relates' },
          inwardIssue: { key: 'MC-62' },
          outwardIssue: { key: CREATED_ISSUE_KEY },
        },
      },
      remoteLink: {
        method: 'POST',
        path: `/rest/api/3/issue/${CREATED_ISSUE_KEY}/remotelink`,
        body: {
          globalId: `scenarioforge:finding:${FINDING_ID}`,
          object: { url: PAGE_URL, title: `${RB_TITLE}, step 3` },
        },
      },
    } satisfies RemediationRequest);
    expect(draft.description).toContain(`Link: ${SITE}/browse/MC-62`);
    expect(draft.description).toContain(`\n${CHANGE_QUOTE}\n`);
    expect(data.requestHash).toBe(sha256Hex(canonicalJson(request)));
    expect(data.draftHash).toBe(draftHash(draft));
    expect(data.siteUrl).toBe(SITE);
    expect(data.duplicate).toMatchObject({ decision: 'none', label, matches: [] });
    expectOnlyGets(calls);
  });

  it('reads only the expected GET endpoints, in order', async () => {
    const { calls } = await prepared();
    expect(calls.map((c) => c.path.split('?')[0])).toEqual([
      '/rest/api/3/serverInfo',
      '/rest/api/3/issue/MC-62',
      '/rest/api/3/issue/MC-62/remotelink',
      '/wiki/rest/api/search',
      '/wiki/api/v2/pages/98305',
      '/rest/api/3/search/jql',
    ]);
  });

  it('searches duplicates with the idempotency label JQL only', async () => {
    const { calls, data } = await prepared();
    const search = calls.at(-1)!;
    const params = new URLSearchParams(search.path.split('?')[1]);
    expect(params.get('jql')).toBe(`labels = "${data.draft.labels[1]}" ORDER BY created ASC`);
    expect(params.get('maxResults')).toBe(String(DUPLICATE_SEARCH_MAX_RESULTS));
    expect(params.get('fields')).toBe('summary,labels');
  });

  it('is stable across time: two preparations give the same request hash', async () => {
    const a = await prepared();
    const b = await prepared();
    expect(b.data.preparedAt).toBe(a.data.preparedAt);
    expect(b.data.requestHash).toBe(a.data.requestHash);
  });

  it('reports a duplicate or ambiguous search result', async () => {
    const label = (await prepared()).data.draft.labels[1]!;
    const one = await prepared(
      world({
        search: () =>
          respond(200, {
            issues: [
              { key: 'OPS-9', fields: { summary: 'x', labels: [REMEDIATION_LABEL, label] } },
            ],
          }),
      }),
    );
    expect(one.data.duplicate).toMatchObject({ decision: 'duplicate', issueKey: 'OPS-9' });
    const two = await prepared(
      world({
        search: () =>
          respond(200, {
            issues: ['OPS-9', 'OPS-10'].map((key) => ({
              key,
              fields: { summary: 'x', labels: [REMEDIATION_LABEL, label] },
            })),
          }),
      }),
    );
    expect(two.data.duplicate).toMatchObject({
      decision: 'ambiguous',
      matches: ['OPS-9', 'OPS-10'],
    });
    const unlabelled = await prepared(
      world({
        search: () => respond(200, { issues: [{ key: 'OPS-9', fields: { labels: [label] } }] }),
      }),
    );
    expect(unlabelled.data.duplicate.decision).toBe('ambiguous');
  });

  it.each([
    [403, 'FORBIDDEN'],
    [429, 'RATE_LIMITED'],
    [401, 'UNAUTHENTICATED'],
  ])('a duplicate search answering %i is an error, never "none"', async (status, code) => {
    const { calls, deps } = fakes(world({ search: () => respond(status) }));
    const result = await prepareRemediationRequest(deps, INPUT);
    expect(result).toMatchObject({ ok: false, error: { code, upstreamStatus: status } });
    expectOnlyGets(calls);
  });

  it('an unreadable duplicate search body is an error', async () => {
    const { deps } = fakes(world({ search: () => respond(200, { nope: true }) }));
    expect(await prepareRemediationRequest(deps, INPUT)).toMatchObject({
      ok: false,
      error: { code: 'UNEXPECTED_RESPONSE' },
    });
  });

  it('refuses when serverInfo fails or reports an untrusted site', async () => {
    for (const serverInfo of [
      respond(403),
      respond(200, { baseUrl: 'http://example.atlassian.net' }),
      respond(200, { baseUrl: 'https://evil.example.com' }),
      respond(200, {}),
    ]) {
      const { calls, deps } = fakes(world({ serverInfo }));
      const result = await prepareRemediationRequest(deps, INPUT);
      expect(result.ok).toBe(false);
      // Nothing else is read without a trusted site.
      expect(calls.map((c) => c.path)).toEqual(['/rest/api/3/serverInfo']);
    }
  });

  it('refuses a finding the fresh analysis no longer reports', async () => {
    const w = world();
    w.steps[2] = 'If the primary IdP is unavailable, run `authctl failover --target nimbusid`.';
    const { deps } = fakes(w);
    expect(await prepareRemediationRequest(deps, INPUT)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('drafts the review fix and the process fix with their own labels', async () => {
    const review = await prepared(world(), { ...INPUT, fixId: 'review-step' });
    const process = await prepared(world(), { ...INPUT, fixId: 'rem-change-check' });
    const step = await prepared();
    expect(review.data.draft.description).toContain('Requested fix: review step 3 against MC-62');
    expect(process.data.draft.description).toContain('Requested fix: Add a recovery-runbook check');
    expect(new Set([review, process, step].map((p) => p.data.draft.labels[1])).size).toBe(3);
  });

  it('uses a user summary and never a browser-supplied site or link', async () => {
    const payload = {
      ...INPUT,
      summary: 'Fix RB-AUTH-01 step 3',
      siteUrl: 'https://evil.example.com',
      links: { remoteLink: { url: 'https://evil.example.com/x' } },
      description: 'injected',
    };
    const parsed = parsePrepareRemediationRequest(payload);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.value).toEqual({ ...INPUT, summary: 'Fix RB-AUTH-01 step 3' });
    const { data } = await prepared(world(), parsed.value);
    expect(data.request.createIssue.body.fields.summary).toBe('Fix RB-AUTH-01 step 3');
    expect(JSON.stringify(data)).not.toContain('evil');
    expect(JSON.stringify(data)).not.toContain('injected');
  });
});

describe('request fingerprint', () => {
  async function base() {
    return (await prepared()).data;
  }

  it('covers every field of every call', async () => {
    const { request } = await base();
    const edits: [string, (r: RemediationRequest) => void][] = [
      ['project', (r) => (r.createIssue.body.fields.project.key = 'OPZ')],
      ['issue type', (r) => (r.createIssue.body.fields.issuetype = { name: 'Bug' })],
      ['issue type id', (r) => (r.createIssue.body.fields.issuetype = { id: '10001' })],
      ['summary', (r) => (r.createIssue.body.fields.summary += ' ')],
      ['labels', (r) => r.createIssue.body.fields.labels.reverse()],
      [
        'description text',
        (r) =>
          ((
            r.createIssue.body.fields.description.content[0] as { content: { text: string }[] }
          ).content[0]!.text += '.'),
      ],
      [
        'description link href',
        (r) => {
          const json = JSON.stringify(r.createIssue.body.fields.description).replace(
            `"href":"${SITE}/browse/MC-62"`,
            `"href":"${SITE}/browse/MC-63"`,
          );
          r.createIssue.body.fields.description = JSON.parse(json);
        },
      ],
      ['create path', (r) => (r.createIssue.path = '/rest/api/2/issue')],
      ['issue link type', (r) => ((r.issueLink.body.type as { name: string }).name = 'Blocks')],
      ['issue link change', (r) => (r.issueLink.body.inwardIssue.key = 'MC-63')],
      [
        'issue link direction',
        (r) => {
          const { inwardIssue, outwardIssue } = r.issueLink.body;
          r.issueLink.body.inwardIssue = outwardIssue;
          r.issueLink.body.outwardIssue = inwardIssue;
        },
      ],
      ['remote link url', (r) => (r.remoteLink!.body.object.url += 'x')],
      ['remote link title', (r) => (r.remoteLink!.body.object.title += 'x')],
      ['remote link globalId', (r) => (r.remoteLink!.body.globalId += 'x')],
      ['remote link removed', (r) => (r.remoteLink = null)],
      ['method', (r) => ((r.issueLink as { method: string }).method = 'PUT')],
    ];
    const original = requestHash(request);
    for (const [, edit] of edits) {
      const changed = structuredClone(request);
      edit(changed);
      expect(requestHash(changed)).not.toBe(original);
    }
    expect(requestHash(structuredClone(request))).toBe(original);
  });

  it('changes when a draft field changes, including the link URLs', async () => {
    const { draft } = await base();
    const hashOf = (d: WorkItemDraft) => {
      const built = buildCreateIssueRequest(d, { siteUrl: SITE });
      if (!built.ok) throw new Error(built.message);
      return requestHash(built.request);
    };
    const original = hashOf(draft);
    const edits: ((d: WorkItemDraft) => void)[] = [
      (d) => (d.projectKey = 'OPZ'),
      (d) => (d.issueType = 'Bug'),
      (d) => (d.summary += '.'),
      (d) => (d.description += ' '),
      (d) =>
        (d.description = d.description.replace(
          `Link: ${SITE}/browse/MC-62`,
          `Link: ${SITE}/browse/MC-6`,
        )),
      (d) => (d.links.remoteLink!.url = `${SITE}/wiki/spaces/OTHER/pages/1/x`),
      (d) => (d.links.remoteLink!.title += '!'),
      (d) => (d.links.remoteLink = null),
    ];
    for (const edit of edits) {
      const changed = structuredClone(draft);
      edit(changed);
      expect(hashOf(changed)).not.toBe(original);
    }
  });

  it('uses the issue type id from createmeta when given', async () => {
    const { draft } = await base();
    const built = buildCreateIssueRequest(draft, { siteUrl: SITE, issueTypeId: '10002' });
    if (!built.ok) throw new Error(built.message);
    expect(built.request.createIssue.body.fields.issuetype).toEqual({ id: '10002' });
    expect(buildCreateIssueRequest(draft, { siteUrl: SITE, issueTypeId: 'Task' }).ok).toBe(false);
  });

  it('refuses links that are not https on the trusted site', async () => {
    const { draft } = await base();
    const refused = (edit: (d: WorkItemDraft) => void, site = SITE) => {
      const changed = structuredClone(draft);
      edit(changed);
      return buildCreateIssueRequest(changed, { siteUrl: site }).ok === false;
    };
    expect(refused(() => undefined)).toBe(false);
    expect(refused(() => undefined, 'https://other.atlassian.net')).toBe(true);
    expect(refused(() => undefined, 'http://example.atlassian.net')).toBe(true);
    expect(refused(() => undefined, `${SITE}/`)).toBe(true);
    expect(refused((d) => (d.links.issueLink.url = '/browse/MC-62'))).toBe(true);
    expect(
      refused((d) => (d.links.issueLink.url = 'https://other.atlassian.net/browse/MC-62')),
    ).toBe(true);
    expect(refused((d) => (d.links.remoteLink!.url = `/wiki${WEBUI}`))).toBe(true);
    expect(
      refused((d) => (d.links.remoteLink!.url = `http://example.atlassian.net/wiki${WEBUI}`)),
    ).toBe(true);
    expect(
      refused((d) => (d.links.remoteLink!.url = `https://other.atlassian.net/wiki${WEBUI}`)),
    ).toBe(true);
    expect(refused((d) => (d.links.remoteLink!.url = `${SITE}/browse/MC-1`))).toBe(true);
    expect(refused((d) => (d.projectKey = 'ops'))).toBe(true);
  });

  it('only marks site links in the description; an off-site URL stays text', async () => {
    const { draft } = await base();
    const changed = {
      ...draft,
      description: `${draft.description}\n\nLink: https://evil.example.com/x`,
    };
    const built = buildCreateIssueRequest(changed, { siteUrl: SITE });
    if (!built.ok) throw new Error(built.message);
    const json = JSON.stringify(built.request.createIssue.body.fields.description);
    expect(json).toContain('{"type":"text","text":"Link: https://evil.example.com/x"}');
    expect(json).not.toContain('"href":"https://evil.example.com/x"');
  });

  it('fills in the created key only for a key in the project', async () => {
    const { request } = await base();
    const resolved = resolveFollowUpRequests(request, 'OPS-7');
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.issueLink.body).toEqual({
      type: { name: 'Relates' },
      inwardIssue: { key: 'MC-62' },
      outwardIssue: { key: 'OPS-7' },
    });
    expect(resolved.remoteLink!.path).toBe('/rest/api/3/issue/OPS-7/remotelink');
    expect(resolved.remoteLink!.body).toEqual(request.remoteLink!.body);
    expect(request.issueLink.body.outwardIssue.key).toBe(CREATED_ISSUE_KEY);
    for (const bad of ['MC-70', 'OPS-0', 'OPS-7/../x', '{createdIssueKey}']) {
      expect(resolveFollowUpRequests(request, bad).ok).toBe(false);
    }
  });
});

describe('request approval', () => {
  it('binds to the request hash and keeps the draft hash', async () => {
    const { draft, request, requestHash: hash } = (await prepared()).data;
    const approval = approveRequest(draft, { siteUrl: SITE }, ME, AT);
    expect(approval).toEqual({
      draftHash: draftHash(draft),
      requestHash: hash,
      approverAccountId: ME,
      approvedAt: AT,
    });
    expect(checkApproval(draft, approval, ME)).toBe('valid');
    expect(checkRequestApproval(request, approval, ME)).toBe('valid');
    expect(checkRequestApproval(request, approval, SOMEONE_ELSE)).toBe('wrong-approver');
    expect(checkRequestApproval(request, null, ME)).toBe('missing');
    const changed = structuredClone(request);
    changed.remoteLink!.body.object.url += 'x';
    expect(checkRequestApproval(changed, approval, ME)).toBe('stale');
    // A draft-only approval never covers a request.
    expect(checkRequestApproval(request, approveDraft(draft, ME, AT), ME)).toBe('stale');
  });

  it('refuses to approve a draft that cannot become a request', async () => {
    const { draft } = (await prepared()).data;
    expect(() =>
      approveRequest(draft, { siteUrl: 'https://other.atlassian.net' }, ME, AT),
    ).toThrow();
  });
});

describe('checkRemediationApproval', () => {
  async function approvedFor(w: World) {
    const { data } = await prepared(w);
    return {
      ...INPUT,
      requestHash: data.requestHash,
      approval: approveRequest(data.draft, { siteUrl: SITE }, ME, AT),
    };
  }

  it('is valid while nothing changed, with only GETs', async () => {
    const w = world();
    const input = await approvedFor(w);
    const { calls, deps } = fakes(w);
    const result = await checkRemediationApproval(deps, input, ME);
    expect(result).toMatchObject({
      ok: true,
      data: { check: 'valid', requestHash: input.requestHash },
    });
    expectOnlyGets(calls);
  });

  it('is stale after the Jira change text changes', async () => {
    const w = world();
    const input = await approvedFor(w);
    w.changeDescription = w.changeDescription.replace('30 November', '1 December');
    const { deps } = fakes(w);
    const result = await checkRemediationApproval(deps, input, ME);
    expect(result).toMatchObject({ ok: true, data: { check: 'stale' } });
    if (result.ok) expect(result.data.requestHash).not.toBe(input.requestHash);
  });

  it('is stale after the Confluence step text changes', async () => {
    const w = world();
    const input = await approvedFor(w);
    w.steps[2] = `${w.steps[2]} Then page the on-call.`;
    const { deps } = fakes(w);
    expect(await checkRemediationApproval(deps, input, ME)).toMatchObject({
      ok: true,
      data: { check: 'stale' },
    });
  });

  it('is stale when the hash the person saw differs, or the summary changed', async () => {
    const w = world();
    const input = await approvedFor(w);
    const { deps } = fakes(w);
    expect(
      await checkRemediationApproval(deps, { ...input, requestHash: '0'.repeat(64) }, ME),
    ).toMatchObject({ ok: true, data: { check: 'stale' } });
    expect(
      await checkRemediationApproval(deps, { ...input, summary: 'Another summary' }, ME),
    ).toMatchObject({ ok: true, data: { check: 'stale' } });
  });

  it('reports another approver', async () => {
    const w = world();
    const input = await approvedFor(w);
    const { deps } = fakes(w);
    expect(await checkRemediationApproval(deps, input, SOMEONE_ELSE)).toMatchObject({
      ok: true,
      data: { check: 'wrong-approver' },
    });
  });

  it('validates the payload', async () => {
    const input = await approvedFor(world());
    expect(parseCheckRemediationApprovalRequest(input).ok).toBe(true);
    expect(parseCheckRemediationApprovalRequest({ ...input, requestHash: 'abc' }).ok).toBe(false);
    expect(
      parseCheckRemediationApprovalRequest({
        ...input,
        approval: { ...input.approval, requestHash: 'x' },
      }).ok,
    ).toBe(false);
    expect(parseCheckRemediationApprovalRequest({ ...input, approval: null }).ok).toBe(false);
  });
});

describe('input validation', () => {
  it('accepts only the named fields with strict shapes', () => {
    expect(parsePrepareRemediationRequest(INPUT)).toEqual({ ok: true, value: INPUT });
    const bad: Record<string, unknown>[] = [
      { changeKey: 'mc-62' },
      { findingId: 'MC-63:98305:3:legacyauth' },
      { findingId: 'MC-62:98305:3:legacy auth' },
      { fixId: 'anything' },
      { projectKey: 'ops' },
      { issueTypeName: 'Epic' },
      { summary: '' },
      { summary: 'a\nb' },
      { summary: 'a'.repeat(256) },
    ];
    for (const patch of bad) {
      expect(parsePrepareRemediationRequest({ ...INPUT, ...patch }).ok).toBe(false);
    }
    expect(parsePrepareRemediationRequest(null).ok).toBe(false);
    expect(parsePrepareRemediationRequest([]).ok).toBe(false);
  });
});

describe('trusted site address', () => {
  it('takes baseUrl from serverInfo only when it is a plain https Atlassian site', () => {
    expect(trustedSiteUrl({ baseUrl: SITE })).toBe(SITE);
    expect(trustedSiteUrl({ baseUrl: `${SITE}/` })).toBe(SITE);
    expect(trustedSiteUrl({ baseUrl: 'https://Example.Atlassian.net' })).toBe(SITE);
    for (const baseUrl of [
      'http://example.atlassian.net',
      'https://example.atlassian.net/jira',
      'https://example.atlassian.net:443',
      'https://user@example.atlassian.net',
      'https://example.atlassian.net.evil.com',
      'https://atlassian.net',
      'https://.atlassian.net',
      'https://jira.example.com',
      'javascript:alert(1)',
      '',
      42,
    ]) {
      expect(trustedSiteUrl({ baseUrl })).toBeNull();
    }
    expect(trustedSiteUrl(null)).toBeNull();
  });

  it('checks links against the exact site origin', () => {
    expect(isLinkOnSite(`${SITE}/browse/MC-1`, SITE)).toBe(true);
    expect(isLinkOnSite('https://other.atlassian.net/browse/MC-1', SITE)).toBe(false);
    expect(isLinkOnSite('/browse/MC-1', SITE)).toBe(false);
  });

  it('maps a serverInfo failure to an error', async () => {
    expect(await readTrustedSite({ serverInfo: async () => respond(429) })).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
  });
});

describe('no write path', () => {
  const ROOT = join(__dirname, '..');
  const files = [
    ...readdirSync(join(ROOT, 'src/remediation')).map((f) => join(ROOT, 'src/remediation', f)),
    ...readdirSync(join(ROOT, 'shared/remediation')).map((f) =>
      join(ROOT, 'shared/remediation', f),
    ),
  ];

  it('never passes a method, body or fetch to Forge in remediation code', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\bfetch\(/);
      expect(source).not.toMatch(/requestJira\([^)]*,/);
      expect(source).not.toMatch(/requestConfluence/);
      expect(source).not.toMatch(/method:\s*['"](PUT|DELETE|PATCH)['"]/);
    }
    const forge = readFileSync(join(ROOT, 'src/remediation/forge.ts'), 'utf8').replace(
      /\/\*\*[\s\S]*?\*\//g,
      '',
    );
    expect(forge).not.toMatch(/method|body:|asApp/);
    expect(forge.match(/requestJira\(/g)).toHaveLength(4);
  });

  it('registers only the hard-disabled create resolver, wired to the null production writer', () => {
    const index = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
    const defined = [...index.matchAll(/resolver\.define\('([^']+)'/g)].map((m) => m[1]);
    expect(defined).toContain('prepareRemediationRequest');
    expect(defined).toContain('checkRemediationApproval');
    expect(defined.filter((name) => /create|post|write|submit/i.test(name!))).toEqual([
      'createRemediationWorkItem',
    ]);
    expect(index).toMatch(/writer: productionRemediationWriter\(\)/);
    const gateways = readFileSync(join(ROOT, 'src/remediation/gateways.ts'), 'utf8');
    expect(gateways).not.toMatch(/@forge\/api|requestJira/);
  });
});
