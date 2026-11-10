import { Component, type ReactNode } from 'react';
import { Button } from './Button';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import type { ApiError } from '@shared/api';

/** Placeholder for a screen whose code is still loading: a heading bar, a lead and rows. */
export function ScreenSkeleton({ label }: { label: string }) {
  return (
    <div className="screen-skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <div className="screen-skeleton-head" aria-hidden="true">
        <span className="skeleton-bar skeleton-title" />
        <span className="skeleton-bar skeleton-lead" />
      </div>
      <div aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton-row">
            <span className="skeleton-bar skeleton-key" />
            <span className="skeleton-bar skeleton-text" />
            <span className="skeleton-bar skeleton-meta" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Catches a screen that fails to load (for example a chunk request that fails) and offers a reload. */
export class ScreenErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <SectionMessage
        appearance="error"
        title="This screen could not be loaded"
        actions={
          <SectionMessageAction onClick={() => window.location.reload()}>
            Reload ScenarioForge
          </SectionMessageAction>
        }
      >
        <p>Part of the app did not download. Check your connection, then reload.</p>
      </SectionMessage>
    );
  }
}

export function SkeletonRows({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <span className="skeleton-bar skeleton-key" />
          <span className="skeleton-bar skeleton-text" />
          <span className="skeleton-bar skeleton-meta" />
        </div>
      ))}
    </div>
  );
}

/** `Jira or Confluence` for calls that read both, where the failing product is not reported. */
export type Product = 'Jira' | 'Confluence' | 'Jira or Confluence';

function errorTitle(code: ApiError['code'], product: Product): string {
  switch (code) {
    case 'INVALID_REQUEST':
      return 'The request was rejected';
    case 'UNAUTHENTICATED':
      return `ScenarioForge needs access to ${product}`;
    case 'FORBIDDEN':
      return product === 'Jira'
        ? 'You do not have permission to view these issues'
        : 'You do not have permission to view this content';
    case 'NOT_FOUND':
      return `${product} could not find that resource`;
    case 'RATE_LIMITED':
      return `${product} is busy`;
    case 'UPSTREAM_ERROR':
      return `${product} could not be reached`;
    case 'UNEXPECTED_RESPONSE':
      return `${product} sent an unreadable response`;
  }
}

/** Shown instead of data whenever a call fails; never replaced by placeholder rows. */
export function ErrorPanel({
  error,
  onRetry,
  product = 'Jira',
}: {
  error: ApiError;
  onRetry?: () => void;
  product?: Product;
}) {
  return (
    <SectionMessage
      appearance="error"
      title={errorTitle(error.code, product)}
      actions={
        onRetry ? (
          <SectionMessageAction onClick={onRetry}>Try again</SectionMessageAction>
        ) : undefined
      }
    >
      <p>
        {error.message}
        {error.upstreamStatus ? ` (HTTP ${error.upstreamStatus})` : ''}
      </p>
    </SectionMessage>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty">
      <h3 className="empty-title">{title}</h3>
      <p className="empty-body">{children}</p>
      {action ? (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
