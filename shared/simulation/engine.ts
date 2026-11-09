import type {
  Decision,
  ExerciseEvaluation,
  ExerciseSession,
  ObjectiveResult,
  RecoveryObjective,
  ScenarioStep,
  SimulationScenario,
} from '../domain/types';

/**
 * Deterministic exercise engine.
 *
 * Every consequence comes from the pre-authored scenario. Given the same
 * scenario version and the same sequence of decisions, the engine always
 * produces the same session state and evaluation. No randomness, no clock
 * reads and no AI calls happen here.
 */

export class SimulationError extends Error {}

export function startSession(
  scenario: SimulationScenario,
  sessionId: string,
  startedAt: string,
): ExerciseSession {
  if (!scenario.steps[scenario.startStepId]) {
    throw new SimulationError(`Scenario ${scenario.id} has no start step ${scenario.startStepId}.`);
  }
  return {
    id: sessionId,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    origin: scenario.origin,
    startedAt,
    status: 'in-progress',
    currentStepId: scenario.startStepId,
    elapsedMinutes: 0,
    flags: {},
    decisions: [],
  };
}

export function currentStep(
  scenario: SimulationScenario,
  session: ExerciseSession,
): ScenarioStep | null {
  return session.currentStepId ? (scenario.steps[session.currentStepId] ?? null) : null;
}

/** Applies one decision and returns a new session; the input is not mutated. */
export function applyDecision(
  scenario: SimulationScenario,
  session: ExerciseSession,
  decisionId: string,
): ExerciseSession {
  if (session.scenarioId !== scenario.id || session.scenarioVersion !== scenario.version) {
    throw new SimulationError('Session does not belong to this scenario version.');
  }
  if (session.status !== 'in-progress') {
    throw new SimulationError('Exercise is already completed.');
  }
  const step = currentStep(scenario, session);
  if (!step) {
    throw new SimulationError(`Unknown step ${session.currentStepId}.`);
  }
  const decision = step.decisions.find((d) => d.id === decisionId);
  if (!decision) {
    throw new SimulationError(`Decision ${decisionId} is not available at step ${step.id}.`);
  }

  const atMinute = session.elapsedMinutes;
  const elapsedMinutes = atMinute + decision.consequence.minutes;
  const flags = { ...session.flags };
  for (const flag of decision.consequence.setFlags ?? []) {
    // A flag records when it first became true; later actions do not move it.
    if (flags[flag] === undefined) {
      flags[flag] = elapsedMinutes;
    }
  }

  const nextStepId = resolveNext(decision, flags);
  if (nextStepId !== null && !scenario.steps[nextStepId]) {
    throw new SimulationError(`Decision ${decision.id} points to unknown step ${nextStepId}.`);
  }

  return {
    ...session,
    elapsedMinutes,
    flags,
    decisions: [...session.decisions, { stepId: step.id, decisionId, atMinute }],
    currentStepId: nextStepId,
    status: nextStepId === null ? 'completed' : 'in-progress',
  };
}

function resolveNext(decision: Decision, flags: Record<string, number>): string | null {
  if (decision.nextIfFlag && flags[decision.nextIfFlag.flag] !== undefined) {
    return decision.nextIfFlag.next;
  }
  return decision.next;
}

export function evaluateObjective(
  objective: RecoveryObjective,
  session: ExerciseSession,
): ObjectiveResult {
  const { rule } = objective;
  const setAt = session.flags[rule.flag];
  let met: boolean;
  let explanation: string;

  switch (rule.kind) {
    case 'flagSetWithin':
      met = setAt !== undefined && setAt <= rule.minutes;
      explanation =
        setAt === undefined
          ? `Not achieved during the exercise (target: within ${rule.minutes} min).`
          : setAt <= rule.minutes
            ? `Achieved at T+${setAt} min (target: within ${rule.minutes} min).`
            : `Achieved late, at T+${setAt} min (target: within ${rule.minutes} min).`;
      break;
    case 'flagSet':
      met = setAt !== undefined;
      explanation = met ? `Achieved at T+${setAt} min.` : 'Not achieved during the exercise.';
      break;
    case 'flagNeverSet':
      met = setAt === undefined;
      explanation = met ? 'Held for the whole exercise.' : `Violated at T+${setAt} min.`;
      break;
  }

  return {
    objectiveId: objective.id,
    label: objective.label,
    status: met ? 'met' : 'missed',
    explanation,
  };
}

export function evaluateSession(
  scenario: SimulationScenario,
  session: ExerciseSession,
): ExerciseEvaluation {
  if (session.status !== 'completed') {
    throw new SimulationError('Only completed exercises can be evaluated.');
  }
  const objectives = scenario.objectives.map((o) => evaluateObjective(o, session));
  return {
    sessionId: session.id,
    objectives,
    metCount: objectives.filter((o) => o.status === 'met').length,
    totalCount: objectives.length,
    elapsedMinutes: session.elapsedMinutes,
  };
}

/** Looks up the decision objects a session took, in order, for the debrief. */
export function decisionTrail(scenario: SimulationScenario, session: ExerciseSession) {
  return session.decisions.map((record) => {
    const step = scenario.steps[record.stepId];
    const decision = step?.decisions.find((d) => d.id === record.decisionId);
    if (!step || !decision) {
      throw new SimulationError(`Session references unknown decision ${record.decisionId}.`);
    }
    return { record, step, decision };
  });
}

/** Structural checks so a malformed scenario fails fast in tests, not mid-exercise. */
export function validateScenario(scenario: SimulationScenario): string[] {
  const problems: string[] = [];
  const evidenceIds = new Set(scenario.evidence.map((e) => e.id));
  if (!scenario.steps[scenario.startStepId]) {
    problems.push(`start step ${scenario.startStepId} missing`);
  }
  for (const step of Object.values(scenario.steps)) {
    if (step.decisions.length < 2) {
      problems.push(`step ${step.id} offers fewer than two decisions`);
    }
    for (const decision of step.decisions) {
      for (const target of [decision.next, decision.nextIfFlag?.next]) {
        if (target && !scenario.steps[target]) {
          problems.push(`decision ${decision.id} points to missing step ${target}`);
        }
      }
      for (const id of decision.consequence.evidenceIds) {
        if (!evidenceIds.has(id)) {
          problems.push(`decision ${decision.id} cites missing evidence ${id}`);
        }
      }
    }
  }
  return problems;
}

export type ObjectiveProgress = 'pending' | 'met' | 'missed';

/**
 * Live objective state while an exercise is running. A deadline objective is
 * only `missed` once the simulated clock has passed it; until then it stays
 * `pending`, never optimistically `met`.
 */
export function objectiveProgress(
  objective: RecoveryObjective,
  session: ExerciseSession,
): ObjectiveProgress {
  const { rule } = objective;
  const setAt = session.flags[rule.flag];
  switch (rule.kind) {
    case 'flagSetWithin':
      if (setAt !== undefined) return setAt <= rule.minutes ? 'met' : 'missed';
      if (session.elapsedMinutes > rule.minutes) return 'missed';
      return session.status === 'completed' ? 'missed' : 'pending';
    case 'flagSet':
      if (setAt !== undefined) return 'met';
      return session.status === 'completed' ? 'missed' : 'pending';
    case 'flagNeverSet':
      if (setAt !== undefined) return 'missed';
      return session.status === 'completed' ? 'met' : 'pending';
  }
}
