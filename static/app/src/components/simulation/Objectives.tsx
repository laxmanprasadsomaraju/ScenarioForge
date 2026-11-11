import type { ExerciseSession, SimulationScenario } from '@shared/domain/types';
import { objectiveProgress, type ObjectiveProgress } from '@shared/simulation/engine';
import { StatusBadge, type StatusTone } from '../Badge';

export const OBJECTIVE_LABEL: Record<ObjectiveProgress, string> = {
  pending: 'Open',
  met: 'Met',
  missed: 'Missed',
};
const TONE: Record<ObjectiveProgress, StatusTone> = {
  pending: 'unknown',
  met: 'success',
  missed: 'danger',
};

/** The deadline objective the commander is restoring towards, if the scenario has one. */
export function restoreTarget(
  scenario: SimulationScenario,
): { label: string; minutes: number } | null {
  const timed = scenario.objectives.flatMap((o) =>
    o.rule.kind === 'flagSetWithin' ? [{ label: o.label, minutes: o.rule.minutes }] : [],
  );
  return timed.find((o) => /^restore/i.test(o.label)) ?? timed[0] ?? null;
}

/** The earliest deadline still open on the clock. */
export function nextDeadline(
  scenario: SimulationScenario,
  session: ExerciseSession,
): { label: string; minutes: number } | null {
  let best: { label: string; minutes: number } | null = null;
  for (const o of scenario.objectives) {
    if (o.rule.kind !== 'flagSetWithin' || objectiveProgress(o, session) !== 'pending') continue;
    if (!best || o.rule.minutes < best.minutes) best = { label: o.label, minutes: o.rule.minutes };
  }
  return best;
}

export function ObjectiveList({
  scenario,
  session,
}: {
  scenario: SimulationScenario;
  session: ExerciseSession;
}) {
  return (
    <ul className="objectives">
      {scenario.objectives.map((objective) => {
        const progress = objectiveProgress(objective, session);
        return (
          <li key={objective.id} className={`objective objective-${progress}`}>
            <span className="objective-label">{objective.label}</span>
            <StatusBadge tone={TONE[progress]}>{OBJECTIVE_LABEL[progress]}</StatusBadge>
          </li>
        );
      })}
    </ul>
  );
}
