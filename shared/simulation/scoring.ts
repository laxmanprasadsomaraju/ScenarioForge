import type { ExerciseSession, RecoveryObjective, SimulationScenario } from '../domain/types';
import { decisionTrail, evaluateObjective, evaluateSession } from './engine';
import type { ObjectiveScore, SessionScore } from './types';

/**
 * Scoring detail beyond met/missed, derived only from the session's flag
 * timeline and decision log. There is no weighting or composite score: a
 * single number would hide which objective failed and why.
 */

export function scoreObjective(
  objective: RecoveryObjective,
  session: ExerciseSession,
): ObjectiveScore {
  const { rule } = objective;
  const setAt = session.flags[rule.flag];
  const result = evaluateObjective(objective, session);
  const isDeadline = rule.kind === 'flagSetWithin';
  const target = isDeadline ? rule.minutes : null;
  return {
    objectiveId: objective.id,
    label: objective.label,
    status: result.status,
    ruleKind: rule.kind,
    flag: rule.flag,
    flagSetAt: setAt ?? null,
    targetMinutes: target,
    minutesOverTarget: target === null || setAt === undefined ? null : Math.max(0, setAt - target),
    minutesToSpare:
      target === null || setAt === undefined || setAt > target ? null : target - setAt,
  };
}

/** Detailed score for a completed session. Throws like `evaluateSession` otherwise. */
export function scoreSession(scenario: SimulationScenario, session: ExerciseSession): SessionScore {
  const evaluation = evaluateSession(scenario, session);
  const objectives = scenario.objectives.map((o) => scoreObjective(o, session));
  const decisionAssessments = { effective: 0, neutral: 0, harmful: 0 };
  for (const { decision } of decisionTrail(scenario, session)) {
    decisionAssessments[decision.consequence.assessment] += 1;
  }
  return {
    sessionId: session.id,
    objectives,
    metCount: evaluation.metCount,
    totalCount: evaluation.totalCount,
    elapsedMinutes: session.elapsedMinutes,
    totalMinutesOverTarget: objectives.reduce((sum, o) => sum + (o.minutesOverTarget ?? 0), 0),
    deadlinesNeverReached: objectives.filter(
      (o) => o.ruleKind === 'flagSetWithin' && o.flagSetAt === null,
    ).length,
    decisionAssessments,
  };
}
