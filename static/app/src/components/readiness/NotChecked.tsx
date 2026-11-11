import type { AnalysisCoverage } from '@shared/analysis/types';
import type { ReadinessGraph, SourceStatus } from '@shared/graph/types';
import type { RemoteState } from '../../lib/useApi';
import { StatusBadge } from '../Badge';
import { SOURCE_LABELS } from './ImpactPath';

const GAP_WORDS: Partial<Record<SourceStatus['status'], string>> = {
  'not-connected': 'is not connected',
  'not-permitted': 'may not be read by the app',
  error: 'returned an error',
  'not-queried': 'was not asked',
};

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What the answer does not cover, stated before anyone acts on it. Every
 * line is a gap in the reading, so the list is never empty: pages outside
 * the search are always unread.
 */
export function NotChecked({
  coverage,
  graph,
}: {
  coverage: AnalysisCoverage;
  graph: RemoteState<ReadinessGraph>;
}) {
  const gaps: string[] = [];
  if (coverage.pagesSkipped > 0) {
    gaps.push(
      `${count(coverage.pagesSkipped, 'runbook was', 'runbooks were')} found but not read, because of limits, errors or permissions.`,
    );
  }
  if (coverage.pagesWithoutSteps > 0) {
    gaps.push(
      `${count(coverage.pagesWithoutSteps, 'runbook has', 'runbooks have')} no numbered steps, so no step in ${coverage.pagesWithoutSteps === 1 ? 'it' : 'them'} was compared.`,
    );
  }
  if (graph.status === 'error') {
    gaps.push('The impact path could not be built, so services and owning teams were not traced.');
  } else if (graph.status === 'ready') {
    for (const s of graph.data.sources) {
      const words = GAP_WORDS[s.status];
      if (words) gaps.push(`${SOURCE_LABELS[s.source]} ${words}.`);
    }
  }
  gaps.push('Pages the recovery search did not return, and pages you cannot view in Confluence.');

  return (
    <section className="region not-checked" aria-labelledby="not-checked-title">
      <div className="region-head">
        <h2 id="not-checked-title" className="section-title">
          What was not checked
        </h2>
        <StatusBadge tone="unknown">Not assessed</StatusBadge>
      </div>
      <ul className="not-checked-list">
        {gaps.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
    </section>
  );
}
