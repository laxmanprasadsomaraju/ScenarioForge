import { describe, expect, it } from 'vitest';
import { analyzeChange } from '../shared/analysis';
import type { ChangeAnalysis, ChangeEvidence, RunbookEvidence } from '../shared/analysis/types';
import {
  MAX_GRAPH_SERVICES,
  NO_SERVICE_SOURCE_REASON,
  buildGraphFromAnalysis,
  confluenceSourceStatus,
  validateGraph,
} from '../shared/graph';
import type { GraphEdge, GraphNode, ReadinessGraph, UnassessedLink } from '../shared/graph';
import { mergeGraphExtras } from '../shared/graph/twg';

const ANALYZED_AT = '2026-11-10T12:00:00.000Z';
const BUILT_AT = '2026-11-10T12:00:01.000Z';

const DESCRIPTION =
  'We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';
const STEP3 =
  'If the primary IdP is unavailable for more than 5 minutes, run authctl failover --target legacyauth.';

function change(overrides: Partial<ChangeEvidence> = {}): ChangeEvidence {
  return {
    origin: 'live',
    key: 'MC-62',
    summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
    descriptionText: DESCRIPTION,
    status: 'To Do',
    issueType: 'Change',
    updated: '2026-11-10T09:00:00.000Z',
    browsePath: '/browse/MC-62',
    remoteLinks: [],
    retrievedAt: ANALYZED_AT,
    ...overrides,
  };
}

function runbook(extraText = '', steps = [STEP3]): RunbookEvidence {
  const all = [
    'Confirm elevated sign-in failures.',
    'Check the primary IdP status page.',
    ...steps,
  ];
  return {
    origin: 'live',
    pageId: '98305',
    title: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
    webuiPath: '/spaces/SFDEMO/pages/98305/RB-AUTH-01',
    lastUpdated: null,
    steps: all.map((instruction, i) => ({ order: i + 1, instruction, dependsOn: [] })),
    stepSource: 'ordered-list',
    text: `Synthetic runbook.${extraText} ${all.join(' ')}`,
    retrievedAt: ANALYZED_AT,
  };
}

const suspected = () => analyzeChange(change(), [runbook()], ANALYZED_AT);
const confirmed = () => analyzeChange(change(), [runbook(' Related change: MC-62')], ANALYZED_AT);

function edgesOf(graph: ReadinessGraph, kind: GraphEdge['kind']): GraphEdge[] {
  return graph.edges.filter((e) => e.kind === kind);
}

