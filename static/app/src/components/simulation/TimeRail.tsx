import type { Consequence, ExerciseSession, SimulationScenario } from '@shared/domain/types';
import {
  decisionTrail,
  objectiveProgress,
  type ObjectiveProgress,
} from '@shared/simulation/engine';

type RailItem =
  | {
      kind: 'event';
      sort: number;
      start: number;
      minutes: number;
      label: string;
      assessment: Consequence['assessment'];
    }
  | { kind: 'deadline'; sort: number; minute: number; label: string; progress: ObjectiveProgress }
  | { kind: 'now'; sort: number; minute: number }
  | { kind: 'end'; sort: number; minute: number };

const ASSESSMENT_LABEL: Record<Consequence['assessment'], string> = {
  effective: 'Effective',
  neutral: 'Slow',
  harmful: 'Costly',
};

const DEADLINE_LABEL: Record<ObjectiveProgress, string> = {
  pending: 'Ahead',
  met: 'Met',
  missed: 'Missed',
};

/**
 * The signature object: the exercise on its clock. Decisions land as logged
 * events; objective deadlines cut across the rail at their simulated minute.
 */
export function TimeRail({
  scenario,
  session,
}: {
  scenario: SimulationScenario;
  session: ExerciseSession;
}) {
  const items: RailItem[] = [];
  for (const { record, decision } of decisionTrail(scenario, session)) {
    items.push({
      kind: 'event',
      sort: record.atMinute,
      start: record.atMinute,
      minutes: decision.consequence.minutes,
      label: decision.label,
      assessment: decision.consequence.assessment,
    });
  }
  for (const objective of scenario.objectives) {
    if (objective.rule.kind === 'flagSetWithin') {
      items.push({
        kind: 'deadline',
        sort: objective.rule.minutes + 0.5,
        minute: objective.rule.minutes,
        label: objective.label,
        progress: objectiveProgress(objective, session),
      });
    }
  }
  items.push({
    kind: session.status === 'in-progress' ? 'now' : 'end',
    sort: session.elapsedMinutes + 0.25,
    minute: session.elapsedMinutes,
  });
  items.sort((a, b) => a.sort - b.sort);

  return (
    <ol className="rail" aria-label="Exercise timeline">
      <li className="rail-item rail-start">
        <span className="rail-time num">T+0</span>
        <span className="rail-text">Sign-in failures spike</span>
      </li>
      {items.map((item, i) => {
        if (item.kind === 'event') {
          return (
            <li key={`e${i}`} className={`rail-item rail-event rail-${item.assessment}`}>
              <span className="rail-time num">T+{item.start}</span>
              <span className="rail-text">{item.label}</span>
              <span className="rail-meta">
                <span className={`assessment assessment-${item.assessment}`}>
                  {ASSESSMENT_LABEL[item.assessment]}
                </span>
                <span className="num">{item.minutes} min</span>
              </span>
            </li>
          );
        }
        if (item.kind === 'deadline') {
          return (
            <li key={`d${i}`} className={`rail-item rail-deadline rail-deadline-${item.progress}`}>
              <span className="rail-time num">T+{item.minute}</span>
              <span className="rail-text">Deadline: {item.label}</span>
              <span className="rail-meta">{DEADLINE_LABEL[item.progress]}</span>
            </li>
          );
        }
        if (item.kind === 'end') {
          return (
            <li key={`x${i}`} className="rail-item rail-end">
              <span className="rail-time num">T+{item.minute}</span>
              <span className="rail-text">Exercise ended</span>
            </li>
          );
        }
        return (
          <li key={`n${i}`} className="rail-item rail-now" aria-current="step">
            <span className="rail-time num">T+{item.minute}</span>
            <span className="rail-text">Now: your decision</span>
          </li>
        );
      })}
    </ol>
  );
}
