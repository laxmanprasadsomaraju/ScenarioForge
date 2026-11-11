import { useEffect } from 'react';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeAnalysis, ChangeRecoveryFinding } from '@shared/analysis/types';
import { authBackupRetiredScenario } from '@shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation } from '@shared/simulation/scenarios/authBackupRetiredRemediation';
import { OverviewPage } from '../src/pages/Overview';
import { useCheckLog, toCheckRecord } from '../src/lib/checkLog';
import { useExercises, type CompletedExercise } from '../src/lib/exercises';
import { approvedFixNotRetested, priorityActions, findingCounts } from '../src/lib/commandCenter';
import { useFixApprovals } from '../src/lib/fixApprovals';
import { changes, issue, renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  listRehearsalHistory: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
  api.listRecentChanges.mockResolvedValue(
    changes([issue({ key: 'MC-12' }), issue({ key: 'MC-13' })]),
  );
  api.listRehearsalHistory.mockResolvedValue({
    ok: true,
    data: {
      status: 'UNAVAILABLE',
      detail: 'Rehearsal history is not enabled in this environment.',
    },
  });
});

function finding(id: string, confidence: 'confirmed' | 'suspected'): ChangeRecoveryFinding {
  return {
    id,
    changeKey: 'MC-12',
    pageId: '1001',
    pageTitle: 'RB-AUTH-01',
    stepOrder: 3,
    pageWebuiPath: null,
    subject: { term: 'x', display: 'X', action: 'retire', excerpt: 'x' },
    confidence,
    basis: ['term-match'],
    explanation: '',
    evidence: [],
    aiAssisted: false,
  };
}

function analysis(findings: ChangeRecoveryFinding[], key = 'MC-12'): ChangeAnalysis {
  return {
    changeKey: key,
    change: { key, summary: 'Retire LegacyAuth', browsePath: `/browse/${key}` },
    analyzedAt: new Date().toISOString(),
    status: findings.length ? 'findings' : 'no-findings',
    subjects: [],
    findings,
    coverage: {
      pagesFound: 1,
      pagesRead: 1,
      pagesWithoutSteps: 0,
      pagesSkipped: 0,
      pagesChecked: [],
    },
  };
}

function exercise(met: number, total: number, id = 's1'): CompletedExercise {
  return {
    scenario: authBackupRetiredScenario,
    remediation: authBackupRetiredRemediation,
    session: { id } as CompletedExercise['session'],
    evaluation: {
      metCount: met,
      totalCount: total,
      elapsedMinutes: 30,
    } as CompletedExercise['evaluation'],
    completedAt: new Date().toISOString(),
  };
}