describe('buildGraphFromAnalysis (MC-62 shapes)', () => {
  it('draws change → LegacyAuth ← step 3 → RB-AUTH-01 with the M3 confidence (suspected)', () => {
    const analysis = suspected();
    expect(analysis.status).toBe('findings');
    const graph = buildGraphFromAnalysis(analysis, BUILT_AT);

    expect(graph).toMatchObject({ changeKey: 'MC-62', builtAt: BUILT_AT, analysis });
    expect(graph.nodes.map((n) => [n.id, n.kind, n.source])).toEqual([
      ['change:MC-62', 'change', 'jira'],
      ['subject:legacyauth', 'subject', 'm3-analysis'],
      ['subject:nimbusid', 'subject', 'm3-analysis'],
      ['page:98305', 'runbook-page', 'confluence'],
      ['step:98305:3', 'runbook-step', 'confluence'],
    ]);
    expect(graph.nodes.find((n) => n.id === 'change:MC-62')?.path).toBe('/browse/MC-62');
    expect(graph.nodes.find((n) => n.id === 'page:98305')?.path).toBe(
      '/wiki/spaces/SFDEMO/pages/98305/RB-AUTH-01',
    );

    expect(graph.edges.map((e) => [e.kind, e.from, e.to, e.confidence])).toEqual([
      ['change-names-subject', 'change:MC-62', 'subject:legacyauth', 'confirmed'],
      ['subject-replaced-by', 'subject:legacyauth', 'subject:nimbusid', 'confirmed'],
      ['step-in-page', 'step:98305:3', 'page:98305', 'confirmed'],
      ['step-depends-on-subject', 'step:98305:3', 'subject:legacyauth', 'suspected'],
    ]);

    const [depends] = edgesOf(graph, 'step-depends-on-subject');
    const finding = analysis.findings[0]!;
    expect(depends!.evidence).toEqual(finding.evidence);
    expect(depends!.basis).toBe(
      'Step 3 of [DEMO] RB-AUTH-01 Customer sign-in recovery names LegacyAuth. Suspected by the change-to-recovery analysis: not confirmed by an explicit cross-reference.',
    );

    const subjectExcerpt = analysis.subjects[0]!.excerpt;
    for (const kind of ['change-names-subject', 'subject-replaced-by'] as const) {
      const [edge] = edgesOf(graph, kind);
      expect(edge!.evidence).toHaveLength(1);
      expect(edge!.evidence[0]).toMatchObject({
        kind: 'jira-issue',
        excerpt: subjectExcerpt,
        url: '/browse/MC-62',
        origin: 'live',
      });
      expect(DESCRIPTION).toContain(edge!.evidence[0]!.excerpt);
    }
    const [inPage] = edgesOf(graph, 'step-in-page');
    expect(inPage!.evidence).toEqual([expect.objectContaining({ excerpt: STEP3 })]);
    expect(validateGraph(graph)).toEqual([]);
  });

  it('keeps a confirmed finding confirmed, with every basis in the edge text', () => {
    const analysis = confirmed();
    expect(analysis.findings[0]?.confidence).toBe('confirmed');
    const graph = buildGraphFromAnalysis(analysis, BUILT_AT);
    const [depends] = edgesOf(graph, 'step-depends-on-subject');
    expect(depends!.confidence).toBe('confirmed');
    expect(depends!.basis).toContain('The page mentions MC-62.');
    expect(depends!.basis).toContain('Confirmed by the change-to-recovery analysis');
    expect(validateGraph(graph)).toEqual([]);
  });

  it('lists each missing service source per page with a finding, and invents no service or team', () => {
    const graph = buildGraphFromAnalysis(suspected(), BUILT_AT);
    expect(graph.nodes.some((n) => n.kind === 'service' || n.kind === 'team')).toBe(false);
    expect(graph.unassessed).toEqual([
      { from: 'page:98305', expected: 'service', source: 'jsm', reason: NO_SERVICE_SOURCE_REASON },
      {
        from: 'page:98305',
        expected: 'service',
        source: 'teamwork-graph',
        reason: NO_SERVICE_SOURCE_REASON,
      },
    ]);
    expect(graph.sources).toEqual([
      { source: 'jira', status: 'used', detail: 'Read MC-62 as you.' },
      { source: 'confluence', status: 'used', detail: 'Read 1 of 1 recovery page found.' },
      { source: 'jsm', status: 'not-connected', detail: NO_SERVICE_SOURCE_REASON },
      {
        source: 'teamwork-graph',
        status: 'not-connected',
        detail: 'Teamwork Graph is not connected yet.',
      },
    ]);
  });

  it('is deterministic: same input, same graph, and the analysis is not mutated', () => {
    const analysis = suspected();
    const before = structuredClone(analysis);
    const a = buildGraphFromAnalysis(analysis, BUILT_AT);
    const b = buildGraphFromAnalysis(structuredClone(analysis), BUILT_AT);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(analysis).toEqual(before);
  });

  it('gives every edge at least one evidence reference, for every analysis shape', () => {
    const shapes = [suspected(), confirmed(), analyzeChange(change(), [], ANALYZED_AT)];
    for (const analysis of shapes) {
      const graph = buildGraphFromAnalysis(analysis, BUILT_AT);
      for (const edge of graph.edges) expect(edge.evidence.length).toBeGreaterThan(0);
      expect(validateGraph(graph)).toEqual([]);
    }
  });

  it('draws no step edges when no step matched (no-findings), but shows the pages read', () => {
    const analysis = analyzeChange(
      change(),
      [runbook('', ['Restart the sign-in service.'])],
      ANALYZED_AT,
    );
    expect(analysis.status).toBe('no-findings');
    const graph = buildGraphFromAnalysis(analysis, BUILT_AT);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'change:MC-62',
      'subject:legacyauth',
      'subject:nimbusid',
      'page:98305',
    ]);
    expect(edgesOf(graph, 'step-depends-on-subject')).toEqual([]);
    expect(edgesOf(graph, 'step-in-page')).toEqual([]);
    expect(graph.unassessed).toEqual([]);
    expect(validateGraph(graph)).toEqual([]);
  });

  it('keeps subjects but draws no runbook part when Confluence was not permitted', () => {
    const base = suspected();
    const analysis: ChangeAnalysis = {
      ...base,
      status: 'not-assessed',
      notAssessedReason:
        'Runbooks were not checked: Confluence refused access (HTTP 403): Confluence may not be connected to this ScenarioForge installation, or you do not have permission to view this content.',
      findings: [],
      coverage: {
        pagesFound: 0,
        pagesRead: 0,
        pagesWithoutSteps: 0,
        pagesSkipped: 0,
        pagesChecked: [],
      },
    };
    const graph = buildGraphFromAnalysis(analysis, BUILT_AT);
    expect(graph.nodes.map((n) => n.kind)).toEqual(['change', 'subject', 'subject']);
    expect(graph.edges.map((e) => e.kind)).toEqual(['change-names-subject', 'subject-replaced-by']);
    expect(graph.unassessed).toEqual([]);
    expect(graph.sources[1]).toEqual({
      source: 'confluence',
      status: 'not-permitted',
      detail: analysis.notAssessedReason,
    });
    expect(validateGraph(graph)).toEqual([]);
  });

  it('draws only the change for a cancelled change: no subjects, no step edges', () => {
    const analysis = analyzeChange(change({ status: "Won't Do" }), [runbook()], ANALYZED_AT);
    expect(analysis.status).toBe('not-assessed');
    const graph = buildGraphFromAnalysis(analysis, BUILT_AT);
    expect(graph.nodes.map((n) => n.id)).toEqual(['change:MC-62', 'page:98305']);
    expect(graph.edges).toEqual([]);
    expect(graph.unassessed).toEqual([]);
    expect(validateGraph(graph)).toEqual([]);
  });

  it('adds service nodes only from extras, and stops listing a source as unassessed once used', () => {
    const service: GraphNode = {
      id: 'service:auth',
      kind: 'service',
      label: 'Customer sign-in',
      origin: 'live',
      source: 'jsm',
    };
    const recovers: GraphEdge = {
      id: 'edge:recovers:98305:auth',
      kind: 'page-recovers-service',
      from: 'page:98305',
      to: 'service:auth',
      confidence: 'confirmed',
      basis: 'The JSM service links the runbook page.',
      source: 'jsm',
      evidence: [
        { id: 'jsm:auth', origin: 'live', kind: 'jsm-service', title: 'Customer sign-in' },
      ],
    };
    const graph = buildGraphFromAnalysis(suspected(), BUILT_AT, {
      nodes: [service],
      edges: [recovers],
      sources: [{ source: 'jsm', status: 'used', detail: 'Read 1 service.' }],
    });
    expect(graph.nodes.at(-1)).toEqual(service);
    expect(graph.edges.at(-1)).toEqual(recovers);
    expect(graph.unassessed.map((u) => u.source)).toEqual(['teamwork-graph']);
    expect(validateGraph(graph)).toEqual([]);
  });
});

