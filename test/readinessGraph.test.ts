import { describe, expect, it, vi } from 'vitest';
import type { AnalysisEngine } from '../src/analysis/analyzeChange';
import { ruleEngine } from '../src/analysis/ruleEngine';
import type { ConfluenceGateway, ConfluenceResponse } from '../src/confluence/client';
import { getReadinessGraph } from '../src/graph/getReadinessGraph';
import type { JiraFieldGateway } from '../src/jira/affectedServices';
import {
  AFFECTED_SERVICES_CUSTOM_TYPE,
  findAffectedServicesField,
  parseAffectedServicesValue,
} from '../src/jira/affectedServices';
import type { JiraIssueGateway, JiraResponse } from '../src/jira/client';
import { ISSUE_DETAIL_FIELDS } from '../src/jira/client';
import { parseGetReadinessGraphRequest } from '../src/validation';
import {
  JSM_PAGE_SERVICE_REASON,
  MAX_GRAPH_SERVICES,
  NO_SERVICE_SOURCE_REASON,
  TEAM_SOURCE_REASON,
  validateGraph,
} from '../shared/graph';

const NOW = () => new Date('2026-11-10T12:00:00.000Z');

function response(status: number, body: unknown = {}): JiraResponse & ConfluenceResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const DESCRIPTION =
  'We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';
const STEP3 =
  'If the primary IdP is unavailable for more than 5 minutes, run authctl failover --target legacyauth.';

function issue(status = 'To Do') {
  return {
    key: 'MC-62',
    fields: {
      summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: DESCRIPTION }] }],
      },
      status: { name: status },
      issuetype: { name: 'Change' },
      updated: '2026-11-10T09:00:00.000+0000',
    },
  };
}

function runbookPage(extra = '') {
  return {
    id: '98305',
    title: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
    _links: { webui: '/spaces/SFDEMO/pages/98305/RB-AUTH-01' },
    body: {
      storage: {
        value: `<p>Synthetic runbook.${extra}</p><ol><li>Confirm elevated sign-in failures.</li><li>Check the primary IdP status page.</li><li>${STEP3}</li><li>Post a status update to customers.</li></ol>`,
      },
    },
  };
}

const SEARCH = {
  results: [{ content: { id: '98305', type: 'page', title: '[DEMO] RB-AUTH-01' } }],
  size: 1,
};

const SUMMARY_FIELD = {
  id: 'summary',
  name: 'Summary',
  custom: false,
  schema: { type: 'string', system: 'summary' },
};
const SERVICES_FIELD = {
  id: 'customfield_10043',
  name: 'Affected services',
  custom: true,
  schema: {
    type: 'array',
    items: 'service-entity-field',
    custom: AFFECTED_SERVICES_CUSTOM_TYPE,
    customId: 10043,
  },
};
const ARI_A = 'ari:cloud:graph::service/site-1/1111';
const ARI_B = 'ari:cloud:graph::service/site-1/2222';

type FakeJira = JiraIssueGateway & JiraFieldGateway;

/**
 * Fake Jira: the analysis read (ISSUE_DETAIL_FIELDS) gets `issueResponse`; the
 * probe's single-field read gets `serviceRead`.
 */
function jiraGateway(
  issueResponse: JiraResponse = response(200, issue()),
  fieldList: JiraResponse = response(200, [SUMMARY_FIELD]),
  serviceRead: JiraResponse = response(200, { key: 'MC-62', fields: {} }),
): FakeJira {
  return {
    getIssue: vi.fn(async (_key: string, params: URLSearchParams) =>
      params.get('fields') === ISSUE_DETAIL_FIELDS ? issueResponse : serviceRead,
    ),
    getRemoteLinks: vi.fn(async () => response(200, [])),
    listFields: vi.fn(async () => fieldList),
  };
}

/** Jira with the Affected services field, set to `value` on MC-62. */
function withServices(value: unknown): FakeJira {
  return jiraGateway(
    response(200, issue()),
    response(200, [SUMMARY_FIELD, SERVICES_FIELD]),
    response(200, { key: 'MC-62', fields: { customfield_10043: value } }),
  );
}

