import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import type { ApiResult, JiraIssueSummary, ListChangesResponse } from '@shared/api';
import { ExerciseProvider } from '../src/lib/exercises';
import { RouterProvider } from '../src/lib/router';
import { SiteProvider } from '../src/lib/site';

/** Renders UI inside the same providers the app uses, with the mocked bridge. */
export function renderInApp(ui: ReactNode) {
  return render(
    <SiteProvider>
      <RouterProvider>
        <ExerciseProvider>{ui}</ExerciseProvider>
      </RouterProvider>
    </SiteProvider>,
  );
}

export function issue(overrides: Partial<JiraIssueSummary> = {}): JiraIssueSummary {
  const key = overrides.key ?? 'SF-1';
  return {
    key,
    summary: 'Retire the backup identity provider',
    status: 'Done',
    statusCategory: 'done',
    issueType: 'Change',
    projectKey: 'SF',
    updated: new Date(Date.now() - 3 * 3600_000).toISOString(),
    browsePath: `/browse/${key}`,
    ...overrides,
  };
}

export function changes(issues: JiraIssueSummary[]): ApiResult<ListChangesResponse> {
  return {
    ok: true,
    data: {
      issues,
      truncated: false,
      fetchedAt: new Date().toISOString(),
      jql: 'updated >= -30d ORDER BY updated DESC',
    },
  };
}
