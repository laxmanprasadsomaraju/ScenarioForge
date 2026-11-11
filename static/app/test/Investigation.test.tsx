import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisCoverage, ChangeAnalysis } from '@shared/analysis/types';
import type { ReadinessGraph, SourceStatus } from '@shared/graph/types';
import type { RemoteState } from '../src/lib/useApi';
import { NotChecked } from '../src/components/readiness/NotChecked';
import { AnalysisStatement } from '../src/components/readiness/Analysis';
import { ChangesPage } from '../src/pages/Changes';
import { RecoveryPlansPage } from '../src/pages/RecoveryPlans';
import { changes, issue, renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  listRecoveryPages: vi.fn(),
  getRecoveryProcedure: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

const JQL = 'updated >= -30d ORDER BY updated DESC';
const CQL = 'type = page AND text ~ "runbook"';

const coverage = (o: Partial<AnalysisCoverage> = {}): AnalysisCoverage => ({
  pagesFound: 4,
  pagesRead: 4,
  pagesWithoutSteps: 0,
  pagesSkipped: 0,
  pagesChecked: [],
  ...o,
});

const graphWith = (sources: SourceStatus[]): RemoteState<ReadinessGraph> => ({
  status: 'ready',
  data: { sources } as unknown as ReadinessGraph,
});

const ALWAYS = 'Pages the recovery search did not return, and pages you cannot view in Confluence.';

function gaps() {
  const region = screen.getByRole('region', { name: 'What was not checked' });
  return within(region)
    .getAllByRole('listitem')
    .map((li) => li.textContent);
}

describe('What was not checked', () => {
  it('always names the pages outside the search, even with full coverage', () => {
    render(<NotChecked coverage={coverage()} graph={graphWith([])} />);
    expect(gaps()).toEqual([ALWAYS]);
  });

  it('lists skipped pages and pages without numbered steps', () => {
    render(
      <NotChecked
        coverage={coverage({ pagesSkipped: 2, pagesWithoutSteps: 1 })}
        graph={{ status: 'loading' }}
      />,
    );
    expect(gaps()).toEqual([
      '2 runbooks were found but not read, because of limits, errors or permissions.',
      '1 runbook has no numbered steps, so no step in it was compared.',
      ALWAYS,
    ]);
  });

  it('names every source the graph could not use, and skips used ones', () => {
    render(
      <NotChecked
        coverage={coverage()}
        graph={graphWith([
          { source: 'jira', status: 'used', detail: '' },
          { source: 'jsm', status: 'not-connected', detail: '' },
          { source: 'teamwork-graph', status: 'not-permitted', detail: '' },
          { source: 'confluence', status: 'error', detail: '' },
          { source: 'm3-analysis' as SourceStatus['source'], status: 'not-queried', detail: '' },
        ])}
      />,
    );
    expect(gaps()).toEqual([
      'JSM is not connected.',
      'Teamwork Graph may not be read by the app.',
      'Confluence returned an error.',
      'Change analysis was not asked.',
      ALWAYS,
    ]);
  });

  it('says services and teams were not traced when the graph fails', () => {
    render(
      <NotChecked
        coverage={coverage()}
        graph={{ status: 'error', error: { code: 'UPSTREAM_ERROR', message: 'x' } }}
      />,
    );
    expect(gaps()[0]).toBe(
      'The impact path could not be built, so services and owning teams were not traced.',
    );
  });

  it('is marked not assessed and never uses success styling', () => {
    const { container } = render(
      <NotChecked coverage={coverage({ pagesSkipped: 1 })} graph={graphWith([])} />,
    );
    expect(screen.getByText('Not assessed').closest('.badge')).toHaveClass('badge-unknown');
    expect(container.querySelector('[class*="success"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\bready\b|passed|safe/i);
  });
});

const analysis = (o: Partial<ChangeAnalysis>): ChangeAnalysis =>
  ({
    changeKey: 'MC-1',
    change: { key: 'MC-1', summary: 's', browsePath: '/browse/MC-1' },
    analyzedAt: new Date().toISOString(),
    status: 'findings',
    subjects: [],
    findings: [],
    coverage: coverage({ pagesFound: 5, pagesRead: 3 }),
    ...o,
  }) as ChangeAnalysis;

const f = (id: string, confidence: 'confirmed' | 'suspected', stepOrder: number) =>
  ({ id, confidence, pageId: 'p', stepOrder }) as ChangeAnalysis['findings'][0];

describe('Verdict header', () => {
  it('counts confirmed and suspected findings and the runbooks read', () => {
    render(
      <AnalysisStatement
        analysis={analysis({
          findings: [f('a', 'confirmed', 1), f('b', 'confirmed', 2), f('c', 'suspected', 3)],
        })}
      />,
    );
    expect(screen.getByText('2 confirmed, explicit link').closest('.badge')).toHaveClass(
      'badge-warning',
    );
    expect(screen.getByText('1 suspected, text match').closest('.badge')).toHaveClass(
      'badge-suspected',
    );
    expect(screen.getByText('Read 3 of 5 runbooks found')).toBeInTheDocument();
  });

  it('omits a count badge that would be zero', () => {
    render(<AnalysisStatement analysis={analysis({ findings: [f('a', 'suspected', 1)] })} />);
    expect(screen.queryByText(/confirmed, explicit link/)).toBeNull();
  });

  it('shows no findings in grey, never as a pass', () => {
    const { container } = render(
      <AnalysisStatement analysis={analysis({ status: 'no-findings' })} />,
    );
    expect(screen.getByText('No findings in checked sources').closest('.badge')).toHaveClass(
      'badge-unknown',
    );
    expect(container.querySelector('[class*="success"]')).toBeNull();
  });

  it('keeps the coverage line on a not-assessed result', () => {
    render(
      <AnalysisStatement
        analysis={analysis({ status: 'not-assessed', notAssessedReason: 'No subject.' })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Not assessed' })).toBeInTheDocument();
    expect(screen.getByText('Read 3 of 5 runbooks found')).toBeInTheDocument();
  });
});

async function expectQueryToggle(query: string) {
  const user = userEvent.setup();
  const toggle = await screen.findByRole('button', { name: 'Show query' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const code = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(code).not.toBeVisible();
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveTextContent('Hide query');
  expect(code).toBeVisible();
  expect(code.textContent).toBe(query);
}

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'T', checkedAt: new Date().toISOString() },
  });
});

describe('Show query', () => {
  it('collapses the JQL on Changes', async () => {
    api.listRecentChanges.mockResolvedValue(changes([issue({ key: 'SF-1' })]));
    renderInApp(<ChangesPage />);
    await expectQueryToggle(JQL);
  });

  it('collapses the JQL in the Changes empty state', async () => {
    api.listRecentChanges.mockResolvedValue(changes([]));
    renderInApp(<ChangesPage />);
    await screen.findByText('No issues you can see were updated in this window');
    await expectQueryToggle(JQL);
  });

  it('collapses the CQL on Runbooks', async () => {
    api.listRecoveryPages.mockResolvedValue({
      ok: true,
      data: {
        pages: [{ id: '1', title: 'RB-1', spaceKey: 'OPS', lastUpdated: null, webuiPath: '/x' }],
        truncated: false,
        fetchedAt: new Date().toISOString(),
        cql: CQL,
      },
    });
    renderInApp(<RecoveryPlansPage />);
    await expectQueryToggle(CQL);
  });
});

describe('Runbook page', () => {
  const PAGE = { id: '1', title: 'RB-1', spaceKey: 'OPS', lastUpdated: null, webuiPath: '/x' };
  const procedure = (o: object) => ({
    ok: true,
    data: {
      pageId: '1',
      title: 'RB-1',
      spaceId: '1',
      lastUpdated: null,
      webuiPath: '/x',
      excerpt: 'Text.',
      excerptTruncated: false,
      steps: [],
      stepSource: 'ordered-list',
      evidence: { id: 'e', origin: 'live', kind: 'confluence-page', title: 'RB-1' },
      ...o,
    },
  });

  beforeEach(() => {
    api.listRecoveryPages.mockResolvedValue({
      ok: true,
      data: { pages: [PAGE], truncated: false, fetchedAt: new Date().toISOString(), cql: CQL },
    });
  });

  it('shows numbered step rows with a count', async () => {
    api.getRecoveryProcedure.mockResolvedValue(
      procedure({
        steps: [
          { order: 1, instruction: 'Confirm.', dependsOn: [] },
          { order: 2, instruction: 'Fail over.', dependsOn: [] },
        ],
      }),
    );
    renderInApp(<RecoveryPlansPage />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'RB-1' }));
    expect(await screen.findByText('2 numbered steps, in page order')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/arrives in M\d/)).toBeNull();
  });

  it('warns in grey when the page has no numbered steps', async () => {
    api.getRecoveryProcedure.mockResolvedValue(procedure({ stepSource: 'none' }));
    renderInApp(<RecoveryPlansPage />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'RB-1' }));
    const badge = await screen.findByText('No numbered steps');
    expect(badge.closest('.badge')).toHaveClass('badge-unknown');
    expect(screen.getByText(/Readiness checks cannot compare a change against it/)).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