function confluenceGateway(
  search: ConfluenceResponse = response(200, SEARCH),
  page: ConfluenceResponse = response(200, runbookPage()),
): ConfluenceGateway {
  return {
    searchContent: vi.fn(async () => search),
    getPage: vi.fn(async () => page),
  };
}

async function graphFor(
  jira: FakeJira = jiraGateway(),
  confluence: ConfluenceGateway = confluenceGateway(),
  engine: AnalysisEngine = ruleEngine,
) {
  return getReadinessGraph({ jira, confluence, engine, now: NOW }, { issueKey: 'MC-62' });
}

describe('getReadinessGraph resolver (fake gateways, real rule engine)', () => {
  it('builds the MC-62 impact path with the M3 confidence and a valid graph', async () => {
    const result = await graphFor();
    if (!result.ok) throw new Error(result.error.message);
    const graph = result.data;

    expect(graph.builtAt).toBe('2026-11-10T12:00:00.000Z');
    expect(graph.analysis.status).toBe('findings');
    expect(graph.edges.map((e) => [e.kind, e.from, e.to, e.confidence])).toEqual([
      ['change-names-subject', 'change:MC-62', 'subject:legacyauth', 'confirmed'],
      ['subject-replaced-by', 'subject:legacyauth', 'subject:nimbusid', 'confirmed'],
      ['step-in-page', 'step:98305:3', 'page:98305', 'confirmed'],
      ['step-depends-on-subject', 'step:98305:3', 'subject:legacyauth', 'suspected'],
    ]);
    expect(graph.nodes.some((n) => n.kind === 'service' || n.kind === 'team')).toBe(false);
    expect(graph.unassessed.map((u) => [u.from, u.source])).toEqual([
      ['page:98305', 'jsm'],
      ['page:98305', 'teamwork-graph'],
    ]);
    expect(graph.sources.map((s) => [s.source, s.status])).toEqual([
      ['jira', 'used'],
      ['confluence', 'used'],
      ['jsm', 'not-connected'],
      ['teamwork-graph', 'not-connected'],
    ]);
    expect(validateGraph(graph)).toEqual([]);
  });

  it('is confirmed when the runbook page names the change', async () => {
    const result = await graphFor(
      jiraGateway(),
      confluenceGateway(response(200, SEARCH), response(200, runbookPage(' Related: MC-62'))),
    );
    if (!result.ok) throw new Error(result.error.message);
    const depends = result.data.edges.find((e) => e.kind === 'step-depends-on-subject');
    expect(depends?.confidence).toBe('confirmed');
  });

  it('returns the same graph for the same inputs', async () => {
    const a = await graphFor();
    const b = await graphFor();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('keeps the subjects and reports Confluence as not permitted on HTTP 403', async () => {
    const result = await graphFor(jiraGateway(), confluenceGateway(response(403)));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.analysis.status).toBe('not-assessed');
    expect(result.data.nodes.map((n) => n.id)).toEqual([
      'change:MC-62',
      'subject:legacyauth',
      'subject:nimbusid',
    ]);
    expect(result.data.edges.some((e) => e.kind === 'step-depends-on-subject')).toBe(false);
    expect(result.data.sources[1]).toMatchObject({ source: 'confluence', status: 'not-permitted' });
  });

  it('reports a Confluence outage as an error source, not as a failed graph', async () => {
    const result = await graphFor(jiraGateway(), confluenceGateway(response(500)));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.sources[1]).toMatchObject({ source: 'confluence', status: 'error' });
  });

  it('draws only the change for a cancelled change and never calls Confluence', async () => {
    const confluence = confluenceGateway();
    const result = await graphFor(jiraGateway(response(200, issue("Won't Do"))), confluence);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.nodes.map((n) => n.id)).toEqual(['change:MC-62']);
    expect(result.data.edges).toEqual([]);
    expect(result.data.sources[1]).toMatchObject({ source: 'confluence', status: 'not-queried' });
    expect(confluence.searchContent).not.toHaveBeenCalled();
  });

  it('passes a Jira error through unchanged', async () => {
    const result = await graphFor(jiraGateway(response(404)));
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'NOT_FOUND', upstreamStatus: 404 }),
    });
  });

  it('never returns a graph that fails validation', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // An engine whose finding has no evidence would give an edge without a source.
    const engine: AnalysisEngine = {
      ...ruleEngine,
      analyzeChange: (change, runbooks, analyzedAt) => {
        const analysis = ruleEngine.analyzeChange(change, runbooks, analyzedAt);
        return {
          ...analysis,
          findings: analysis.findings.map((f) => ({ ...f, evidence: [] })),
        };
      },
    };
    const result = await graphFor(jiraGateway(), confluenceGateway(), engine);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNEXPECTED_RESPONSE',
        message: 'ScenarioForge could not build a readiness graph it can stand behind.',
      },
    });
    expect(errors).toHaveBeenCalledWith('Readiness graph failed validation', '2 problem(s)');
    errors.mockRestore();
  });
});