describe('confluenceSourceStatus', () => {
  const base = analyzeChange(change(), [], ANALYZED_AT);
  const withReason = (reason: string): ChangeAnalysis => ({
    ...base,
    status: 'not-assessed',
    notAssessedReason: reason,
  });

  it.each([
    [
      'Runbooks were not checked: No Confluence recovery page you can view mentions legacyauth.',
      'used',
    ],
    [
      'Runbooks were not checked: ScenarioForge is not authorised to read Confluence as you. Grant access and try again.',
      'not-permitted',
    ],
    [
      'Runbooks were not checked: Confluence refused access (HTTP 403): Confluence may not be connected to this ScenarioForge installation, or you do not have permission to view this content.',
      'not-permitted',
    ],
    ['Runbooks were not checked: ScenarioForge could not reach Confluence.', 'error'],
    ['Runbooks were not checked: 2 recovery pages found, but none could be read.', 'error'],
    [
      'Runbooks were not checked: Confluence is not available on this site, or search is not reachable.',
      'error',
    ],
    ['Runbooks were not searched: No search terms were derived from the change.', 'error'],
    ['No retirement, replacement or migration was recognised in this change.', 'not-queried'],
  ])('maps "%s" to %s', (reason, status) => {
    expect(confluenceSourceStatus(withReason(reason)).status).toBe(status);
  });

  it('is used whenever a page was read, and counts skipped pages', () => {
    const analysis = suspected();
    const status = confluenceSourceStatus({
      ...analysis,
      coverage: { ...analysis.coverage, pagesFound: 7, pagesSkipped: 6 },
    });
    expect(status).toEqual({
      source: 'confluence',
      status: 'used',
      detail: 'Read 1 of 7 recovery pages found; 6 not read.',
    });
  });

  it('says Confluence was not queried when nothing was searched', () => {
    expect(confluenceSourceStatus(withReason('No subjects.')).detail).toBe(
      'Not queried for this change: No subjects.',
    );
  });
});

