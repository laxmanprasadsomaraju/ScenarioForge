import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '@forge/bridge';
import type { ApiResult } from '@shared/api';
import type { ChangeAnalysis, ChangeSubject } from '@shared/analysis/types';
import type { GraphEdge, GraphNode, ReadinessGraph } from '@shared/graph/types';
import { ReadinessPage } from '../src/pages/Readiness';
import { sourcePath } from '../src/components/readiness/ImpactPath';
import { changes, issue, renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  // The Command center reads saved history; it is not enabled in these tests.
  listRehearsalHistory: vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: {
        status: 'UNAVAILABLE',
        detail: 'Rehearsal history is not enabled in this environment.',
      },
    }),
  ),
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  analyzeChange: vi.fn(),
  getReadinessGraph: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

const SUBJECT: ChangeSubject = {
  term: 'legacyauth',
  display: 'LegacyAuth',
  action: 'retire',
  excerpt: 'We will decommission the LegacyAuth tenant on 30 November.',
};
const STEP_QUOTE = 'Fail over:  authctl failover --target legacyauth';

const ANALYSIS: ChangeAnalysis = {
  changeKey: 'MC-62',
  change: { key: 'MC-62', summary: 'Retire LegacyAuth', browsePath: '/browse/MC-62' },
  analyzedAt: new Date().toISOString(),
  status: 'findings',
  subjects: [SUBJECT],
  findings: [
    {
      id: 'f1',
      changeKey: 'MC-62',
      pageId: '98305',
      pageTitle: 'RB-AUTH-01 Sign-in recovery',
      stepOrder: 3,
      pageWebuiPath: '/spaces/OPS/pages/98305',
      subject: SUBJECT,
      confidence: 'confirmed',
      basis: ['term-match', 'page-mentions-issue'],
      explanation: 'Step 3 names LegacyAuth, which MC-62 retires.',
      aiAssisted: false,
      evidence: [
        { id: 'e1', origin: 'live', kind: 'jira-issue', title: 'MC-62', excerpt: SUBJECT.excerpt },
        {
          id: 'e2',
          origin: 'live',
          kind: 'runbook-step',
          title: 'RB-AUTH-01, step 3',
          excerpt: STEP_QUOTE,
          url: '/spaces/OPS/pages/98305',
        },
      ],
    },
  ],
  coverage: {
    pagesFound: 2,
    pagesRead: 2,
    pagesWithoutSteps: 0,
    pagesSkipped: 0,
    pagesChecked: [],
  },
};

const node = (id: string, kind: GraphNode['kind'], label: string, path?: string): GraphNode => ({
  id,
  kind,
  label,
  origin: 'live',
  source: 'confluence',
  ...(path ? { path } : {}),
});

const edge = (
  id: string,
  kind: GraphEdge['kind'],
  from: string,
  to: string,
  confidence: GraphEdge['confidence'],
  source: GraphEdge['source'],
  evidence: GraphEdge['evidence'],
): GraphEdge => ({ id, kind, from, to, confidence, basis: `Basis for ${id}.`, source, evidence });

const changeQuote = {
  id: 'q-change',
  origin: 'live' as const,
  kind: 'jira-issue' as const,
  title: 'MC-62',
  excerpt: SUBJECT.excerpt,
  url: '/browse/MC-62',
};
const stepQuote = {
  id: 'q-step',
  origin: 'live' as const,
  kind: 'runbook-step' as const,
  title: 'RB-AUTH-01, step 3',
  excerpt: STEP_QUOTE,
  url: '/spaces/OPS/pages/98305',
};

