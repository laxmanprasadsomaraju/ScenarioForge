import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { view } from '@forge/bridge';
import { analyzeChange } from '@shared/analysis';
import type { ChangeEvidence, RunbookEvidence } from '@shared/analysis/types';
import type { ApiResult } from '@shared/api';
import { buildGraphFromAnalysis } from '@shared/graph/build';
import { readinessLinkPath, rehearsalLinkPath } from '@shared/links/deepLink';
import { App } from '../src/App';
import { changes, issue } from './helpers';

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
  listRecoveryPages: vi.fn(),
  getRecoveryProcedure: vi.fn(),
  analyzeChange: vi.fn(),
  getReadinessGraph: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

const AT = '2026-11-10T09:00:00.000Z';
const STEP3 =
  'If the primary IdP is unavailable for more than 5 minutes, run authctl failover --target legacyauth.';

// The live M3 test texts, analysed by the real engine, so finding ids are real.
const change: ChangeEvidence = {
  origin: 'live',
  key: 'MC-62',
  summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
  descriptionText:
    'We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.',
  status: 'To Do',
  issueType: 'Task',
  updated: AT,
  browsePath: '/browse/MC-62',
  remoteLinks: [],
  retrievedAt: AT,
};
const runbook: RunbookEvidence = {
  origin: 'live',
  pageId: '98305',
  title: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
  webuiPath: '/spaces/SFDEMO/pages/98305/RB-AUTH-01',
  lastUpdated: AT,
  steps: [
    { order: 1, instruction: 'Check the primary IdP status page.', dependsOn: [] },
    { order: 3, instruction: STEP3, dependsOn: [] },
  ],
  stepSource: 'ordered-list',
  text: `Synthetic runbook. ${STEP3}`,
  retrievedAt: AT,
};
const analysis = analyzeChange(change, [runbook], AT);
const FINDING = 'MC-62:98305:3:legacyauth';
const ABSENT = 'MC-62:98305:9:legacyauth';
const FORBIDDEN: ApiResult<never> = {
  ok: false,
  error: { code: 'FORBIDDEN', message: 'You do not have permission to view MC-62.' },
};

/** In-memory stand-in for Forge's `view.createHistory()` (history v5 shape). */
function fakeHistory(initial: string) {
  const entries = [initial];
  let index = 0;
  const listeners = new Set<(location: { pathname: string; search: string }) => void>();
  const location = () => {
    const path = entries[index]!;
    const q = path.indexOf('?');
    return q < 0
      ? { pathname: path, search: '' }
      : { pathname: path.slice(0, q), search: path.slice(q) };
  };
  const emit = () => listeners.forEach((fn) => fn(location()));
  return {
    get location() {
      return location();
    },
    get path() {
      return entries[index]!;
    },
    push: vi.fn((path: string) => {
      entries.splice(index + 1, entries.length, path);
      index = entries.length - 1;
      emit();
    }),
    back: () => {
      index = Math.max(0, index - 1);
      emit();
    },
    forward: () => {
      index = Math.min(entries.length - 1, index + 1);
      emit();
    },
    listen: (fn: (location: { pathname: string; search: string }) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function openAt(path: string) {
  const history = fakeHistory(path);
  vi.mocked(view.createHistory).mockImplementation(() => Promise.resolve(history as never));
  render(<App />);
  return history;
}

// Screens are lazy chunks; load them up front so the first test sees a settled tree.
beforeAll(async () => {
  await Promise.all([import('../src/pages/Readiness'), import('../src/pages/Simulations')]);
});

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: AT },
  });
  api.listRecentChanges.mockResolvedValue(
    changes([issue({ key: 'MC-62', summary: change.summary, issueType: 'Task' })]),
  );
  api.getReadinessGraph
    .mockReset()
    .mockResolvedValue({ ok: true, data: buildGraphFromAnalysis(analysis, AT) });
  api.analyzeChange.mockReset().mockResolvedValue({ ok: true, data: analysis });
});

