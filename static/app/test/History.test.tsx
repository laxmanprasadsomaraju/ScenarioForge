import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApiResult,
  GetRehearsalRunResponse,
  GetRetestComparisonResponse,
  HistoryIndexEntry,
  ListRehearsalHistoryResponse,
  SaveRehearsalResponse,
  VerifiedRetest,
  VerifiedRun,
} from '@shared/api';
import { HISTORY_NOT_ENABLED } from '@shared/api';
import type { ExerciseSession, SimulationScenario } from '@shared/domain/types';
import { applyDecision, evaluateSession, startSession } from '@shared/simulation/engine';
import { createAuditRecord } from '@shared/simulation/replay';
import { buildRetest, compareRetest } from '@shared/simulation/retest';
import { authBackupRetiredScenario as DEMO } from '@shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation as DEMO_FIXES } from '@shared/simulation/scenarios/authBackupRetiredRemediation';
import { ReportsPage } from '../src/pages/Reports';
import { SimulationsPage } from '../src/pages/Simulations';
import { renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  listRehearsalHistory: vi.fn(),
  getRehearsalRun: vi.fn(),
  getRetestComparison: vi.fn(),
  saveRehearsalRun: vi.fn(),
  saveRetest: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

const RUN_ID = 'session-run00001';
const RETEST_ID = 'session-retest01';
const START = '2026-11-10T10:00:00.000Z';

function play(scenario: SimulationScenario, id: string, ids: string[]): ExerciseSession {
  let session = startSession(scenario, id, START);
  for (const decision of ids) session = applyDecision(scenario, session, decision);
  return session;
}

const firstSession = play(DEMO, RUN_ID, [
  'follow-runbook',
  'inspect-change',
  'notify-now',
  'activate-nimbus',
]);
const retestScenario = buildRetest(DEMO, firstSession, ['rem-runbook'], DEMO_FIXES);
let retestSession = startSession(retestScenario, RETEST_ID, START);
while (retestSession.status !== 'completed') {
  const step = retestScenario.steps[retestSession.currentStepId!]!;
  retestSession = applyDecision(retestScenario, retestSession, step.decisions[0]!.id);
}
const firstEval = evaluateSession(DEMO, firstSession);
const retestEval = evaluateSession(retestScenario, retestSession);
const comparison = compareRetest(
  { scenario: DEMO, session: firstSession, evaluation: firstEval },
  { scenario: retestScenario, session: retestSession, evaluation: retestEval },
  DEMO_FIXES,
  { id: RETEST_ID, comparedAt: '2026-11-10T11:00:00.000Z' },
);

const verifiedRun: VerifiedRun = {
  runId: RUN_ID,
  scenario: DEMO,
  remediation: DEMO_FIXES,
  provenance: null,
  audit: createAuditRecord(DEMO, firstSession),
  evaluation: firstEval,
  completedAt: '2026-11-10T10:30:00.000Z',
  retestIds: [RETEST_ID],
};
const verifiedRetest: VerifiedRetest = {
  retestId: RETEST_ID,
  originalRunId: RUN_ID,
  fixSet: { remediationIds: ['rem-runbook'], approvedBy: 'me', approvedAt: START },
  scenario: retestScenario,
  audit: createAuditRecord(retestScenario, retestSession),
  evaluation: retestEval,
  completedAt: '2026-11-10T11:00:00.000Z',
};

function entry(overrides: Partial<HistoryIndexEntry>): HistoryIndexEntry {
  return {
    id: RUN_ID,
    kind: 'run',
    completedAt: '2026-11-10T10:30:00.000Z',
    scenarioId: DEMO.id,
    scenarioVersion: 1,
    metCount: firstEval.metCount,
    totalCount: firstEval.totalCount,
    digest: 'd',
    ...overrides,
  };
}

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

const LIST: ListRehearsalHistoryResponse = {
  status: 'OK',
  pruned: [],
  items: [
    {
      run: entry({}),
      retests: [
        entry({
          id: RETEST_ID,
          kind: 'retest',
          retestOf: RUN_ID,
          metCount: retestEval.metCount,
          totalCount: retestEval.totalCount,
          outcome: 'resolved',
        }),
      ],
    },
    {
      run: entry({
        id: 'session-gen00001',
        scenarioId: 'rehearsal:MC-62:MC-62:98305:3:legacyauth',
        changeKey: 'MC-62',
        findingId: 'MC-62:98305:3:legacyauth',
        metCount: 1,
        totalCount: 3,
      }),
      retests: [],
    },
  ],
};

const notEnabled = ok({ status: 'UNAVAILABLE' as const, detail: HISTORY_NOT_ENABLED });

beforeEach(() => {
  vi.clearAllMocks();
  api.listRehearsalHistory.mockResolvedValue(ok(LIST));
  api.saveRehearsalRun.mockResolvedValue(notEnabled);
  api.saveRetest.mockResolvedValue(notEnabled);
});

const savedTable = () => screen.findByRole('table', { name: 'Saved rehearsals, newest first' });

describe('History list', () => {
  it('lists runs with their source, result, retest verdicts and status', async () => {
    renderInApp(<ReportsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
    const table = await savedTable();
    const [, demoRow, generatedRow] = within(table).getAllByRole('row');
    expect(demoRow).toHaveTextContent(DEMO.title);
    expect(demoRow).toHaveTextContent('Synthetic demo');
    expect(demoRow).toHaveTextContent('3 of 4 objectives met');
    expect(demoRow).toHaveTextContent('Retest 1: Resolved, 4 of 4 met');
    expect(demoRow).toHaveTextContent('Saved, checked when opened');
    expect(generatedRow).toHaveTextContent('Rehearsal of MC-62, runbook step 3');
    expect(generatedRow).toHaveTextContent('Modelled from MC-62');
    expect(generatedRow).toHaveTextContent('None');
    // The browser never names the user; the server takes it from the Forge context.
    expect(api.listRehearsalHistory).toHaveBeenCalledWith();
    // History loaded, so the in-tab fallback is not shown.
    expect(screen.queryByRole('region', { name: 'This tab only' })).toBeNull();
  });

  it('says when there are no saved rehearsals', async () => {
    api.listRehearsalHistory.mockResolvedValue(ok({ status: 'OK', items: [], pruned: [] }));
    renderInApp(<ReportsPage />);
    expect(await screen.findByText('No saved rehearsals yet')).toBeInTheDocument();
  });

  it('says history could not be loaded, with the reason, and keeps this tab section', async () => {
    api.listRehearsalHistory.mockResolvedValue(notEnabled);
    renderInApp(<ReportsPage />);
    expect(await screen.findByText('History could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText(HISTORY_NOT_ENABLED)).toBeInTheDocument();
    const tab = screen.getByRole('region', { name: 'This tab only' });
    expect(within(tab).getByText('No rehearsals in this tab yet')).toBeInTheDocument();
    // Never presented as an empty history.
    expect(screen.queryByText('No saved rehearsals yet')).toBeNull();
  });

  it('keeps reports from this tab visible when history is unavailable', async () => {
    api.listRehearsalHistory.mockResolvedValue(
      ok({ status: 'UNAVAILABLE', detail: 'History storage could not be reached.' }),
    );
    const user = userEvent.setup();
    renderInApp(
      <>
        <SimulationsPage />
        <ReportsPage />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    for (const label of [
      'Follow RB-AUTH-01 step 3',
      'Check the change history',
      'Post a status update',
      'Promote NimbusID',
    ]) {
      const options = within(screen.getByRole('list', { name: 'Your options' }));
      await user.click(options.getByRole('button', { name: new RegExp(`^${label}`) }));
    }
    const tab = await screen.findByRole('region', { name: 'This tab only' });
    expect(within(tab).getByRole('row', { name: new RegExp(DEMO.title) })).toHaveTextContent(
      '3 of 4',
    );
    expect(screen.getByText('History storage could not be reached.')).toBeInTheDocument();
  });
});

describe('Opening a saved record', () => {
  async function openRun(response: GetRehearsalRunResponse) {
    api.getRehearsalRun.mockResolvedValue(ok(response));
    const user = userEvent.setup();
    renderInApp(<ReportsPage />);
    const table = await savedTable();
    const [, demoRow] = within(table).getAllByRole('row');
    await user.click(within(demoRow!).getByRole('button', { name: /^Open report/ }));
    return user;
  }

  function expectNoContent() {
    expect(screen.queryByText(/objectives met$/)).toBeNull();
    expect(screen.queryByText(DEMO.title)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Decisions and their evidence' })).toBeNull();
  }

  it('shows a tampered record by status only and says so in the list', async () => {
    const user = await openRun({ status: 'TAMPERED' });
    const heading = await screen.findByRole('heading', { name: 'Failed integrity check' });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText('This record failed its integrity check and is not shown.'),
    ).toBeInTheDocument();
    expectNoContent();
    expect(api.getRehearsalRun).toHaveBeenCalledWith({ runId: RUN_ID });

    await user.click(screen.getByRole('button', { name: 'Back to history' }));
    const table = await savedTable();
    const [, demoRow] = within(table).getAllByRole('row');
    expect(demoRow).toHaveTextContent('Failed integrity check');
    await waitFor(() =>
      expect(within(demoRow!).getByRole('button', { name: /^Open report/ })).toHaveFocus(),
    );
  });

  it('shows an unverifiable record by status only', async () => {
    await openRun({ status: 'UNVERIFIABLE' });
    expect(
      await screen.findByText(
        'This record was made by an older engine version or cannot be checked.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cannot be checked' })).toBeInTheDocument();
    expectNoContent();
  });

  it('says when a record is not found', async () => {
    await openRun({ status: 'NOT_FOUND' });
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.getByText(/not in your history/)).toBeInTheDocument();
  });

  it('says when the record could not be loaded, with the reason', async () => {
    await openRun({ status: 'UNAVAILABLE', detail: 'History storage could not be reached.' });
    expect(
      await screen.findByRole('heading', { name: 'History could not be loaded.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('History storage could not be reached.')).toBeInTheDocument();
  });

  it('shows the debrief of a verified run', async () => {
    await openRun({ status: 'OK', run: verifiedRun });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'After-action report' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 of 4 objectives met' })).toHaveFocus();
    expect(screen.getByText('Synthetic demo')).toBeInTheDocument();
    // History is read-only: no approvals or retests from here.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows before and after per objective and the procedure for a retest', async () => {
    const response: GetRetestComparisonResponse = {
      status: 'OK',
      original: verifiedRun,
      retest: verifiedRetest,
      comparison,
    };
    api.getRetestComparison.mockResolvedValue(ok(response));
    const user = userEvent.setup();
    renderInApp(<ReportsPage />);
    const table = await savedTable();
    await user.click(within(table).getByRole('button', { name: /^Open retest 1/ }));

    expect(
      await screen.findByRole('heading', { name: 'Retest verdict: Gap resolved' }),
    ).toBeInTheDocument();
    expect(api.getRetestComparison).toHaveBeenCalledWith({ retestId: RETEST_ID });
    const verdict = screen.getByRole('table', { name: 'Objectives before and after the fix' });
    const procedure = within(verdict).getByRole('row', {
      name: /Following RB-AUTH-01 as written/,
    });
    expect(
      within(procedure)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Costly', 'Effective']);
    const restore = within(verdict).getByRole('row', { name: /Restore customer sign-in/ });
    expect(
      within(restore)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Met', 'Met']);
    expect(screen.getByText(/3 of 4 objectives met, \d+ simulated minutes/)).toBeInTheDocument();
    expect(
      screen.getByText('Update RB-AUTH-01 step 3 to promote NimbusID', { selector: 'dd' }),
    ).toBeInTheDocument();
  });
});

describe('Saving a completed rehearsal', () => {
  async function playDemo(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    for (const label of [
      'Follow RB-AUTH-01 step 3',
      'Check the change history',
      'Post a status update',
      'Promote NimbusID',
    ]) {
      const options = within(screen.getByRole('list', { name: 'Your options' }));
      await user.click(options.getByRole('button', { name: new RegExp(`^${label}`) }));
    }
  }

  it('keeps the in-tab report and notes quietly that history is not enabled', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playDemo(user);
    expect(
      await screen.findByText('Not saved: history is not enabled in this environment.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'After-action report' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    const request = api.saveRehearsalRun.mock.calls[0]![0];
    expect(request.source).toEqual({ kind: 'demo', scenarioId: DEMO.id });
    expect(Object.keys(request).sort()).toEqual(['source', 'submission']);
    expect(JSON.stringify(request)).not.toMatch(/accountId|"scenario"/);
  });

  it('shows the reason when the server rejects the save', async () => {
    const rejected: SaveRehearsalResponse = {
      status: 'REJECTED',
      reason: 'SCENARIO_MISMATCH',
      message: 'The change or runbook changed since this rehearsal started.',
    };
    api.saveRehearsalRun.mockResolvedValue(ok(rejected));
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playDemo(user);
    expect(
      await screen.findByText(
        'Not saved: The change or runbook changed since this rehearsal started.',
      ),
    ).toBeInTheDocument();
  });

  it('saves a retest against the original run id', async () => {
    api.saveRehearsalRun.mockResolvedValue(ok({ status: 'SAVED', id: 'x', pruned: [] }));
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playDemo(user);
    expect(await screen.findByText('Saved to your rehearsal history.')).toBeInTheDocument();
    const originalId = api.saveRehearsalRun.mock.calls[0]![0].submission.sessionId;

    const fix = screen.getByText('Update RB-AUTH-01 step 3 to promote NimbusID').closest('li')!;
    await user.click(within(fix).getByRole('checkbox', { name: 'Approve for the retest' }));
    await user.click(screen.getByRole('button', { name: 'Run targeted retest' }));
    while (!screen.queryByRole('heading', { level: 1, name: 'Retest report' })) {
      await user.click(
        within(screen.getByRole('list', { name: 'Your options' })).getAllByRole('button')[0]!,
      );
    }
    await waitFor(() => expect(api.saveRetest).toHaveBeenCalledTimes(1));
    const request = api.saveRetest.mock.calls[0]![0];
    expect(request.originalRunId).toBe(originalId);
    expect(request.remediationIds).toEqual(['rem-runbook']);
    expect(request.submission.sessionId).not.toBe(originalId);
    expect(
      await screen.findByText('Not saved: history is not enabled in this environment.'),
    ).toBeInTheDocument();
  });
});