/** Two paths: step 3 (confirmed) reaches a service and team; step 2 (suspected) does not. */
function graph(overrides: Partial<ReadinessGraph> = {}): ReadinessGraph {
  return {
    changeKey: 'MC-62',
    builtAt: new Date().toISOString(),
    analysis: ANALYSIS,
    nodes: [
      node('change:MC-62', 'change', 'MC-62', '/browse/MC-62'),
      node('subject:legacyauth', 'subject', 'LegacyAuth'),
      node('step:98305:3', 'runbook-step', 'Step 3'),
      node(
        'page:98305',
        'runbook-page',
        'RB-AUTH-01 Sign-in recovery',
        '/wiki/spaces/OPS/pages/98305',
      ),
      node('step:98306:2', 'runbook-step', 'Step 2'),
      node('page:98306', 'runbook-page', 'RB-SSO-04 Partner sign-on'),
      node('service:signin', 'service', 'Customer sign-in'),
      node('team:identity', 'team', 'Identity Platform'),
    ],
    edges: [
      edge(
        'names',
        'change-names-subject',
        'change:MC-62',
        'subject:legacyauth',
        'confirmed',
        'jira',
        [changeQuote],
      ),
      edge(
        'dep3',
        'step-depends-on-subject',
        'step:98305:3',
        'subject:legacyauth',
        'confirmed',
        'm3-analysis',
        [changeQuote, stepQuote],
      ),
      edge('in3', 'step-in-page', 'step:98305:3', 'page:98305', 'confirmed', 'confluence', [
        stepQuote,
      ]),
      edge(
        'svc',
        'page-recovers-service',
        'page:98305',
        'service:signin',
        'confirmed',
        'teamwork-graph',
        [{ id: 'q-svc', origin: 'live', kind: 'jsm-service', title: 'Customer sign-in' }],
      ),
      edge(
        'own',
        'team-owns-service',
        'team:identity',
        'service:signin',
        'confirmed',
        'teamwork-graph',
        [{ id: 'q-own', origin: 'live', kind: 'jsm-service', title: 'Identity Platform' }],
      ),
      edge(
        'dep2',
        'step-depends-on-subject',
        'step:98306:2',
        'subject:legacyauth',
        'suspected',
        'm3-analysis',
        [
          {
            ...stepQuote,
            id: 'q-step2',
            title: 'RB-SSO-04, step 2',
            excerpt: 'Route partners through LegacyAuth.',
          },
        ],
      ),
      edge('in2', 'step-in-page', 'step:98306:2', 'page:98306', 'confirmed', 'confluence', [
        {
          ...stepQuote,
          id: 'q-page2',
          title: 'RB-SSO-04',
          excerpt: 'Route partners through LegacyAuth.',
        },
      ]),
    ],
    unassessed: [
      {
        from: 'page:98306',
        expected: 'service',
        source: 'jsm',
        reason: 'No service source is connected yet',
      },
      {
        from: 'page:98306',
        expected: 'team',
        source: 'teamwork-graph',
        reason: 'Teamwork Graph not connected',
      },
    ],
    sources: [
      { source: 'jira', status: 'used', detail: 'Read MC-62.' },
      { source: 'confluence', status: 'used', detail: '2 runbook pages read.' },
      { source: 'jsm', status: 'not-connected', detail: 'No service source is connected yet.' },
      { source: 'teamwork-graph', status: 'not-permitted', detail: 'The app may not read it.' },
    ],
    ...overrides,
  };
}

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

async function openCheck() {
  const user = userEvent.setup();
  renderInApp(<ReadinessPage />);
  await user.click(await screen.findByRole('button', { name: 'Check recovery impact of MC-62' }));
  const region = await screen.findByRole('region', { name: 'Impact path' });
  return { user, region };
}

const pathRow = (region: HTMLElement, name: RegExp) =>
  within(region).getByRole('listitem', { name });

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
  api.listRecentChanges.mockResolvedValue(
    changes([issue({ key: 'MC-62', summary: 'Retire LegacyAuth' })]),
  );
  api.analyzeChange.mockReset().mockResolvedValue(ok(ANALYSIS));
  api.getReadinessGraph.mockReset().mockResolvedValue(ok(graph()));
  vi.mocked(router.open).mockClear();
});

