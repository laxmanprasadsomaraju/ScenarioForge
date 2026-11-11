import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '@forge/bridge';
import type { ApiResult } from '@shared/api';
import type { ChangeAnalysis, ChangeRecoveryFinding, ChangeSubject } from '@shared/analysis/types';
import { App } from '../src/App';
import { ReadinessPage } from '../src/pages/Readiness';
import { confluencePath } from '../src/components/readiness/Analysis';
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
  replacement: 'NimbusID',
};

function finding(overrides: Partial<ChangeRecoveryFinding> = {}): ChangeRecoveryFinding {
  return {
    id: 'f1',
    changeKey: 'MC-12',
    pageId: '1001',
    pageTitle: 'RB-AUTH-01 Customer sign-in recovery',
    stepOrder: 3,
    pageWebuiPath: null,
    subject: SUBJECT,
    confidence: 'confirmed',
    basis: ['term-match', 'page-mentions-issue'],
    explanation: 'Step 3 names LegacyAuth, which MC-12 retires.',
    aiAssisted: false,
    evidence: [
      { id: 'e1', origin: 'live', kind: 'jira-issue', title: 'MC-12', excerpt: SUBJECT.excerpt },
      {
        id: 'e2',
        origin: 'live',
        kind: 'runbook-step',
        title: 'RB-AUTH-01, step 3',
        excerpt: 'Fail over:  authctl failover --target legacyauth',
        url: '/spaces/OPS/pages/1001',
      },
    ],
    ...overrides,
  };
}

function analysis(overrides: Partial<ChangeAnalysis> = {}): ApiResult<ChangeAnalysis> {
  return {
    ok: true,
    data: {
      changeKey: 'MC-12',
      change: {
        key: 'MC-12',
        summary: 'Retire LegacyAuth backup SSO tenant',
        browsePath: '/browse/MC-12',
      },
      analyzedAt: new Date().toISOString(),
      status: 'findings',
      subjects: [SUBJECT],
      findings: [],
      coverage: {
        pagesFound: 4,
        pagesRead: 3,
        pagesWithoutSteps: 1,
        pagesSkipped: 1,
        pagesChecked: [],
      },
      ...overrides,
    },
  };
}

const MC12 = issue({ key: 'MC-12', summary: 'Retire LegacyAuth backup SSO tenant' });

/** Renders the readiness screen and opens the check for MC-12 from its row. */
async function openCheck() {
  const user = userEvent.setup();
  renderInApp(<ReadinessPage />);
  await user.click(await screen.findByRole('button', { name: 'Check recovery impact of MC-12' }));
  return user;
}

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
  api.listRecentChanges.mockResolvedValue(changes([MC12, issue({ key: 'MC-9' })]));
  api.analyzeChange.mockReset();
  // These tests cover the M3 findings on their own: the readiness graph is
  // unavailable, so the screen falls back to analyzeChange. The graph path
  // (one run, findings read from the graph) is covered in ImpactPath.test.tsx.
  api.getReadinessGraph.mockReset().mockResolvedValue({
    ok: false,
    error: { code: 'NOT_FOUND', message: 'The impact path is not available for this change.' },
  });
});

