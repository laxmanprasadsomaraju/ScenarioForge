import type { ExerciseSession, SimulationScenario } from '@shared/domain/types';
import { objectiveProgress, type ObjectiveProgress } from '@shared/simulation/engine';

const LABEL: Record<ObjectiveProgress, string> = { pending: 'Open', met: 'Met', missed: 'Missed' };

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
            <span className="objective-state">{LABEL[progress]}</span>
          </li>
        );
      })}
    </ul>
  );
}
