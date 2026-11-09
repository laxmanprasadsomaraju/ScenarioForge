import type { Consequence, RetestResult } from '@shared/domain/types';
import { decisionTrail } from '@shared/simulation/engine';
import { authBackupRetiredRemediation as model } from '@shared/simulation/scenarios/authBackupRetiredRemediation';
import type { RetestComparison } from '@shared/simulation/types';
import type { CompletedExercise } from '../../lib/exercises';

const OUTCOME: Record<RetestResult['outcome'], { label: string; tone: string }> = {
  resolved: { label: 'Gap resolved', tone: 'met' },
  'still-failing': { label: 'Gap still failing', tone: 'missed' },
  inconclusive: { label: 'Inconclusive', tone: 'pending' },
};

const STATUS: Record<string, string> = { met: 'Met', missed: 'Missed', absent: 'Not measured' };

const ASSESSMENT: Record<Consequence['assessment'], string> = {
  effective: 'Effective',
  neutral: 'Slow',
  harmful: 'Costly',
};

/** How each run fared when it relied on the procedure that had the gap. */
function procedureOutcome(run: CompletedExercise, findingId: string): string {
  const gap = model.gaps.find((g) => g.findingId === findingId);
  const keys = new Set(gap?.exerciseDecisions.map((d) => `${d.stepId}/${d.decisionId}`) ?? []);
  const taken = decisionTrail(run.scenario, run.session).filter(({ record }) =>
    keys.has(`${record.stepId}/${record.decisionId}`),
  );
  if (taken.length === 0) return 'Not followed';
  return taken.map(({ decision }) => ASSESSMENT[decision.consequence.assessment]).join(', then ');
}

/**
 * The rule-based retest verdict. Every word here comes from compareRetest's
 * deterministic rules; nothing is inferred in the UI.
 */
export function RetestVerdict({
  comparison,
  original,
  retest,
  objectiveLabels,
}: {
  comparison: RetestComparison;
  original: CompletedExercise;
  retest: CompletedExercise;
  objectiveLabels: Record<string, string>;
}) {
  const outcome = OUTCOME[comparison.outcome];
  return (
    <section className="region verdict" aria-labelledby="verdict-title">
      <h2 id="verdict-title" className={`verdict-title verdict-${outcome.tone}`}>
        Retest verdict: {outcome.label}
      </h2>
      {comparison.gaps.map((gap) => (
        <div key={gap.findingId} className="verdict-gap">
          <p className="region-body">{gap.reason}</p>
          <table className="plain-table verdict-table">
            <caption className="visually-hidden">Objectives before and after the fix</caption>
            <thead>
              <tr>
                <th scope="col">Tied to this gap</th>
                <th scope="col">First run</th>
                <th scope="col">Retest</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  Following {original.scenario.procedure.title.split(' ')[0]} as written
                </th>
                <td data-label="First run">{procedureOutcome(original, gap.findingId)}</td>
                <td data-label="Retest">{procedureOutcome(retest, gap.findingId)}</td>
              </tr>
              {gap.objectives.map((o) => (
                <tr key={o.objectiveId}>
                  <th scope="row">{objectiveLabels[o.objectiveId] ?? o.objectiveId}</th>
                  <td className={`objective-${o.original}`} data-label="First run">
                    {STATUS[o.original]}
                  </td>
                  <td className={`objective-${o.retest}`} data-label="Retest">
                    {STATUS[o.retest]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