/** Seeds this session's checks and rehearsals, as the real screens would. */
function Seed({
  checks = [],
  runs = [],
  approvals = {},
}: {
  checks?: ChangeAnalysis[];
  runs?: CompletedExercise[];
  approvals?: Record<string, string[]>;
}) {
  const { record } = useCheckLog();
  const { record: recordRun } = useExercises();
  const { setApproved } = useFixApprovals();
  useEffect(() => {
    checks.forEach(record);
    runs.forEach(recordRun);
    Object.entries(approvals).forEach(([id, fixes]) => setApproved(id, fixes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const tile = (label: string) =>
  screen.getByText(label, { selector: '.stat-label' }).closest('.stat-tile') as HTMLElement;

describe('Command center, first run', () => {
  it('shows no invented figures and offers a first check', async () => {
    renderInApp(<OverviewPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Command center' })).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Recently updated Jira issues' });

    expect(within(tile('Findings')).getByText('Not assessed')).toBeInTheDocument();
    expect(within(tile('Findings')).getByText('This session')).toBeInTheDocument();
    expect(within(tile('Changes checked')).getByText('0')).toBeInTheDocument();
    expect(within(tile('Recent changes')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Recent changes')).getByText(/Live from Jira/)).toBeInTheDocument();
    expect(await within(tile('Saved runs')).findByText('Not available')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bM\d\b/)).not.toBeInTheDocument();

    const next = screen.getByRole('region', { name: 'Next action' });
    expect(within(next).getByText('Pick a change to check')).toBeInTheDocument();
    expect(within(next).getByRole('button', { name: 'Check a recent change' })).toBeInTheDocument();
    expect(
      screen.getByText('Nothing checked or rehearsed in this session yet.'),
    ).toBeInTheDocument();
    const journey = screen.getByRole('list', { name: 'Recovery journey' });
    expect(within(journey).getAllByText('Not started')).toHaveLength(3);
  });
});

describe('Command center, with session state', () => {
  it('derives actions only from checks and runs held this session', async () => {
    renderInApp(
      <>
        <Seed
          checks={[analysis([finding('f1', 'confirmed'), finding('f2', 'suspected')])]}
          runs={[exercise(2, 4)]}
          approvals={{ s1: ['rem-runbook'] }}
        />
        <OverviewPage />
      </>,
    );
    const next = await screen.findByRole('region', { name: 'Next action' });
    expect(within(next).getByText('Rehearse the confirmed finding on MC-12')).toBeInTheDocument();
    expect(
      within(next).getByText('Confirm or review the suspected finding on MC-12'),
    ).toBeInTheDocument();
    expect(within(next).getByText(/^Retest/)).toBeInTheDocument();
    expect(
      within(next).getByText(/1 fix approved \(simulated, this tab\) and not yet retested/),
    ).toBeInTheDocument();
    expect(within(tile('Findings')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Findings')).getByText('1 confirmed, 1 suspected')).toBeInTheDocument();
    expect(within(tile('Rehearsals completed')).getByText('1')).toBeInTheDocument();
  });

  it('says nothing needs action when checks found nothing, without calling it a pass', async () => {
    renderInApp(
      <>
        <Seed checks={[analysis([])]} />
        <OverviewPage />
      </>,
    );
    const next = await screen.findByRole('region', { name: 'Next action' });
    expect(within(next).getByText('Nothing needs action from this session')).toBeInTheDocument();
    expect(within(next).getByText(/No findings is not a pass/)).toBeInTheDocument();
    expect(within(tile('Findings')).getByText('0')).toBeInTheDocument();
  });
});

describe('priority action selectors', () => {
  it('returns nothing for an empty state', () => {
    expect(priorityActions([], [], null)).toEqual([]);
  });

  it('drops a confirmed finding once it has been rehearsed', () => {
    const check = toCheckRecord(analysis([finding('f1', 'confirmed')]));
    const run = {
      ...exercise(4, 4),
      scenario: { ...authBackupRetiredScenario, id: 'rehearsal:MC-12:f1' },
    };
    expect(priorityActions([check], [], null).map((a) => a.kind)).toEqual(['rehearse']);
    expect(priorityActions([check], [run], null)).toEqual([]);
  });

  it('asks for a retest only for a run with an approved fix and no retest', () => {
    const run = exercise(1, 4, 'orig');
    // Missing objectives alone is not enough: nothing has been approved to retest.
    expect(priorityActions([], [run], null)).toEqual([]);
    expect(priorityActions([], [run], null, { other: ['a'] })).toEqual([]);

    const approvals = { orig: ['rem-runbook', 'rem-change-check'] };
    const actions = priorityActions([], [run], null, approvals);
    expect(actions.map((a) => a.kind)).toEqual(['retest']);
    expect(actions[0]!.reason).toMatch(/^2 fixes approved \(simulated, this tab\)/);

    const retest = {
      ...exercise(4, 4, 'r'),
      retest: { comparison: {} as never, appliedRemediationIds: ['a'], original: run },
    };
    expect(priorityActions([], [retest, run], null, approvals)).toEqual([]);
  });

  it('selects approved, unretested runs even when all objectives were met', () => {
    const run = exercise(4, 4, 'full');
    expect(approvedFixNotRetested([run], { full: ['a'] })).toEqual([run]);
    expect(approvedFixNotRetested([run], {})).toEqual([]);
  });

  it('counts findings by confidence', () => {
    const checks = [
      toCheckRecord(analysis([finding('a', 'confirmed'), finding('b', 'suspected')])),
    ];
    expect(findingCounts(checks)).toEqual({ confirmed: 1, suspected: 1, notAssessed: 0 });
  });
});