describe('JSM Affected services probe (read:jira-work only)', () => {
  const jsmOf = (graph: { sources: { source: string }[] }) =>
    graph.sources.find((s) => s.source === 'jsm');

  it('reports JSM as not connected when the site has no Affected services field', async () => {
    const jira = jiraGateway();
    const result = await graphFor(jira);
    if (!result.ok) throw new Error(result.error.message);
    expect(jsmOf(result.data)).toEqual({
      source: 'jsm',
      status: 'not-connected',
      detail: 'No Affected services field on this site.',
    });
    expect(result.data.nodes.some((n) => n.kind === 'service')).toBe(false);
    expect(result.data.unassessed).toEqual([
      { from: 'page:98305', expected: 'service', source: 'jsm', reason: NO_SERVICE_SOURCE_REASON },
      {
        from: 'page:98305',
        expected: 'service',
        source: 'teamwork-graph',
        reason: NO_SERVICE_SOURCE_REASON,
      },
    ]);
    // Only the analysis read: no field read without a field.
    expect(jira.getIssue).toHaveBeenCalledTimes(1);
    expect(jira.listFields).toHaveBeenCalledTimes(1);
    expect(validateGraph(result.data)).toEqual([]);
  });

  it.each([null, []])('says Affected services is empty when the value is %j', async (value) => {
    const jira = withServices(value);
    const result = await graphFor(jira);
    if (!result.ok) throw new Error(result.error.message);
    const graph = result.data;
    expect(jsmOf(graph)).toEqual({
      source: 'jsm',
      status: 'used',
      detail: 'Affected services field read on MC-62: 0 service(s).',
    });
    expect(graph.nodes.some((n) => n.kind === 'service')).toBe(false);
    expect(graph.edges.some((e) => e.kind === 'change-impacts-service')).toBe(false);
    expect(graph.unassessed).toEqual([
      {
        from: 'page:98305',
        expected: 'service',
        source: 'teamwork-graph',
        reason: NO_SERVICE_SOURCE_REASON,
      },
      {
        from: 'change:MC-62',
        expected: 'service',
        source: 'jsm',
        reason: 'Affected services is empty on MC-62.',
      },
      { from: 'page:98305', expected: 'service', source: 'jsm', reason: JSM_PAGE_SERVICE_REASON },
    ]);
    expect(jira.listFields).toHaveBeenCalledTimes(1);
    expect(jira.getIssue).toHaveBeenLastCalledWith(
      'MC-62',
      new URLSearchParams({ fields: 'customfield_10043' }),
    );
    expect(validateGraph(graph)).toEqual([]);
  });

  it('says the field is empty when Jira does not return it for the issue', async () => {
    const jira = jiraGateway(
      response(200, issue()),
      response(200, [SERVICES_FIELD]),
      response(200, { key: 'MC-62', fields: {} }),
    );
    const result = await graphFor(jira);
    if (!result.ok) throw new Error(result.error.message);
    expect(jsmOf(result.data)).toMatchObject({ status: 'used' });
    expect(result.data.unassessed.find((u) => u.from === 'change:MC-62')?.reason).toBe(
      'Affected services is empty on MC-62 (Jira did not return the field for this issue).',
    );
  });

  it('draws one service with a confirmed JSM edge and leaves its team unassessed', async () => {
    const result = await graphFor(withServices([{ id: ARI_A, name: 'Customer sign-in' }]));
    if (!result.ok) throw new Error(result.error.message);
    const graph = result.data;

    expect(graph.nodes.filter((n) => n.kind === 'service')).toEqual([
      {
        id: `service:jsm:${ARI_A}`,
        kind: 'service',
        label: 'Customer sign-in',
        origin: 'live',
        source: 'jsm',
      },
    ]);
    expect(graph.edges.filter((e) => e.kind === 'change-impacts-service')).toEqual([
      {
        id: `edge:impacts:MC-62:${ARI_A}`,
        kind: 'change-impacts-service',
        from: 'change:MC-62',
        to: `service:jsm:${ARI_A}`,
        confidence: 'confirmed',
        basis: 'MC-62 lists Customer sign-in in its Affected services field.',
        source: 'jsm',
        evidence: [
          {
            id: `MC-62:jsm:customfield_10043:${ARI_A}`,
            origin: 'live',
            kind: 'jsm-service',
            title: 'MC-62: Affected services',
            excerpt: 'Customer sign-in',
            url: '/browse/MC-62',
            retrievedAt: '2026-11-10T12:00:00.000Z',
          },
        ],
      },
    ]);
    expect(graph.edges.some((e) => e.kind === 'page-recovers-service')).toBe(false);
    expect(graph.edges.some((e) => e.kind === 'team-owns-service')).toBe(false);
    expect(graph.nodes.some((n) => n.kind === 'team')).toBe(false);
    expect(jsmOf(graph)).toEqual({
      source: 'jsm',
      status: 'used',
      detail: 'Affected services field read on MC-62: 1 service(s).',
    });
    expect(graph.unassessed).toEqual([
      {
        from: 'page:98305',
        expected: 'service',
        source: 'teamwork-graph',
        reason: NO_SERVICE_SOURCE_REASON,
      },
      {
        from: `service:jsm:${ARI_A}`,
        expected: 'team',
        source: 'teamwork-graph',
        reason: TEAM_SOURCE_REASON,
      },
      { from: 'page:98305', expected: 'service', source: 'jsm', reason: JSM_PAGE_SERVICE_REASON },
    ]);
    expect(validateGraph(graph)).toEqual([]);
  });

  it('draws two services in field order and shows a nameless service by its id', async () => {
    const result = await graphFor(
      withServices([{ id: ARI_B, name: 'Billing API' }, { id: ARI_A }, { id: ARI_B }]),
    );
    if (!result.ok) throw new Error(result.error.message);
    const graph = result.data;
    expect(graph.nodes.filter((n) => n.kind === 'service').map((n) => [n.id, n.label])).toEqual([
      [`service:jsm:${ARI_B}`, 'Billing API'],
      [`service:jsm:${ARI_A}`, ARI_A],
    ]);
    expect(graph.edges.filter((e) => e.kind === 'change-impacts-service').map((e) => e.to)).toEqual(
      [`service:jsm:${ARI_B}`, `service:jsm:${ARI_A}`],
    );
    expect(jsmOf(graph)).toEqual({
      source: 'jsm',
      status: 'used',
      detail:
        'Affected services field read on MC-62: 2 service(s). 1 without a name in the field; shown by id (resolving names needs Assets, not connected).',
    });
    expect(validateGraph(graph)).toEqual([]);
  });

  it.each([
    ['a string', 'Customer sign-in'],
    ['an object', { id: ARI_A }],
    ['an entry without an id', [{ name: 'Customer sign-in' }]],
    ['a numeric id', [{ id: 17 }]],
    ['a non-string name', [{ id: ARI_A, name: { value: 'x' } }]],
    ['a list of strings', [ARI_A]],
  ])('treats %s as unreadable and draws no service', async (_label, value) => {
    const detail =
      'Affected services on MC-62 has a value ScenarioForge could not read, so no service is shown.';
    const result = await graphFor(withServices(value));
    if (!result.ok) throw new Error(result.error.message);
    expect(jsmOf(result.data)).toEqual({ source: 'jsm', status: 'error', detail });
    expect(result.data.nodes.some((n) => n.kind === 'service')).toBe(false);
    expect(result.data.unassessed.filter((u) => u.source === 'jsm')).toEqual([
      { from: 'page:98305', expected: 'service', source: 'jsm', reason: detail },
    ]);
    expect(validateGraph(result.data)).toEqual([]);
  });

  it('reports a field list 403 as not permitted, keeping the rest of the graph', async () => {
    const jira = jiraGateway(response(200, issue()), response(403));
    const result = await graphFor(jira);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.analysis.status).toBe('findings');
    expect(jsmOf(result.data)).toEqual({
      source: 'jsm',
      status: 'not-permitted',
      detail: 'Jira did not let ScenarioForge list Jira fields as you (HTTP 403).',
    });
    expect(jira.getIssue).toHaveBeenCalledTimes(1);
    expect(validateGraph(result.data)).toEqual([]);
  });

  it('reports a field list outage or an unreadable field list as an error', async () => {
    const outage = await graphFor(jiraGateway(response(200, issue()), response(500)));
    if (!outage.ok) throw new Error(outage.error.message);
    expect(jsmOf(outage.data)).toEqual({
      source: 'jsm',
      status: 'error',
      detail: 'Jira returned HTTP 500 when asked to list Jira fields.',
    });
    const garbled = await graphFor(jiraGateway(response(200, issue()), response(200, {})));
    if (!garbled.ok) throw new Error(garbled.error.message);
    expect(jsmOf(garbled.data)).toMatchObject({ status: 'error' });
  });

  it.each([
    [
      403,
      'not-permitted',
      'Jira did not let ScenarioForge read Affected services on MC-62 as you (HTTP 403).',
    ],
    [404, 'error', 'Jira returned HTTP 404 when asked to read Affected services on MC-62.'],
  ])(
    'keeps the graph when the issue read is OK but the field read is HTTP %i',
    async (status, kind, detail) => {
      const jira = jiraGateway(
        response(200, issue()),
        response(200, [SERVICES_FIELD]),
        response(status),
      );
      const result = await graphFor(jira);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.data.analysis.status).toBe('findings');
      expect(jsmOf(result.data)).toEqual({ source: 'jsm', status: kind, detail });
      expect(result.data.nodes.some((n) => n.kind === 'service')).toBe(false);
      expect(validateGraph(result.data)).toEqual([]);
    },
  );

  it('turns a thrown probe call into a JSM error, not a failed graph', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const jira = jiraGateway();
    jira.listFields = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const result = await graphFor(jira);
    if (!result.ok) throw new Error(result.error.message);
    expect(jsmOf(result.data)).toEqual({
      source: 'jsm',
      status: 'error',
      detail: 'ScenarioForge could not reach Jira to read Affected services.',
    });
    errors.mockRestore();
  });

  it('returns the same graph with services for the same inputs', async () => {
    const value = [{ id: ARI_A, name: 'Customer sign-in' }, { id: ARI_B }];
    const a = await graphFor(withServices(value));
    const b = await graphFor(withServices(value));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('invents no service: every service node is an entry of the field', async () => {
    // The change text names LegacyAuth and NimbusID; neither becomes a service.
    const value = [{ id: ARI_A, name: 'Customer sign-in' }];
    const result = await graphFor(withServices(value));
    if (!result.ok) throw new Error(result.error.message);
    const services = result.data.nodes.filter((n) => n.kind === 'service');
    expect(services.map((n) => n.label)).toEqual(['Customer sign-in']);
    for (const node of services) {
      expect(node.source).toBe('jsm');
      expect(value.some((v) => node.id === `service:jsm:${v.id}`)).toBe(true);
    }
  });

  it(`keeps at most ${MAX_GRAPH_SERVICES} services and says how many were left out`, async () => {
    const value = Array.from({ length: MAX_GRAPH_SERVICES + 2 }, (_, i) => ({
      id: `svc-${String(i).padStart(2, '0')}`,
      name: `Service ${i}`,
    }));
    const result = await graphFor(withServices(value));
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.nodes.filter((n) => n.kind === 'service')).toHaveLength(MAX_GRAPH_SERVICES);
    expect(jsmOf(result.data)).toMatchObject({
      status: 'used',
      detail: `Affected services field read on MC-62: ${MAX_GRAPH_SERVICES + 2} service(s). Showing the first ${MAX_GRAPH_SERVICES}.`,
    });
    expect(validateGraph(result.data)).toEqual([]);
  });
});

