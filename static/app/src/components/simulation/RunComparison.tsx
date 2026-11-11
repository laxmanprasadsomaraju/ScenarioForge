import type { RetestResult, SimulationScenario, ExerciseEvaluation } from '@shared/domain/types';
import type { CompletedExercise } from '../../lib/exercises';

/** Objectives with a time limit (flagSetWithin) that the run missed. */
export function missedDeadlines(scenario: SimulationScenario, evaluation: ExerciseEvaluation) {
  const timed = new Set(
    scenario.objectives.filter((o) => o.rule.kind === 'flagSetWithin').map((o) => o.id),
  );
  return evaluation.objectives.filter((o) => timed.has(o.objectiveId) && o.status === 'missed')
    .length;
}

export interface RunSummary {
  decisions: number;
  minutes: number;
  met: number;
  total: number;
  missedDeadlines: number;
}

export function runSummary(run: CompletedExercise): RunSummary {
  return {
    decisions: run.session.decisions.length,
    minutes: run.evaluation.elapsedMinutes,
    met: run.evaluation.metCount,
    total: run.evaluation.totalCount,
    missedDeadlines: missedDeadlines(run.scenario, run.evaluation),
  };
}

/** The verdict word for a retest. "Resolved" is always scoped to the simulation. */
export const RETEST_OUTCOME: Record<
  RetestResult['outcome'],
  { label: string; scoped: string; tone: 'met' | 'missed' | 'pending' }
> = {
  resolved: { label: 'Gap resolved', scoped: 'Gap resolved in the simulation', tone: 'met' },
  'still-failing': {
    label: 'Gap still failing',
    scoped: 'Gap still failing in the simulation',
    tone: 'missed',
  },
  inconclusive: {
    label: 'Inconclusive',
    scoped: 'Inconclusive: the retest did not exercise the gap',
    tone: 'pending',
  },
};

/** Scope line under the verdict: nothing outside the simulation has changed. */
export const SIMULATION_SCOPE =
  'Modelled, not measured. No runbook change or Jira work item is recorded, so the real runbook still has the gap until someone fixes it.';

/**
 * The before/after signature: the original run and its retest side by side.
 * Every figure is read from the two runs; the verdict word is compareRetest's.
 */
export function RunComparison({
  original,
  retest,
  outcome,
}: {
  original: CompletedExercise;
  retest: CompletedExercise;
  outcome: RetestResult['outcome'];
}) {
  const before = runSummary(original);
  const after = runSummary(retest);
  const verdict = RETEST_OUTCOME[outcome];
  const rows: { label: string; before: string; after: string; better: boolean | null }[] = [
    {
      label: 'Modelled recovery time',
      before: `${before.minutes} min`,
      after: `${after.minutes} min`,
      better: after.minutes === before.minutes ? null : after.minutes < before.minutes,
    },
    {
      label: 'Objectives met',
      before: `${before.met}/${before.total}`,
      after: `${after.met}/${after.total}`,
      better: after.met === before.met ? null : after.met > before.met,
    },
    {
      label: 'Missed deadlines',
      before: String(before.missedDeadlines),
      after: String(after.missedDeadlines),
      better:
        after.missedDeadlines === before.missedDeadlines
          ? null
          : after.missedDeadlines < before.missedDeadlines,
    },
    {
      label: 'Decisions',
      before: String(before.decisions),
      after: String(after.decisions),
      better: null,
    },
  ];
  return (
    <div className="compare">
      <table className="compare-table">
        <caption className="visually-hidden">Original run and retest, side by side</caption>
        <thead>
          <tr>
            <td />
            <th scope="col">Original run</th>
            <th scope="col">Retest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td className="num" data-label="Original run">
                {r.before}
              </td>
              <td
                className={`num${r.better === null ? '' : r.better ? ' compare-better' : ' compare-worse'}`}
                data-label="Retest"
              >
                {r.after}
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">Verdict</th>
            <td data-label="Original run">Gap open</td>
            <td className={`compare-verdict verdict-${verdict.tone}`} data-label="Retest">
              {verdict.scoped}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
