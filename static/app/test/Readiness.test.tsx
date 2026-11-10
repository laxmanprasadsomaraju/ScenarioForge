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
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  analyzeChange: vi.fn(),
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
      analyzedAt: new Date().toISOString(),
      status: 'findings',
      subjects: [SUBJECT],
      findings: [],
      coverage: { pagesFound: 4, pagesRead: 3, pagesWithoutSteps: 1, pagesSkipped: 1 },
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

  it('says no findings is not a readiness pass and shows the coverage', async () => {
    api.analyzeChange.mockResolvedValue(
      analysis({
        status: 'no-findings',
        coverage: { pagesFound: 5, pagesRead: 4, pagesWithoutSteps: 1, pagesSkipped: 1 },
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
        coverage: { pagesFound: 0, pagesRead: 0, pagesWithoutSteps: 0, pagesSkipped: 0 },
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

  it('keeps change rehearsal disabled and says when it arrives', async () => {
    api.analyzeChange.mockResolvedValue(analysis({ findings: [finding()] }));
    await openCheck();
    const rehearse = screen.getByRole('button', { name: 'Rehearse this change' });
    expect(rehearse).toBeDisabled();
    expect(rehearse).toHaveAccessibleDescription('Change-specific rehearsals arrive in M5');
    expect(screen.getByText('Change-specific rehearsals arrive in M5')).toBeVisible();
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
    await user.click(nav.getByRole('link', { name: 'Overview' }));
    await user.click(nav.getByRole('link', { name: 'Readiness checks' }));
    expect(
      await screen.findByRole('table', { name: 'Recent Jira changes to check' }),
    ).toBeInTheDocument();
  });

  it('points the overview findings region at readiness checks without running one', async () => {
    const user = userEvent.setup();
    render(<App />);
    const findings = await screen.findByRole('region', { name: 'Findings' });
    expect(within(findings).getByText(/Nothing is checked automatically/)).toBeInTheDocument();
    await user.click(within(findings).getByRole('button', { name: 'Open readiness checks' }));
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