describe('findAffectedServicesField', () => {
  const textNamedLikeIt = {
    id: 'customfield_10001',
    name: 'Affected services',
    custom: true,
    schema: {
      type: 'string',
      custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield',
    },
  };

  it('matches by the service custom type, whatever the name', () => {
    expect(
      findAffectedServicesField([SUMMARY_FIELD, { ...SERVICES_FIELD, name: 'Services' }]),
    ).toEqual({ id: 'customfield_10043', name: 'Services' });
  });

  it('never matches by name alone', () => {
    expect(findAffectedServicesField([SUMMARY_FIELD, textNamedLikeIt])).toBeNull();
  });

  it('falls back to the name with an array of service items', () => {
    const lookalike = {
      id: 'customfield_10002',
      name: 'affected Services',
      custom: true,
      schema: { type: 'array', items: 'service-entity-field', custom: 'com.example:other' },
    };
    expect(findAffectedServicesField([textNamedLikeIt, lookalike])).toEqual({
      id: 'customfield_10002',
      name: 'affected Services',
    });
  });

  it('prefers the custom type and picks the lowest id among several', () => {
    const second = { ...SERVICES_FIELD, id: 'customfield_10040', name: 'Affected services 2' };
    expect(findAffectedServicesField([SERVICES_FIELD, second])).toEqual({
      id: 'customfield_10040',
      name: 'Affected services 2',
    });
  });

  it('returns undefined for a response that is not a field list', () => {
    expect(findAffectedServicesField({ values: [] })).toBeUndefined();
  });
});

