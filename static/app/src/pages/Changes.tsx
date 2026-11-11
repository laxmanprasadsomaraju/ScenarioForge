import { useCallback, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import type { JiraIssueSummary, UpdatedWindow } from '@shared/api';
import { UPDATED_WINDOWS } from '@shared/api';
import {
  distinctIssueTypes,
  filterAndSortIssues,
  type IssueFilter,
  type IssueSort,
} from '@shared/issueFilters';
import { api } from '../lib/api';
import { formatAbsolute } from '../lib/format';
import { useApi } from '../lib/useApi';
import { IssueTable } from '../components/IssueTable';
import { CheckImpactButton } from '../components/readiness/CheckImpactButton';
import { OriginTag } from '../components/OriginTag';
import { DataRegion } from '../components/DataRegion';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/States';

const WINDOW_LABELS: Record<UpdatedWindow, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '365d': 'Last 12 months',
};

const STATUS_OPTIONS: { value: IssueFilter['statusCategory']; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'new', label: 'To do' },
  { value: 'indeterminate', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

const EMPTY_FILTER: IssueFilter = { text: '', statusCategory: 'all', issueType: 'all' };

export function ChangesPage() {
  const [window, setWindow] = useState<UpdatedWindow>('30d');
  const [filter, setFilter] = useState<IssueFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<IssueSort>('updated-desc');

  const load = useCallback(
    () => api.listRecentChanges({ updatedWithin: window, maxResults: 50 }),
    [window],
  );
  const { state, retry } = useApi(load);

  const loaded = state.status === 'ready' ? state.data.issues : null;
  const issues: JiraIssueSummary[] = useMemo(() => loaded ?? [], [loaded]);
  const types = useMemo(() => distinctIssueTypes(issues), [issues]);
  const visible = useMemo(() => filterAndSortIssues(issues, filter, sort), [issues, filter, sort]);

  // Announced through one region that stays mounted, so filtering, refreshing
  // and failures are all spoken. Loading is announced by the skeleton.
  let announcement = '';
  if (state.status === 'error') announcement = 'Jira issues could not be loaded.';
  else if (state.status === 'ready' && issues.length === 0)
    announcement = 'No issues in this window.';
  else if (state.status === 'ready' && visible.length === 0)
    announcement = 'No issues match these filters.';
  else if (state.status === 'ready')
    announcement = `Showing ${visible.length} of ${issues.length} issues.`;

  return (
    <>
      <PageHeader
        title="Changes"
        lead="Jira work items updated recently. Not every update changes recovery; check the ones that might."
        aside={<OriginTag origin="live" />}
      />

      <div className="toolbar" role="search" aria-label="Filter changes">
        <label className="field field-grow">
          <span className="field-label">Search</span>
          <input
            type="search"
            name="q"
            autoComplete="off"
            placeholder="Key or summary"
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Updated</span>
          <select value={window} onChange={(e) => setWindow(e.target.value as UpdatedWindow)}>
            {UPDATED_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {WINDOW_LABELS[w]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Status</span>
          <select
            value={filter.statusCategory}
            onChange={(e) =>
              setFilter({
                ...filter,
                statusCategory: e.target.value as IssueFilter['statusCategory'],
              })
            }
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Type</span>
          <select
            value={filter.issueType}
            onChange={(e) => setFilter({ ...filter, issueType: e.target.value })}
          >
            <option value="all">Any type</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as IssueSort)}>
            <option value="updated-desc">Newest update</option>
            <option value="updated-asc">Oldest update</option>
            <option value="key">Issue key</option>
          </select>
        </label>
        <div className="toolbar-action">
          <Button onClick={retry} isDisabled={state.status === 'loading'}>
            Refresh
          </Button>
        </div>
      </div>

      <DataRegion
        id="changes-results"
        title="Results"
        hideTitle
        intro={
          <p className="visually-hidden" role="status">
            {announcement}
          </p>
        }
        state={state}
        loading={{ label: 'Loading Jira issues', rows: 8 }}
        onRetry={retry}
        isEmpty={(data) => data.issues.length === 0}
        empty={(data) => (
          <EmptyState
            title="No issues you can see were updated in this window"
            action={
              window !== '365d'
                ? { label: 'Show the last 12 months', onClick: () => setWindow('365d') }
                : undefined
            }
          >
            Jira returned no results. Results are limited to projects you can browse.
            <details className="query-details">
              <summary>Show query</summary>
              <code>{data.jql}</code>
            </details>
          </EmptyState>
        )}
      >
        {(data) =>
          visible.length === 0 ? (
            <EmptyState
              title="No issues match these filters"
              action={{ label: 'Clear filters', onClick: () => setFilter(EMPTY_FILTER) }}
            >
              {issues.length} issues were loaded from Jira; none match the current search, status
              and type.
            </EmptyState>
          ) : (
            <>
              <p className="results-meta">
                Showing {visible.length} of {issues.length}
                {data.truncated ? ' (Jira has more; narrow the window to see older ones)' : ''}.
                Fetched {formatAbsolute(data.fetchedAt)}.
              </p>
              <details className="query-details">
                <summary>Show query</summary>
                <code>{data.jql}</code>
              </details>
              <IssueTable
                issues={visible}
                caption="Jira issues updated recently"
                rowAction={(issue) => <CheckImpactButton issue={issue} />}
              />
            </>
          )
        }
      </DataRegion>
    </>
  );
}
