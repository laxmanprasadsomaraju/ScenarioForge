import type { JiraIssueSummary } from './api';

export type IssueSort = 'updated-desc' | 'updated-asc' | 'key';

export interface IssueFilter {
  text: string;
  statusCategory: JiraIssueSummary['statusCategory'] | 'all';
  issueType: string | 'all';
}

function keyParts(key: string): [string, number] {
  const [project = '', number = '0'] = key.split('-');
  return [project, Number(number)];
}

function updatedTime(issue: JiraIssueSummary): number {
  const time = issue.updated ? Date.parse(issue.updated) : NaN;
  return Number.isNaN(time) ? -Infinity : time;
}

export function filterAndSortIssues(
  issues: readonly JiraIssueSummary[],
  filter: IssueFilter,
  sort: IssueSort,
): JiraIssueSummary[] {
  const text = filter.text.trim().toLowerCase();
  const filtered = issues.filter(
    (issue) =>
      (filter.statusCategory === 'all' || issue.statusCategory === filter.statusCategory) &&
      (filter.issueType === 'all' || issue.issueType === filter.issueType) &&
      (text === '' ||
        issue.key.toLowerCase().includes(text) ||
        issue.summary.toLowerCase().includes(text)),
  );

  return filtered.sort((a, b) => {
    if (sort === 'key') {
      const [pa, na] = keyParts(a.key);
      const [pb, nb] = keyParts(b.key);
      return pa === pb ? na - nb : pa.localeCompare(pb);
    }
    // Issues with no updated date always sort last.
    const ta = updatedTime(a);
    const tb = updatedTime(b);
    if (ta === tb) return 0;
    if (ta === -Infinity) return 1;
    if (tb === -Infinity) return -1;
    return sort === 'updated-desc' ? tb - ta : ta - tb;
  });
}

export function distinctIssueTypes(issues: readonly JiraIssueSummary[]): string[] {
  return [...new Set(issues.map((i) => i.issueType))].sort();
}