describe('Impact path', () => {
  it('runs the check once and shows the findings from the graph', async () => {
    const { region } = await openCheck();
    expect(api.getReadinessGraph).toHaveBeenCalledTimes(1);
    expect(api.getReadinessGraph).toHaveBeenCalledWith({ issueKey: 'MC-62' });
    expect(api.analyzeChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: '1 recovery step may depend on what MC-62 changes' }),
    ).toBeInTheDocument();
    expect(within(region).getByRole('heading', { name: 'LegacyAuth' })).toBeInTheDocument();
    expect(within(region).getByText('2 paths through 1 subject')).toBeInTheDocument();
  });

  it('states each link as confirmed or suspected in words, with its source', async () => {
    const { region } = await openCheck();
    const confirmed = pathRow(region, /^Path 1 of 2: Step 3/);
    const hops = within(confirmed).getAllByRole('listitem');
    expect(hops.map((h) => h.querySelector('.hop-kind')?.textContent)).toEqual([
      'Recovery step',
      'Runbook page',
      'Service',
      'Owning team',
    ]);
    expect(within(hops[0]!).getByText('Confirmed')).toBeInTheDocument();
    expect(within(hops[0]!).getByText('from Change analysis')).toBeInTheDocument();
    expect(within(hops[1]!).getByText('from Confluence')).toBeInTheDocument();
    expect(within(hops[2]!).getByText('Customer sign-in')).toBeInTheDocument();
    expect(within(hops[3]!).getByText('Identity Platform')).toBeInTheDocument();
    expect(within(hops[3]!).getByText('from Teamwork Graph')).toBeInTheDocument();

    const suspected = pathRow(region, /^Path 2 of 2: Step 2/);
    const step = within(suspected).getAllByRole('listitem')[0]!;
    expect(within(step).getByText('Suspected')).toBeInTheDocument();
    expect(within(step).queryByText('Confirmed')).toBeNull();
  });

  it('discloses the evidence behind a link with exact quotes and source links', async () => {
    const { user, region } = await openCheck();
    const row = pathRow(region, /^Path 1 of 2/);
    const toggle = within(row).getByRole('button', {
      name: 'Evidence (2) for Recovery step Step 3',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(row.querySelector('blockquote')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel).toBeVisible();
    expect(within(panel).getByText('Basis for dep3.')).toBeInTheDocument();
    const quotes = [...panel.querySelectorAll('blockquote')].map((q) => q.textContent);
    expect(quotes).toEqual([SUBJECT.excerpt, STEP_QUOTE]);

    await user.click(within(panel).getByRole('button', { name: 'Open MC-62 in Jira' }));
    expect(router.open).toHaveBeenLastCalledWith('https://example.atlassian.net/browse/MC-62');
    await user.click(
      within(panel).getByRole('button', { name: 'Open RB-AUTH-01, step 3 in Confluence' }),
    );
    expect(router.open).toHaveBeenLastCalledWith(
      'https://example.atlassian.net/wiki/spaces/OPS/pages/98305',
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel).not.toBeVisible();
  });

  it('toggles evidence from the keyboard with Enter and Space', async () => {
    const { user, region } = await openCheck();
    const toggle = within(pathRow(region, /^Path 2 of 2/)).getByRole('button', {
      name: 'Evidence for Recovery step Step 2',
    });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('Route partners through LegacyAuth.')[0]).toBeVisible();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('writes out unassessed service and team links with their reasons, never as nodes', async () => {
    const { region } = await openCheck();
    const row = pathRow(region, /^Path 2 of 2/);
    const [, , service, team] = within(row).getAllByRole('listitem');
    expect(service).toHaveTextContent(
      /^ServiceNot assessedNo service source is connected yet \(JSM\)$/,
    );
    expect(team).toHaveTextContent(/^Owning teamNot assessedTeamwork Graph not connected/);
    // No placeholder node, no evidence control, nothing that reads as healthy.
    expect(within(row).queryByText('Customer sign-in')).toBeNull();
    expect(within(service!).queryByRole('button')).toBeNull();
    expect(region.querySelector('[class*="success"]')).toBeNull();
    expect(within(region).queryByText(/healthy|\bready\b|passed|safe/i)).toBeNull();
  });

  it('shows no service or team names when the graph has none', async () => {
    const g = graph();
    api.getReadinessGraph.mockResolvedValue(
      ok({
        ...g,
        nodes: g.nodes.filter((n) => n.kind !== 'service' && n.kind !== 'team'),
        edges: g.edges.filter(
          (e) => e.kind !== 'page-recovers-service' && e.kind !== 'team-owns-service',
        ),
        unassessed: [],
      }),
    );
    const { region } = await openCheck();
    expect(within(region).queryByText('Customer sign-in')).toBeNull();
    expect(within(region).queryByText('Identity Platform')).toBeNull();
    const row = pathRow(region, /^Path 1 of 2/);
    const [, , service, team] = within(row).getAllByRole('listitem');
    expect(service).toHaveTextContent('No service link was returned for this runbook page.');
    expect(team).toHaveTextContent('there is no service to look up an owner for');
  });

  it('lists every source with its status in words', async () => {
    const { region } = await openCheck();
    const strip = within(region).getByRole('list', { name: 'Sources' });
    expect(
      within(strip)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'JiraUsedRead MC-62.',
      'ConfluenceUsed2 runbook pages read.',
      'JSMNot connectedNo service source is connected yet.',
      'Teamwork GraphNot permittedThe app may not read it.',
    ]);
  });

  it('fails on its own: the findings stay and only the graph is asked again', async () => {
    api.getReadinessGraph
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Graph build failed.', upstreamStatus: 502 },
      })
      .mockResolvedValueOnce(ok(graph()));
    const { user, region } = await openCheck();

    expect(await within(region).findByText('Graph build failed. (HTTP 502)')).toBeInTheDocument();
    // The M3 analysis comes from analyzeChange and stays on screen.
    expect(
      await screen.findByRole('heading', {
        name: '1 recovery step may depend on what MC-62 changes',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Coverage' })).toBeInTheDocument();
    expect(api.analyzeChange).toHaveBeenCalledTimes(1);

    await user.click(within(region).getByRole('button', { name: 'Try again' }));
    expect(await within(region).findByRole('heading', { name: 'LegacyAuth' })).toBeInTheDocument();
    expect(api.getReadinessGraph).toHaveBeenCalledTimes(2);
    expect(api.analyzeChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
  });

  it('says a confirmed link is a real dependency, not a sign that recovery works', async () => {
    const { region } = await openCheck();
    expect(
      within(region).getByText(
        /A confirmed link means the dependency is real, not that recovery still works\./,
      ),
    ).toBeInTheDocument();
    expect(within(region).getAllByText('Confirmed')[0]!.closest('.badge')).toHaveClass(
      'badge-warning',
    );
  });
});

describe('sourcePath', () => {
  it.each([
    ['/browse/MC-1', undefined, { path: '/browse/MC-1', product: 'Jira' }],
    [
      'https://example.atlassian.net/browse/MC-1',
      undefined,
      { path: '/browse/MC-1', product: 'Jira' },
    ],
    [
      '/wiki/spaces/OPS/pages/1',
      undefined,
      { path: '/wiki/spaces/OPS/pages/1', product: 'Confluence' },
    ],
    [
      '/spaces/OPS/pages/1',
      'runbook-step',
      { path: '/wiki/spaces/OPS/pages/1', product: 'Confluence' },
    ],
    ['/spaces/OPS/pages/1', 'jsm-service', null],
    ['//evil.example/browse/x', undefined, null],
    ['javascript:alert(1)', undefined, null],
    [undefined, undefined, null],
  ] as const)('%s (%s) becomes %o', (url, kind, expected) => {
    expect(sourcePath(url, kind)).toEqual(expected);
  });
});
