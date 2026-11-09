import { describe, expect, it } from 'vitest';
import type { JiraIssueSummary } from '../shared/api';
import { distinctIssueTypes, filterAndSortIssues } from '../shared/issueFilters';

function issue(key: string, overrides: Partial<JiraIssueSummary> = {}): JiraIssueSummary {
  return {
    key,
    summary: `Summary ${key}`,
    status: 'To Do',
    statusCategory: 'new',
    issueType: 'Task',
    projectKey: key.split('-')[0] ?? null,
    updated: null,
    browsePath: `/browse/${key}`,
    ...overrides,
  };
}

const ISSUES = [
  issue('SF-2', { updated: '2026-11-01T00:00:00.000Z', issueType: 'Bug', statusCategory: 'done' }),
  issue('SF-10', { updated: '2026-11-05T00:00:00.000Z', summary: 'Retire backup SSO' }),
  issue('OPS-1', { updated: null }),
  issue('SF-1', { updated: '2026-10-01T00:00:00.000Z', statusCategory: 'indeterminate' }),
];
const ALL = { text: '', statusCategory: 'all', issueType: 'all' } as const;

describe('filterAndSortIssues', () => {
  it('sorts by most recently updated with undated issues last', () => {
    expect(filterAndSortIssues(ISSUES, ALL, 'updated-desc').map((i) => i.key)).toEqual([
      'SF-10',
      'SF-2',
      'SF-1',
      'OPS-1',
    ]);
    expect(filterAndSortIssues(ISSUES, ALL, 'updated-asc').map((i) => i.key)).toEqual([
      'SF-1',
      'SF-2',
      'SF-10',
      'OPS-1',
    ]);
  });

  it('sorts keys numerically within a project', () => {
    expect(filterAndSortIssues(ISSUES, ALL, 'key').map((i) => i.key)).toEqual([
      'OPS-1',
      'SF-1',
      'SF-2',
      'SF-10',
    ]);
  });

  it('filters by text, status category and type', () => {
    expect(filterAndSortIssues(ISSUES, { ...ALL, text: 'sso' }, 'key').map((i) => i.key)).toEqual([
      'SF-10',
    ]);
    expect(filterAndSortIssues(ISSUES, { ...ALL, text: 'ops-' }, 'key').map((i) => i.key)).toEqual([
      'OPS-1',
    ]);
    expect(filterAndSortIssues(ISSUES, { ...ALL, statusCategory: 'done' }, 'key')).toHaveLength(1);
    expect(
      filterAndSortIssues(ISSUES, { ...ALL, issueType: 'Bug' }, 'key').map((i) => i.key),
    ).toEqual(['SF-2']);
  });

  it('does not mutate its input', () => {
    const copy = [...ISSUES];
    filterAndSortIssues(ISSUES, ALL, 'key');
    expect(ISSUES).toEqual(copy);
  });

  it('lists distinct issue types', () => {
    expect(distinctIssueTypes(ISSUES)).toEqual(['Bug', 'Task']);
  });
});
