import type { HistoryIndexEntry, VerifiedRetest, VerifiedRun } from '@shared/api';
import type { RetestResult } from '@shared/domain/types';
import { replaySession } from '@shared/simulation/replay';
import type { RetestComparison, ScenarioRemediationModel } from '@shared/simulation/types';
import type { CompletedExercise } from '../../lib/exercises';
import { DEMO_SOURCE } from '../../lib/rehearsalSource';

/** Retest verdicts as words; colour only ever repeats them. */
export const VERDICT: Record<RetestResult['outcome'], string> = {
  resolved: 'Resolved',
  'still-failing': 'Still failing',
  inconclusive: 'Inconclusive',
};

/** What opening a record showed, so the list can say it in its status column. */
export type CheckedStatus = 'verified' | 'tampered' | 'unverifiable' | 'not-found';

export const CHECKED_TEXT: Record<CheckedStatus, string> = {
  verified: 'Verified',
  tampered: 'Failed integrity check',
  unverifiable: 'Cannot be checked',
  'not-found': 'Not found',
};

export const STATE_TEXT = {
  tampered: 'This record failed its integrity check and is not shown.',
  unverifiable: 'This record was made by an older engine version or cannot be checked.',
  unavailable: 'History could not be loaded.',
  notFound:
    'This rehearsal is not in your history. It may have expired, or you can no longer view its change in Jira.',
  empty: 'No saved rehearsals yet',
} as const;

/** Row label for a saved run, from its index entry alone (no stored content is read). */
export function describeEntry(entry: HistoryIndexEntry): { title: string; source: string } {
  if (entry.changeKey) {
    const step = entry.findingId?.split(':')[2];
    return {
      title: step
        ? `Rehearsal of ${entry.changeKey}, runbook step ${step}`
        : `Rehearsal of ${entry.changeKey}`,
      source: `Modelled from ${entry.changeKey}`,
    };
  }
  return {
    title:
      entry.scenarioId === DEMO_SOURCE.scenario.id ? DEMO_SOURCE.scenario.title : entry.scenarioId,
    source: 'Synthetic demo',
  };
}

const NO_REMEDIATION = (run: VerifiedRun): ScenarioRemediationModel => ({
  scenarioId: run.scenario.id,
  baseVersion: run.scenario.version,
  effects: {},
  gaps: [],
});

/** Rebuilds a verified run as the debrief shows it; the session is replayed from its decisions. */
export function exerciseFromRun(run: VerifiedRun): CompletedExercise {
  return {
    scenario: run.scenario,
    remediation: run.remediation ?? NO_REMEDIATION(run),
    session: replaySession(
      run.scenario,
      run.audit.decisions.map((d) => d.decisionId),
      run.audit.sessionId,
      run.audit.startedAt,
    ),
    evaluation: run.evaluation,
    completedAt: run.completedAt,
  };
}

export function exerciseFromRetest(
  original: VerifiedRun,
  retest: VerifiedRetest,
  comparison: RetestComparison,
): CompletedExercise {
  const first = exerciseFromRun(original);
  return {
    scenario: retest.scenario,
    remediation: first.remediation,
    session: replaySession(
      retest.scenario,
      retest.audit.decisions.map((d) => d.decisionId),
      retest.audit.sessionId,
      retest.audit.startedAt,
    ),
    evaluation: retest.evaluation,
    completedAt: retest.completedAt,
    retest: {
      comparison,
      appliedRemediationIds: retest.fixSet.remediationIds,
      original: first,
    },
  };
}
