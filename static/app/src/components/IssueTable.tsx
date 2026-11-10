import type { ReactNode } from 'react';
import type { JiraIssueSummary } from '@shared/api';
import { formatAbsolute, formatRelative } from '../lib/format';
import { useSite } from '../lib/site';
import { StatusLozenge } from './StatusLozenge';

interface Props {
  issues: JiraIssueSummary[];
  caption: string;
  compact?: boolean;
  /** Optional per-row action, rendered in a last column. */
  rowAction?: (issue: JiraIssueSummary) => ReactNode;
}

/** Live Jira issues. Rows restack into labelled blocks on narrow screens. */
export function IssueTable({ issues, caption, compact = false, rowAction }: Props) {
  const { openInJira } = useSite();
  return (
    <table className={`issues${compact ? ' issues-compact' : ''}`}>
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">Summary</th>
          {compact ? null : <th scope="col">Type</th>}
          <th scope="col">Status</th>
          <th scope="col" className="col-updated">
            Updated
          </th>
          {rowAction ? (
            <th scope="col" className="col-action">
              <span className="visually-hidden">Actions</span>
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr key={issue.key}>
            <th scope="row" data-label="Key">
              <button
                type="button"
                className="issue-key"
                onClick={() => openInJira(issue.browsePath)}
                aria-label={`Open ${issue.key} in Jira (new tab)`}
              >
                {issue.key}
              </button>
            </th>
            <td data-label="Summary" className="issue-summary">
              {issue.summary}
            </td>
            {compact ? null : (
              <td data-label="Type" className="issue-type">
                {issue.issueType}
              </td>
            )}
            <td data-label="Status">
              <StatusLozenge issue={issue} />
            </td>
            <td data-label="Updated" className="col-updated num">
              <time dateTime={issue.updated ?? undefined} title={formatAbsolute(issue.updated)}>
                {formatRelative(issue.updated)}
              </time>
            </td>
            {rowAction ? (
              <td data-label="Actions" className="col-action">
                {rowAction(issue)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
