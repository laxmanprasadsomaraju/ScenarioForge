import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeChange } from '@shared/analysis';
import type { ChangeEvidence, RunbookEvidence } from '@shared/analysis/types';
import { buildGraphFromAnalysis } from '@shared/graph/build';
import { App } from '../src/App';
import { changes, issue } from './helpers';

const api = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  listRecoveryPages: vi.fn(),
  getRecoveryProcedure: vi.fn(),
  analyzeChange: vi.fn(),
  getReadinessGraph: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

const AT = '2026-11-10T09:00:00.000Z';
const DESCRIPTION =
  'Synthetic change for ScenarioForge testing. We will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';
const STEP3 =
  'If the primary IdP is unavailable for more than 5 minutes, run authctl failover --target legacyauth.';

// The live M3 test texts, analysed by the real engine (no AI, no network).
const change: ChangeEvidence = {
  origin: 'live',
  key: 'MC-62',
  summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
  descriptionText: DESCRIPTION,
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
    {
      order: 1,
      instruction: 'Confirm elevated sign-in failures on the auth dashboard.',
      dependsOn: [],
    },
    { order: 2, instruction: 'Check the primary IdP status page.', dependsOn: [] },
    { order: 3, instruction: STEP3, dependsOn: [] },
    { order: 4, instruction: 'Post a status update to customers.', dependsOn: [] },
  ],
  stepSource: 'ordered-list',
  text: `Synthetic runbook. ${STEP3}`,
  retrievedAt: AT,
};
const analysis = analyzeChange(change, [runbook], AT);

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
});

async function playToEnd(user: ReturnType<typeof userEvent.setup>, until: RegExp) {
  for (let i = 0; i < 12 && !screen.queryByRole('heading', { level: 1, name: until }); i++) {
    const options = within(screen.getByRole('list', { name: 'Your options' }));
    await user.click(options.getAllByRole('button')[0]!);
  }
  expect(screen.getByRole('heading', { level: 1, name: until })).toBeInTheDocument();
}

describe('Detect → Rehearse → Fix → Verify from a real finding', () => {
  it('rehearses MC-62, applies the step fix and verifies it with a retest', async () => {
    expect(analysis.status).toBe('findings');
    const user = userEvent.setup();
    render(<App />);

    // Detect
    const nav = within(screen.getByRole('navigation', { name: 'ScenarioForge' }));
    await user.click(nav.getByRole('link', { name: /Readiness checks/ }));
    await user.click(await screen.findByRole('button', { name: 'Check recovery impact of MC-62' }));
    await screen.findByRole('heading', { name: 'Rehearse a finding' });
    expect(api.getReadinessGraph).toHaveBeenCalledWith({ issueKey: 'MC-62' });

    // Rehearse: the target is the user's, the scenario comes from the finding.
    await user.type(screen.getByRole('textbox', { name: 'Restore target (minutes)' }), '30');
    await user.click(screen.getByRole('button', { name: 'Rehearse this finding' }));
    expect(await screen.findByText('Modelled from MC-62')).toBeInTheDocument();
    expect(screen.getByText(/Built from a suspected finding on MC-62/)).toBeInTheDocument();
    expect(screen.getByText(STEP3)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    await playToEnd(user, /After-action report/);
    expect(screen.queryByText('Synthetic demo data')).not.toBeInTheDocument();

    // Fix
    const fix = screen.getByText(/^Update .*step 3$/).closest('li')!;
    await user.click(within(fix).getByRole('checkbox', { name: 'Approve for the retest' }));
    await user.click(screen.getByRole('button', { name: 'Run targeted retest' }));

    // Verify
    await playToEnd(user, /Retest report/);
    expect(
      screen.getByRole('heading', { name: 'Retest verdict: Gap resolved' }),
    ).toBeInTheDocument();
  });
});