describe('validateGraph', () => {
  const valid = () => buildGraphFromAnalysis(suspected(), BUILT_AT);
  const edge = (graph: ReadinessGraph, kind: GraphEdge['kind']) =>
    graph.edges.find((e) => e.kind === kind)!;

  it('accepts the graph built from the analysis', () => {
    expect(validateGraph(valid())).toEqual([]);
  });

  it('rejects an edge without evidence', () => {
    const graph = valid();
    edge(graph, 'step-in-page').evidence = [];
    expect(validateGraph(graph)).toEqual(['Edge edge:in-page:98305:3 has no evidence.']);
  });

  it('rejects evidence that is a scenario rule rather than a real source', () => {
    const graph = valid();
    edge(graph, 'step-in-page').evidence = [
      { id: 'rule', origin: 'demo', kind: 'scenario-rule', title: 'Rule' },
    ];
    expect(validateGraph(graph)).toEqual([
      'Edge edge:in-page:98305:3 cites a scenario rule instead of a real source.',
    ]);
  });

  it('rejects an edge whose endpoint does not exist', () => {
    const graph = valid();
    graph.nodes = graph.nodes.filter((n) => n.id !== 'subject:nimbusid');
    expect(validateGraph(graph)).toEqual([
      'Edge edge:replaced-by:legacyauth:nimbusid points to missing node subject:nimbusid.',
    ]);
    const other = valid();
    edge(other, 'change-names-subject').from = 'change:MC-999';
    expect(validateGraph(other)).toEqual([
      'Edge edge:names:MC-62:legacyauth starts from missing node change:MC-999.',
    ]);
  });

  it('rejects duplicate node and edge ids', () => {
    const graph = valid();
    graph.nodes.push({ ...graph.nodes[0]! });
    graph.edges.push({ ...graph.edges[0]! });
    expect(validateGraph(graph)).toEqual([
      'Duplicate node id change:MC-62.',
      'Duplicate edge id edge:names:MC-62:legacyauth.',
    ]);
  });

  it('rejects a service or team without an edge from a real source', () => {
    const graph = valid();
    graph.nodes.push({
      id: 'service:guessed',
      kind: 'service',
      label: 'Guessed',
      origin: 'live',
      source: 'jsm',
    });
    graph.nodes.push({
      id: 'team:guessed',
      kind: 'team',
      label: 'Guessed team',
      origin: 'live',
      source: 'm3-analysis',
    });
    graph.edges.push({
      id: 'edge:owns:guessed',
      kind: 'team-owns-service',
      from: 'team:guessed',
      to: 'service:guessed',
      confidence: 'suspected',
      basis: 'Similar names.',
      source: 'm3-analysis',
      evidence: [{ id: 'x', origin: 'live', kind: 'jira-issue', title: 'MC-62' }],
    });
    expect(validateGraph(graph)).toEqual([
      'service node service:guessed has no edge from a connected source.',
      'team node team:guessed does not come from a connected source.',
      'team node team:guessed has no edge from a connected source.',
    ]);
  });

  it('rejects more services than the bound', () => {
    const graph = valid();
    for (let i = 0; i <= MAX_GRAPH_SERVICES; i += 1) {
      graph.nodes.push({
        id: `service:${i}`,
        kind: 'service',
        label: `Service ${i}`,
        origin: 'live',
        source: 'jsm',
      });
      graph.edges.push({
        id: `edge:recovers:${i}`,
        kind: 'page-recovers-service',
        from: 'page:98305',
        to: `service:${i}`,
        confidence: 'confirmed',
        basis: 'The JSM service links the runbook page.',
        source: 'jsm',
        evidence: [{ id: `jsm:${i}`, origin: 'live', kind: 'jsm-service', title: `S${i}` }],
      });
    }
    expect(validateGraph(graph)).toEqual([
      `The graph has ${MAX_GRAPH_SERVICES + 1} services; at most ${MAX_GRAPH_SERVICES} are allowed.`,
    ]);
  });

  it('rejects a step edge whose confidence differs from its finding', () => {
    const graph = valid();
    edge(graph, 'step-depends-on-subject').confidence = 'confirmed';
    expect(validateGraph(graph)).toEqual([
      'Edge edge:depends:98305:3:legacyauth is confirmed but its finding is suspected.',
    ]);
  });

  it('rejects a step edge without a finding, and a finding without a step edge', () => {
    const graph = valid();
    edge(graph, 'step-depends-on-subject').to = 'subject:nimbusid';
    expect(validateGraph(graph)).toEqual([
      'Edge edge:depends:98305:3:legacyauth has no matching finding in the analysis.',
      'Finding MC-62:98305:3:legacyauth (legacyauth) has no step edge.',
    ]);
  });

  it('rejects an unassessed link from a missing node', () => {
    const graph = valid();
    graph.unassessed.push({
      from: 'page:1',
      expected: 'team',
      source: 'teamwork-graph',
      reason: 'Not connected.',
    });
    expect(validateGraph(graph)).toEqual(['Unassessed team link starts from missing node page:1.']);
  });
});

