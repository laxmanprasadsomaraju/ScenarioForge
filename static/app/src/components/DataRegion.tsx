import type { ReactNode } from 'react';
import type { RemoteState } from '../lib/useApi';
import { StatusBadge } from './Badge';
import { ErrorPanel, SkeletonRows, type Product } from './States';

/** A source that is not enabled here: shown as unavailable, never as empty. */
export interface Unavailable {
  status: 'unavailable';
  title: string;
  detail: ReactNode;
}

export type RegionState<T> = RemoteState<T> | Unavailable;

/**
 * One data region and its four states: loading (skeleton rows), error (the
 * call's error and a retry, never placeholder rows), empty, and ready.
 * Unavailable is a fifth for sources this environment cannot read.
 *
 * The heading names the region (`aria-labelledby`), `origin` is its origin
 * badge, and `aria-busy` is set while loading.
 */
export function DataRegion<T>({
  id,
  title,
  hideTitle = false,
  origin,
  intro,
  state,
  loading,
  onRetry,
  product,
  isEmpty,
  empty,
  className,
  children,
}: {
  /** Id of the region heading. */
  id: string;
  title: ReactNode;
  /** Keep the heading for screen readers only (the page header already names it). */
  hideTitle?: boolean;
  origin?: ReactNode;
  /** Shown above the data in every state: a description or a live status line. */
  intro?: ReactNode;
  state: RegionState<T>;
  loading: { label: string; rows?: number };
  onRetry?: () => void;
  product?: Product;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode | ((data: T) => ReactNode);
  className?: string;
  children: (data: T) => ReactNode;
}) {
  const heading = (
    <h2 id={id} className={hideTitle ? 'visually-hidden' : 'section-title'}>
      {title}
    </h2>
  );
  return (
    <section
      className={className ? `region ${className}` : 'region'}
      aria-labelledby={id}
      aria-busy={state.status === 'loading'}
    >
      {origin && !hideTitle ? (
        <div className="region-head">
          {heading}
          {origin}
        </div>
      ) : (
        heading
      )}
      {intro}
      {state.status === 'loading' ? (
        <SkeletonRows rows={loading.rows} label={loading.label} />
      ) : null}
      {state.status === 'error' ? (
        <ErrorPanel error={state.error} onRetry={onRetry} product={product} />
      ) : null}
      {state.status === 'unavailable' ? (
        <div className="region-unavailable">
          <StatusBadge tone="unknown">Not available</StatusBadge>
          <p className="empty-title">{state.title}</p>
          <p className="region-body">{state.detail}</p>
        </div>
      ) : null}
      {state.status === 'ready'
        ? isEmpty?.(state.data)
          ? typeof empty === 'function'
            ? empty(state.data)
            : (empty ?? null)
          : children(state.data)
        : null}
    </section>
  );
}
