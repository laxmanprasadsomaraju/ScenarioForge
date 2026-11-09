import type { DataOrigin } from '@shared/domain/types';

const LABELS: Record<DataOrigin, string> = {
  live: 'Live Jira data',
  demo: 'Synthetic demo data',
};

/** Every data region states where its content comes from. */
export function OriginTag({ origin }: { origin: DataOrigin }) {
  return <span className={`origin origin-${origin}`}>{LABELS[origin]}</span>;
}