afterEach(() => {
  vi.mocked(view.createHistory).mockImplementation(() =>
    Promise.reject(new Error('No Forge history in tests')),
  );
});

describe('readiness links', () => {
  it('fixture finding id is the engine id the links use', () => {
    expect(analysis.findings.map((f) => f.id)).toContain(FINDING);
  });

  it('opens the check for the linked change with the normal run', async () => {
    openAt(readinessLinkPath('MC-62'));
    // Overview (which has its own "Findings" heading) paints until Forge's history resolves.
    expect(await screen.findByText(/1 recovery step may depend on what MC-62/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(api.getReadinessGraph).toHaveBeenCalledWith({ issueKey: 'MC-62' });
    expect(screen.getByRole('heading', { level: 1, name: 'Readiness check' })).toBeInTheDocument();
    expect(screen.queryByText('Opened from a link')).not.toBeInTheDocument();
  });

  it('scrolls to and focuses the linked finding once the user’s own result has it', async () => {
    openAt(readinessLinkPath('MC-62', FINDING));
    await screen.findByText('Opened from a link');
    const item = screen.getByText('Opened from a link').closest('li')!;
    await waitFor(() => expect(item).toHaveFocus());
    expect(item).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText(/Filled in from a link/)).toBeInTheDocument();
    // Only the finding is filled in; a readiness link carries no targets.
    expect(screen.getByRole('textbox', { name: 'Restore target (minutes)' })).toHaveValue('');
  });

  it('says so when the linked finding is not in the user’s result, and shows that result', async () => {
    openAt(readinessLinkPath('MC-62', ABSENT));
    expect(
      await screen.findByText(
        /This link points to a finding that is not in your current result for MC-62/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.queryByText('Opened from a link')).not.toBeInTheDocument();
    expect(screen.queryByText(/Filled in from a link/)).not.toBeInTheDocument();
  });
});

describe('rehearsal links', () => {
  const LINK = rehearsalLinkPath({ change: 'MC-62', finding: FINDING, restore: 30, notify: 10 });

  it('runs the normal check, fills in the form and waits for the user', async () => {
    const history = openAt(LINK);
    expect(await screen.findByText('Opened from a link')).toBeInTheDocument();
    expect(api.getReadinessGraph).toHaveBeenCalledWith({ issueKey: 'MC-62' });
    expect(screen.getByRole('textbox', { name: 'Restore target (minutes)' })).toHaveValue('30');
    expect(screen.getByRole('textbox', { name: /Notify target/ })).toHaveValue('10');
    expect(screen.getByText(/Nothing runs until you press Rehearse this finding/)).toBeVisible();
    // No auto-start: no rehearsal, no session, no briefing.
    expect(screen.queryByRole('button', { name: 'Start rehearsal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your options' })).not.toBeInTheDocument();
    expect(history.push).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Rehearse this finding' }));
    expect(await screen.findByText('Modelled from MC-62')).toBeInTheDocument();
    expect(history.path).toBe('/simulations');
    expect(screen.getByText(/Notify stakeholders within 10 minutes/)).toBeInTheDocument();
    // Still the briefing: the run itself starts only on Start rehearsal.
    expect(screen.getByRole('button', { name: 'Start rehearsal' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your options' })).not.toBeInTheDocument();
  });

  it('never fabricates a finding the user’s result does not contain', async () => {
    openAt(rehearsalLinkPath({ change: 'MC-62', finding: ABSENT, restore: 30 }));
    expect(
      await screen.findByText(
        /This link points to a finding that is not in your current result for MC-62/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Restore target (minutes)' })).toHaveValue('');
    expect(screen.queryByText(/Filled in from a link/)).not.toBeInTheDocument();
    expect(screen.queryByText(ABSENT)).not.toBeInTheDocument();
  });
});

describe('links never bypass permissions', () => {
  it.each([
    ['readiness', readinessLinkPath('MC-62', FINDING)],
    [
      'rehearsal',
      rehearsalLinkPath({ change: 'MC-62', finding: FINDING, restore: 30, notify: 10 }),
    ],
  ])(
    'a forbidden %s check shows the permission error and nothing from the link',
    async (_, path) => {
      api.getReadinessGraph.mockResolvedValue(FORBIDDEN);
      api.analyzeChange.mockResolvedValue(FORBIDDEN);
      openAt(path);
      expect(
        await screen.findByText('You do not have permission to view this content'),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'MC-62 was not checked' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Findings' })).not.toBeInTheDocument();
      expect(screen.queryByText('Opened from a link')).not.toBeInTheDocument();
      expect(screen.queryByText(/not in your current result/)).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Restore target (minutes)' })).toBeNull();
      expect(screen.queryByText(STEP3)).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain(FINDING);
    },
  );

  it.each([
    ['readiness', `/readiness-checks?change=MC-63&finding=${encodeURIComponent(FINDING)}`],
    ['rehearsal', `/simulations?change=MC-63&finding=${encodeURIComponent(FINDING)}&restore=30`],
  ])('rejects a %s link whose finding belongs to another change', async (_, path) => {
    openAt(path);
    expect(await screen.findByText('This link could not be opened')).toBeInTheDocument();
    expect(
      screen.getByText(/not a finding of MC-63\. Nothing from it was applied\./),
    ).toBeVisible();
    expect(api.getReadinessGraph).not.toHaveBeenCalled();
    expect(api.analyzeChange).not.toHaveBeenCalled();
  });

  it('shows a notice and the default readiness screen for a malformed link', async () => {
    openAt('/readiness-checks?change=MC-62&change=MC-63');
    expect(await screen.findByText('This link could not be opened')).toBeInTheDocument();
    expect(
      await screen.findByRole('table', { name: 'Recent Jira changes to check' }),
    ).toBeInTheDocument();
    expect(api.getReadinessGraph).not.toHaveBeenCalled();
  });

  it('shows a notice and the default rehearsal screen for a malformed link', async () => {
    openAt(`/simulations?change=MC-62&finding=${encodeURIComponent(FINDING)}&restore=9999`);
    expect(await screen.findByText('This link could not be opened')).toBeInTheDocument();
    expect(screen.getByText(/whole minutes from 5 to 1440/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start rehearsal' })).toBeInTheDocument();
    expect(screen.getByText('Synthetic demo data')).toBeInTheDocument();
    expect(api.getReadinessGraph).not.toHaveBeenCalled();
  });
});

describe('URL sync and back/forward', () => {
  it('pushes the canonical path and follows back/forward', async () => {
    const user = userEvent.setup();
    const history = openAt('/readiness-checks');
    // The Command center (which has the same row action) paints until Forge's history resolves.
    await screen.findByRole('table', { name: 'Recent Jira changes to check' });
    await user.click(screen.getByRole('button', { name: 'Check recovery impact of MC-62' }));
    expect(history.path).toBe('/readiness-checks?change=MC-62');
    await screen.findByRole('heading', { name: 'Findings' });
    // The row the user picked fills the header while nothing else is known.
    expect(screen.getAllByText(change.summary).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Back to recent changes' }));
    expect(history.path).toBe('/readiness-checks');
    await screen.findByRole('table', { name: 'Recent Jira changes to check' });

    act(() => history.back());
    expect(await screen.findByRole('heading', { name: 'Findings' })).toBeInTheDocument();

    act(() => history.forward());
    expect(
      await screen.findByRole('table', { name: 'Recent Jira changes to check' }),
    ).toBeInTheDocument();
  });

  it('follows a link pushed while the app is open', async () => {
    const history = openAt('/');
    const nav = within(await screen.findByRole('navigation', { name: 'ScenarioForge' }));
    expect(nav.getByRole('link', { name: /Command center/ })).toBeInTheDocument();
    act(() => history.push(readinessLinkPath('MC-62', FINDING)));
    expect(await screen.findByText('Opened from a link')).toBeInTheDocument();
    act(() => history.back());
    await waitFor(() => expect(screen.queryByText('Opened from a link')).not.toBeInTheDocument());
  });
});
