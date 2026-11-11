import type { DataOrigin } from '@shared/domain/types';
import { OriginBadge } from './Badge';

/** Every data region states where its content comes from. */
export function OriginTag({
  origin,
  product = 'Jira',
}: {
  origin: DataOrigin;
  product?: 'Jira' | 'Confluence' | 'Jira and Confluence';
}) {
  return origin === 'live' ? (
    <OriginBadge origin="live">{`Live ${product} data`}</OriginBadge>
  ) : (
    <OriginBadge origin="synthetic">Synthetic demo data</OriginBadge>
  );
}
