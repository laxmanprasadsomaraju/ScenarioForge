import { describe, expect, it, vi } from 'vitest';
import type { AnalysisEngine } from '../src/analysis/analyzeChange';
import { ruleEngine } from '../src/analysis/ruleEngine';
import type { ConfluenceGateway, ConfluenceResponse } from '../src/confluence/client';
import { getReadinessGraph } from '../src/graph/getReadinessGraph';
import type { JiraIssueGateway, JiraResponse } from '../src/jira/client';
import { parseGetReadinessGraphRequest } from '../src/validation';
import { validateGraph } from '../shared/graph';

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

function jiraGateway(issueResponse: JiraResponse = response(200, issue())): JiraIssueGateway {
  return {
    getIssue: vi.fn(async () => issueResponse),
    getRemoteLinks: vi.fn(async () => response(200, [])),
  };
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
  jira: JiraIssueGateway = jiraGateway(),
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
