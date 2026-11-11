import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { view } from '@forge/bridge';
import { analyzeChange } from '@shared/analysis';
import type { ChangeEvidence, RunbookEvidence } from '@shared/analysis/types';
import { buildGraphFromAnalysis } from '@shared/graph/build';
import { rehearsalLinkPath } from '@shared/links/deepLink';
import { App } from '../src/App';
import { changes, issue } from './helpers';

const api = vi.hoisted(() => ({
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
  saveRehearsalRun: vi.fn(),
  saveRetest: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

const AT = '2026-11-10T09:00:00.000Z';
const STEP3 =
  'If the primary IdP is unavailable for more than 5 minutes, run authctl failover --target legacyauth.';
const change: ChangeEvidence = {
  origin: 'live',
  key: 'MC-62',
  summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
  descriptionText:
    'Synthetic change for ScenarioForge testing. We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.',
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
    { order: 1, instruction: 'Confirm elevated sign-in failures.', dependsOn: [] },
    { order: 2, instruction: 'Check the primary IdP status page.', dependsOn: [] },
    { order: 3, instruction: STEP3, dependsOn: [] },
    { order: 4, instruction: 'Post a status update to customers.', dependsOn: [] },
  ],
  stepSource: 'ordered-list',
  text: `Synthetic runbook. ${STEP3}`,
  retrievedAt: AT,
};
const analysis = analyzeChange(change, [runbook], AT);
const finding = analysis.findings[0]!;

/** Minimal stand-in for Forge's `view.createHistory()`. */
function fakeHistory(initial: string) {
  const entries = [initial];
  let index = 0;
  const listeners = new Set<(l: { pathname: string; search: string }) => void>();
  const location = () => {
    const path = entries[index]!;
    const q = path.indexOf('?');
    return q < 0
      ? { pathname: path, search: '' }
      : { pathname: path.slice(0, q), search: path.slice(q) };
  };
  return {
    get location() {
      return location();
    },
    push: (path: string) => {
      entries.splice(index + 1, entries.length, path);
      index = entries.length - 1;
      listeners.forEach((fn) => fn(location()));
    },
    back: () => {},
    forward: () => {},
    listen: (fn: (l: { pathname: string; search: string }) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

type User = ReturnType<typeof userEvent.setup>;

/** Tabs (never clicks) until `target` has focus; fails if it cannot be reached. */
async function tabTo(user: User, target: HTMLElement) {
  for (let i = 0; i < 300 && document.activeElement !== target; i++) await user.tab();
  expect(target).toHaveFocus();
  // Focus is visible: nothing in the path hides the outline (checked in CSS; here, not inert).
  expect(target.closest('[inert]')).toBeNull();
}

async function press(user: User, target: HTMLElement, key = '{Enter}') {
  await tabTo(user, target);
  await user.keyboard(key);
}

async function playToEnd(user: User, until: RegExp) {
  for (let i = 0; i < 12 && !screen.queryByRole('heading', { level: 1, name: until }); i++) {
    const options = within(screen.getByRole('list', { name: 'Your options' }));
    const first = options.getAllByRole('button')[0]!;
    // Focus moves to the new situation after each decision, so options are one Tab away.
    await press(user, first);
  }
  expect(screen.getByRole('heading', { level: 1, name: until })).toBeInTheDocument();
}

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: AT },
  });
  api.listRecentChanges.mockResolvedValue(
    changes([issue({ key: 'MC-62', summary: change.summary, issueType: 'Task' })]),
  );
  api.getReadinessGraph.mockResolvedValue({ ok: true, data: buildGraphFromAnalysis(analysis, AT) });
  api.analyzeChange.mockResolvedValue({ ok: true, data: analysis });
  const off = {
    ok: true,
    data: {
      status: 'UNAVAILABLE',
      detail: 'Rehearsal history is not enabled in this environment.',
    },
  };
  api.saveRehearsalRun.mockResolvedValue(off);
  api.saveRetest.mockResolvedValue(off);
});

afterEach(() => {
  vi.mocked(view.createHistory).mockImplementation(() =>
    Promise.reject(new Error('No Forge history in tests')),
  );
});

describe('Keyboard only: MC-62 deep link → check → rehearse → retest → report', () => {
  it('completes the whole workflow with Tab, Enter and Space', async () => {
    const link = rehearsalLinkPath({ change: 'MC-62', finding: finding.id, restore: 30 });
    vi.mocked(view.createHistory).mockImplementation(() =>
      Promise.resolve(fakeHistory(link) as never),
    );
    const user = userEvent.setup();
    render(<App />);

    // Deep link → check: the user's own check runs and the form is filled in.
    expect(await screen.findByText('Opened from a link')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Restore target (minutes)' })).toHaveValue('30');

    // Rehearse
    await press(user, screen.getByRole('button', { name: 'Rehearse this finding' }));
    expect(await screen.findByText('Modelled from MC-62')).toBeInTheDocument();
    await press(user, screen.getByRole('button', { name: 'Start rehearsal' }));
    await playToEnd(user, /After-action report/);

    // Fix: approve with Space, then retest with Enter.
    const fix = screen.getByText(/^Update .*step 3$/, { selector: '.fix-title' }).closest('li')!;
    await press(user, within(fix).getByRole('checkbox', { name: 'Approve for the retest' }), ' ');
    expect(within(fix).getByRole('checkbox', { name: 'Approve for the retest' })).toBeChecked();
    await press(user, screen.getByRole('button', { name: 'Run targeted retest' }));

    // Verify → report
    await playToEnd(user, /Retest report/);
    expect(
      screen.getByRole('heading', { name: 'Retest verdict: Gap resolved' }),
    ).toBeInTheDocument();
  });
});