describe('Readiness checks', () => {
  it('lists recent changes as live data and runs nothing until asked', async () => {
    renderInApp(<ReadinessPage />);
    expect(screen.getByText('Live Jira and Confluence data')).toBeInTheDocument();
    expect(
      await screen.findByRole('table', { name: 'Recent Jira changes to check' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check recovery impact of MC-9' })).toBeVisible();
    expect(api.analyzeChange).not.toHaveBeenCalled();
  });

  it('renders findings with confirmed and suspected stated in words', async () => {
    api.analyzeChange.mockResolvedValue(
      analysis({
        findings: [
          finding(),
          finding({
            id: 'f2',
            pageId: '1003',
            pageTitle: 'RB-SSO-04 Partner sign-on outage',
            stepOrder: 2,
            confidence: 'suspected',
            basis: ['term-match'],
          }),
        ],
      }),
    );
    await openCheck();

    expect(api.analyzeChange).toHaveBeenCalledWith({ issueKey: 'MC-12' });
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '2 recovery steps may depend on what MC-12 changes',
      }),
    ).toHaveFocus();
    expect(
      screen.getByText('1 finding confirmed by an explicit link, 1 suspected from a text match.'),
    ).toBeInTheDocument();

    const confirmed = screen.getByRole('listitem', {
      name: 'Step 3 of RB-AUTH-01 Customer sign-in recovery',
    });
    expect(within(confirmed).getByText('Confirmed — explicit link')).toBeInTheDocument();
    expect(within(confirmed).getByText('The step text names “LegacyAuth”.')).toBeInTheDocument();
    expect(within(confirmed).getByText('The runbook page mentions MC-12.')).toBeInTheDocument();
    expect(
      within(confirmed).getByText('Step 3 names LegacyAuth, which MC-12 retires.'),
    ).toBeInTheDocument();
    // Quotes appear exactly as returned, whitespace included.
    const quotes = confirmed.querySelectorAll('blockquote');
    expect(quotes[0]?.textContent).toBe(SUBJECT.excerpt);
    expect(quotes[1]?.textContent).toBe('Fail over:  authctl failover --target legacyauth');

    const suspected = screen.getByRole('listitem', {
      name: 'Step 2 of RB-SSO-04 Partner sign-on outage',
    });
    expect(within(suspected).getByText('Suspected — text match')).toBeInTheDocument();
    expect(within(suspected).queryByText(/Confirmed/)).toBeNull();

    // Subjects detected: term, action, replacement and the verbatim sentence.
    const subjects = screen.getByRole('region', { name: 'Subjects detected' });
    expect(within(subjects).getByText('LegacyAuth')).toBeInTheDocument();
    expect(within(subjects).getByText('Retires, replaced by NimbusID')).toBeInTheDocument();
  });

  it('opens evidence sources in Jira and Confluence through the Forge router', async () => {
    api.analyzeChange.mockResolvedValue(analysis({ findings: [finding()] }));
    const user = await openCheck();
    const item = await screen.findByRole('listitem', {
      name: 'Step 3 of RB-AUTH-01 Customer sign-in recovery',
    });

    vi.mocked(router.open).mockClear();
    await user.click(within(item).getByRole('button', { name: 'Open MC-12 in Jira' }));
    expect(router.open).toHaveBeenLastCalledWith('https://example.atlassian.net/browse/MC-12');

    await user.click(within(item).getByRole('button', { name: 'Open runbook in Confluence' }));
    expect(router.open).toHaveBeenLastCalledWith(
      'https://example.atlassian.net/wiki/spaces/OPS/pages/1001',
    );
  });

  it('links the runbook from the finding page path and lists exactly the pages checked', async () => {
    api.analyzeChange.mockResolvedValue(
      analysis({
        findings: [finding({ pageWebuiPath: '/spaces/SFDEMO/pages/98305/RB-AUTH-01' })],
        change: {
          key: 'MC-12',
          summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
          browsePath: '/browse/MC-12',
        },
        coverage: {
          pagesFound: 2,
          pagesRead: 2,
          pagesWithoutSteps: 1,
          pagesSkipped: 0,
          pagesChecked: [
            {
              pageId: '98305',
              title: '[DEMO] RB-AUTH-01',
              webuiPath: '/spaces/SFDEMO/pages/98305/RB-AUTH-01',
              stepSource: 'ordered-list',
            },
            { pageId: '98307', title: '[DEMO] Notes', webuiPath: null, stepSource: 'none' },
          ],
        },
      }),
    );
    const user = await openCheck();
    const item = await screen.findByRole('listitem', {
      name: 'Step 3 of RB-AUTH-01 Customer sign-in recovery',
    });
    // The header shows the change as the analysis read it from Jira.
    expect(screen.getByText('[DEMO] Retire LegacyAuth backup SSO tenant')).toBeInTheDocument();

    vi.mocked(router.open).mockClear();
    await user.click(within(item).getByRole('button', { name: 'Open runbook in Confluence' }));
    expect(router.open).toHaveBeenLastCalledWith(
      'https://example.atlassian.net/wiki/spaces/SFDEMO/pages/98305/RB-AUTH-01',
    );

    const checked = screen.getByRole('heading', { name: 'Pages checked' }).nextElementSibling!;
    const rows = within(checked as HTMLElement).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      '[DEMO] RB-AUTH-01Steps checked',
      '[DEMO] NotesNo numbered steps; not checked',
    ]);
    await user.click(
      within(checked as HTMLElement).getByRole('button', {
        name: 'Open [DEMO] RB-AUTH-01 in Confluence (new tab)',
      }),
    );
    expect(router.open).toHaveBeenLastCalledWith(
      'https://example.atlassian.net/wiki/spaces/SFDEMO/pages/98305/RB-AUTH-01',
    );
  });

  it('says no findings is not a readiness pass and shows the coverage', async () => {
    api.analyzeChange.mockResolvedValue(
      analysis({
        status: 'no-findings',
        coverage: {
          pagesFound: 5,
          pagesRead: 4,
          pagesWithoutSteps: 1,
          pagesSkipped: 1,
          pagesChecked: [],
        },
      }),
    );
    await openCheck();

    expect(
      await screen.findByRole('heading', { name: 'No conflicts found in 4 runbooks read' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/This is not a readiness pass\./)).toBeInTheDocument();
    const coverage = screen.getByRole('region', { name: 'Coverage' });
    const facts = Object.fromEntries(
      within(coverage)
        .getAllByRole('term')
        .map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
    );
    expect(facts).toMatchObject({
      'Runbooks found': '5',
      Read: '4',
      'Read without numbered steps': '1',
      'Not read': '1',
    });
    expect(screen.queryByText(/\bready\b|passed|safe/i)).toBeNull();
    expect(document.querySelector('[class*="success"]')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Findings' })).toBeNull();
  });

  it('shows not-assessed with its reason and nothing that reads as success', async () => {
    api.analyzeChange.mockResolvedValue(
      analysis({
        status: 'not-assessed',
        notAssessedReason: 'No retirement or replacement was recognised in the change text.',
        subjects: [],
        coverage: {
          pagesFound: 0,
          pagesRead: 0,
          pagesWithoutSteps: 0,
          pagesSkipped: 0,
          pagesChecked: [],
        },
      }),
    );
    await openCheck();

    expect(await screen.findByRole('heading', { name: 'Not assessed' })).toBeInTheDocument();
    expect(
      screen.getByText('No retirement or replacement was recognised in the change text.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No conflicts|\bready\b|passed|safe/i)).toBeNull();
    // Only the origin label may use the live (green) tone; the result never does.
    const success = [...document.querySelectorAll('[class*="success"]')];
    expect(success.every((el) => el.classList.contains('origin-live'))).toBe(true);
  });

  it('shows a product-aware error with retry instead of any result', async () => {
    api.analyzeChange
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Timed out.', upstreamStatus: 504 },
      })
      .mockResolvedValueOnce(analysis({ status: 'no-findings' }));
    const user = await openCheck();

    expect(await screen.findByText('Jira or Confluence could not be reached')).toBeInTheDocument();
    expect(screen.getByText('Timed out. (HTTP 504)')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Coverage' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'No conflicts found in 3 runbooks read' }),
    ).toBeInTheDocument();
    expect(api.analyzeChange).toHaveBeenCalledTimes(2);
  });

  it('asks for a restore target before rehearsing a finding', async () => {
    api.analyzeChange.mockResolvedValue(analysis({ findings: [finding()] }));
    const user = await openCheck();
    const rehearse = await screen.findByRole('button', { name: 'Rehearse this finding' });
    expect(rehearse).toBeDisabled();
    const target = screen.getByRole('textbox', { name: 'Restore target (minutes)' });
    await user.type(target, '3');
    expect(screen.getByText('Enter whole minutes from 5 to 1440.')).toBeInTheDocument();
    expect(rehearse).toBeDisabled();
    await user.clear(target);
    await user.type(target, '30');
    expect(rehearse).toBeEnabled();
  });

  it('returns to the list from the analysis', async () => {
    api.analyzeChange.mockResolvedValue(analysis({ status: 'no-findings' }));
    const user = await openCheck();
    await user.click(await screen.findByRole('button', { name: 'Back to recent changes' }));
    expect(
      await screen.findByRole('table', { name: 'Recent Jira changes to check' }),
    ).toBeInTheDocument();
  });
});

