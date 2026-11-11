import { Component, type ReactNode } from 'react';
import { Button } from './Button';
import { StatusErrorIcon, StatusInformationIcon, StatusWarningIcon } from './icons';
import type { ApiError } from '@shared/api';

const NOTICE_ICON = {
  error: StatusErrorIcon,
  warning: StatusWarningIcon,
  information: StatusInformationIcon,
} as const;

/**
 * A titled message with an icon, a word-bearing title and an optional action:
 * the ADS section message pattern, native, so it costs no Atlaskit runtime.
 */
export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: keyof typeof NOTICE_ICON;
  title: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const Icon = NOTICE_ICON[tone];
  return (
    <section className={`notice notice-${tone}`} aria-label={title}>
      <span className="notice-icon">
        <Icon label="" color="currentColor" />
      </span>
      <div className="notice-body">
        <h3 className="notice-title">{title}</h3>
        {children}
        {action ? (
          <p className="notice-actions">
            <Button variant="subtle" spacing="compact" onClick={action.onClick}>
              {action.label}
            </Button>
          </p>
        ) : null}
      </div>
    </section>
  );
}

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
      <Notice
        tone="error"
        title="This screen could not be loaded"
        action={{ label: 'Reload ScenarioForge', onClick: () => window.location.reload() }}
      >
        <p>Part of the app did not download. Check your connection, then reload.</p>
      </Notice>
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
    case 'WRITE_NOT_PERMITTED':
      return 'Creating work items is not enabled';
    case 'APPROVAL_INVALID':
      return 'The approval no longer applies';
    case 'CONFLICT':
      return 'Another request is already in progress';
    case 'STORAGE_UNAVAILABLE':
      return 'Saved state is not enabled in this environment';
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
    <Notice
      tone="error"
      title={errorTitle(error.code, product)}
      action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined}
    >
      <p>
        {error.message}
        {error.upstreamStatus ? ` (HTTP ${error.upstreamStatus})` : ''}
      </p>
    </Notice>
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
