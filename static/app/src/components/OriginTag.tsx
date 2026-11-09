import type { DataOrigin } from '@shared/domain/types';

/** Every data region states where its content comes from. */
export function OriginTag({
  origin,
  product = 'Jira',
}: {
  origin: DataOrigin;
  product?: 'Jira' | 'Confluence';
}) {
  const label = origin === 'live' ? `Live ${product} data` : 'Synthetic demo data';
  return <span className={`origin origin-${origin}`}>{label}</span>;
}