describe('mergeGraphExtras combined service cap (JSM + Teamwork Graph)', () => {
  const evidence = (id: string) => [
    {
      id,
      origin: 'live' as const,
      kind: 'jsm-service' as const,
      title: id,
      excerpt: id,
      url: '/browse/MC-62',
      retrievedAt: ANALYZED_AT,
    },
  ];
  function part(source: 'jsm' | 'teamwork-graph', count: number, withTeam = false) {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const unassessed: UnassessedLink[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = `service:${source}:${i}`;
      nodes.push({ id, kind: 'service', label: id, origin: 'live', source });
      edges.push({
        id: `edge:impacts:${id}`,
        kind: 'change-impacts-service',
        from: 'change:MC-62',
        to: id,
        confidence: 'confirmed',
        basis: 'b',
        source,
        evidence: evidence(id),
      });
      unassessed.push({ from: id, expected: 'team', source, reason: 'r' });
    }
    if (withTeam) {
      nodes.push({ id: 'team:t', kind: 'team', label: 't', origin: 'live', source });
      edges.push({
        id: 'edge:owns:t',
        kind: 'team-owns-service',
        from: 'team:t',
        to: `service:${source}:${count - 1}`,
        confidence: 'confirmed',
        basis: 'b',
        source,
        evidence: evidence('t'),
      });
    }
    return {
      nodes,
      edges,
      unassessed,
      sources: [{ source, status: 'used' as const, detail: 'd' }],
    };
  }

  it('keeps a valid graph by capping combined services and noting the rest as unassessed', () => {
    const extras = mergeGraphExtras(
      part('jsm', 15),
      part('teamwork-graph', MAX_GRAPH_SERVICES, true),
    );
    const graph = buildGraphFromAnalysis(suspected(), BUILT_AT, extras);
    expect(validateGraph(graph)).toEqual([]);
    const services = graph.nodes.filter((n) => n.kind === 'service');
    expect(services).toHaveLength(MAX_GRAPH_SERVICES);
    expect(services.filter((n) => n.source === 'jsm')).toHaveLength(15);
    // The team owned only a dropped service, so it goes too.
    expect(graph.nodes.some((n) => n.kind === 'team')).toBe(false);
    expect(graph.unassessed.some((u) => u.from === 'service:teamwork-graph:19')).toBe(false);
    const note = graph.unassessed.filter(
      (u) => u.from === 'change:MC-62' && u.source === 'teamwork-graph',
    );
    expect(note).toHaveLength(1);
    expect(note[0]?.reason).toMatch(/^15 more service\(s\) .* not assessed/);
  });

  it('leaves extras untouched under the cap', () => {
    const extras = mergeGraphExtras(part('jsm', 3), part('teamwork-graph', 2));
    expect(extras.nodes).toHaveLength(5);
    expect(extras.unassessed).toHaveLength(5);
  });
});