describe('parseAffectedServicesValue', () => {
  it('keeps Assets workspace and object ids without resolving them', () => {
    expect(
      parseAffectedServicesValue([
        { id: ARI_A, workspaceId: 'ws-1', objectId: '88', self: 'ignored' },
      ]),
    ).toEqual({
      services: [{ id: ARI_A, name: null, assetsWorkspaceId: 'ws-1', assetsObjectId: '88' }],
      omitted: 0,
    });
  });

  it('reads null and undefined as empty, and a bare object as unreadable', () => {
    expect(parseAffectedServicesValue(null)).toEqual({ services: [], omitted: 0 });
    expect(parseAffectedServicesValue(undefined)).toEqual({ services: [], omitted: 0 });
    expect(parseAffectedServicesValue({ id: ARI_A })).toBeNull();
  });
});

describe('parseGetReadinessGraphRequest', () => {
  it('accepts an issue key and ignores anything else', () => {
    expect(parseGetReadinessGraphRequest({ issueKey: 'MC-62', jql: 'project = HR' })).toEqual({
      ok: true,
      value: { issueKey: 'MC-62' },
    });
  });

  it.each([undefined, null, {}, { issueKey: 'mc-62' }, { issueKey: 'MC-62 OR 1=1' }, 'MC-62'])(
    'rejects %j',
    (payload) => {
      expect(parseGetReadinessGraphRequest(payload)).toEqual({
        ok: false,
        message: 'issueKey must be a Jira issue key such as OPS-123.',
      });
    },
  );
});
