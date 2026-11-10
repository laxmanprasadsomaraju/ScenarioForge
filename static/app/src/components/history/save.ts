import type {
  ApiResult,
  RehearsalSourceRef,
  RehearsalSubmission,
  SaveRehearsalResponse,
} from '@shared/api';
import { HISTORY_NOT_ENABLED, rehearsalContentFingerprint } from '@shared/api';
import type { SimulationScenario } from '@shared/domain/types';
import { api } from '../../lib/api';
import type { CompletedExercise } from '../../lib/exercises';
import type { RehearsalSource } from '../../lib/rehearsalSource';

/** What happened to the history save of one completed run, in words for the debrief. */
export type SaveOutcome =
  | { kind: 'saving' }
  | { kind: 'saved' }
  /** Storage is not set up here: a quiet note, not an error. */
  | { kind: 'not-enabled' }
  | { kind: 'not-saved'; reason: string };

export const SAVE_TEXT = {
  saving: 'Saving to your rehearsal history…',
  saved: 'Saved to your rehearsal history.',
  notEnabled: 'Not saved: history is not enabled in this environment.',
} as const;

function deadline(scenario: SimulationScenario, objectiveId: string): number | null {
  const rule = scenario.objectives.find((o) => o.id === objectiveId)?.rule;
  return rule?.kind === 'flagSetWithin' ? rule.minutes : null;
}

/**
 * How the server rebuilds the scenario: a fixed demo id, or the change and
 * finding plus the targets the rehearsal was generated with. The scenario
 * itself is never sent.
 */
export function sourceRefFor(source: RehearsalSource): RehearsalSourceRef | null {
  if (!source.provenance) return { kind: 'demo', scenarioId: source.scenario.id };
  const restore = deadline(source.scenario, 'obj-restore');
  const notify = deadline(source.scenario, 'obj-notify');
  if (restore === null || notify === null) return null;
  return {
    kind: 'generated',
    changeKey: source.provenance.changeKey,
    findingId: source.provenance.findingId,
    restoreTargetMinutes: restore,
    notifyTargetMinutes: notify,
  };
}

export function submissionFor(exercise: CompletedExercise): RehearsalSubmission {
  const { session, scenario, evaluation } = exercise;
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    decisionIds: session.decisions.map((d) => d.decisionId),
    contentFingerprint: rehearsalContentFingerprint(scenario),
    evaluation,
    flags: session.flags,
  };
}

export function outcomeOf(result: ApiResult<SaveRehearsalResponse> | undefined): SaveOutcome {
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    return { kind: 'not-saved', reason: 'The ScenarioForge backend did not answer.' };
  }
  if (!result.ok) return { kind: 'not-saved', reason: result.error.message };
  const data = result.data;
  switch (data.status) {
    case 'SAVED':
      return { kind: 'saved' };
    case 'UNAVAILABLE':
      return data.detail === HISTORY_NOT_ENABLED
        ? { kind: 'not-enabled' }
        : { kind: 'not-saved', reason: data.detail };
    case 'IDENTITY_UNAVAILABLE':
      return { kind: 'not-saved', reason: data.detail };
    case 'REJECTED':
      return { kind: 'not-saved', reason: data.message };
    case 'TOO_LARGE':
      return { kind: 'not-saved', reason: 'This rehearsal is too large to save.' };
    case 'CONFLICT':
      return {
        kind: 'not-saved',
        reason: 'Your history was being updated at the same time. Rehearse again to save a run.',
      };
  }
}

/**
 * Saves a completed run or retest. Never throws: a failure becomes a
 * `not-saved` outcome and the in-tab record stays as it is.
 */
export async function saveCompleted(
  exercise: CompletedExercise,
  source: RehearsalSource,
): Promise<SaveOutcome> {
  const submission = submissionFor(exercise);
  try {
    if (exercise.retest) {
      return outcomeOf(
        await api.saveRetest({
          originalRunId: exercise.retest.original.session.id,
          remediationIds: exercise.retest.appliedRemediationIds,
          submission,
        }),
      );
    }
    const ref = sourceRefFor(source);
    if (!ref) {
      return { kind: 'not-saved', reason: 'The rehearsal targets could not be read.' };
    }
    return outcomeOf(await api.saveRehearsalRun({ source: ref, submission }));
  } catch {
    return { kind: 'not-saved', reason: 'The ScenarioForge backend did not answer.' };
  }
}
