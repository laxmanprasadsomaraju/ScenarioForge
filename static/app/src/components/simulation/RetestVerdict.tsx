import type { RetestResult } from '@shared/domain/types';
import type { RetestComparison } from '@shared/simulation/types';

const OUTCOME: Record<RetestResult['outcome'], { label: string; tone: string }> = {
  resolved: { label: 'Gap resolved', tone: 'met' },
  'still-failing': { label: 'Gap still failing', tone: 'missed' },
  inconclusive: { label: 'Inconclusive', tone: 'pending' },
};

const STATUS: Record<string, string> = { met: 'Met', missed: 'Missed', absent: 'Not measured' };

/**
 * The rule-based retest verdict. Every word here comes from compareRetest's
 * deterministic rules; nothing is inferred in the UI.
 */
export function RetestVerdict({
  comparison,
  objectiveLabels,
}: {
  comparison: RetestComparison;
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
                <th scope="col">Objective tied to this gap</th>
                <th scope="col">First run</th>
                <th scope="col">Retest</th>
              </tr>
            </thead>
            <tbody>
              {gap.objectives.map((o) => (
                <tr key={o.objectiveId}>
                  <th scope="row">{objectiveLabels[o.objectiveId] ?? o.objectiveId}</th>
                  <td className={`objective-${o.original}`}>{STATUS[o.original]}</td>
                  <td className={`objective-${o.retest}`}>{STATUS[o.retest]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
