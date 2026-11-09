import { Component, type ReactNode } from 'react';
import Button from '@atlaskit/button/new';
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

const ERROR_TITLES: Record<ApiError['code'], string> = {
  INVALID_REQUEST: 'The request was rejected',
  UNAUTHENTICATED: 'ScenarioForge needs access to Jira',
  FORBIDDEN: 'You do not have permission to view these issues',
  NOT_FOUND: 'Jira could not find that resource',
  RATE_LIMITED: 'Jira is busy',
  UPSTREAM_ERROR: 'Jira could not be reached',
  UNEXPECTED_RESPONSE: 'Jira sent an unreadable response',
};

/** Shown instead of data whenever a call fails; never replaced by placeholder rows. */
export function ErrorPanel({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <SectionMessage
      appearance="error"
      title={ERROR_TITLES[error.code]}
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
        <Button appearance="default" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