describe('Entry from the Changes page', () => {
  it('opens the readiness check for the row it was pressed on', async () => {
    api.analyzeChange.mockResolvedValue(analysis({ findings: [finding()] }));
    const user = userEvent.setup();
    render(<App />);
    const nav = within(screen.getByRole('navigation', { name: 'ScenarioForge' }));
    await user.click(nav.getByRole('link', { name: 'Changes' }));
    await screen.findByRole('table', { name: 'Jira issues updated recently' });

    await user.click(screen.getByRole('button', { name: 'Check recovery impact of MC-12' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Readiness check' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Retire LegacyAuth backup SSO tenant')).toBeInTheDocument();
    expect(nav.getByRole('link', { current: 'page' })).toHaveTextContent('Readiness checks');
    await waitFor(() => expect(api.analyzeChange).toHaveBeenCalledWith({ issueKey: 'MC-12' }));
    expect(
      await screen.findByRole('heading', {
        name: '1 recovery step may depend on what MC-12 changes',
      }),
    ).toBeInTheDocument();

    // Leaving the screen drops the selection: coming back shows the list.
    await user.click(nav.getByRole('link', { name: 'Command center' }));
    await user.click(nav.getByRole('link', { name: 'Readiness checks' }));
    expect(
      await screen.findByRole('table', { name: 'Recent Jira changes to check' }),
    ).toBeInTheDocument();
  });

  it('offers a first check from the Command center without running one', async () => {
    const user = userEvent.setup();
    render(<App />);
    const next = await screen.findByRole('region', { name: 'Next action' });
    expect(within(next).getByText('Pick a change to check')).toBeInTheDocument();
    await user.click(within(next).getByRole('button', { name: 'Check a recent change' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Readiness checks' }),
    ).toBeInTheDocument();
    expect(api.analyzeChange).not.toHaveBeenCalled();
  });
});

describe('confluencePath', () => {
  it.each([
    ['/spaces/OPS/pages/1', '/wiki/spaces/OPS/pages/1'],
    ['/wiki/spaces/OPS/pages/1', '/wiki/spaces/OPS/pages/1'],
    ['https://example.atlassian.net/wiki/spaces/OPS/pages/1', '/wiki/spaces/OPS/pages/1'],
    ['//evil.example/x', null],
    ['javascript:alert(1)', null],
    [undefined, null],
  ])('%s becomes %s', (input, expected) => {
    expect(confluencePath(input)).toBe(expected);
  });
});
