import type { ReactNode } from 'react';
import Button from '@atlaskit/button/new';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import type { ApiError } from '@shared/api';

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
