import type { ApiError, JiraIssueSummary } from '../../shared/api';

const STATUS_CATEGORIES = new Set(['new', 'indeterminate', 'done']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Maps one issue from Jira's search response. Missing optional fields are
 * reported as "Unknown" rather than guessed; issues without a usable key are
 * dropped because they cannot be linked back to their source.
 */
export function mapIssue(raw: unknown): JiraIssueSummary | null {
  const issue = asRecord(raw);
  const key = asString(issue?.key);
  if (!issue || !key || !/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
    return null;
  }
  const fields = asRecord(issue.fields) ?? {};
  const status = asRecord(fields.status);
  const category = asString(asRecord(status?.statusCategory)?.key);
  const project = asRecord(fields.project);

  return {
    key,
    summary: asString(fields.summary) ?? '(no summary)',
    status: asString(status?.name) ?? 'Unknown',
    statusCategory:
      category && STATUS_CATEGORIES.has(category)
        ? (category as JiraIssueSummary['statusCategory'])
        : 'unknown',
    issueType: asString(asRecord(fields.issuetype)?.name) ?? 'Unknown',
    projectKey: asString(project?.key) ?? key.split('-')[0] ?? null,
    updated: asString(fields.updated),
    browsePath: `/browse/${key}`,
  };
}

export interface MappedSearch {
  issues: JiraIssueSummary[];
  truncated: boolean;
}

export function mapSearchResponse(body: unknown): MappedSearch | null {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.issues)) {
    return null;
  }
  const issues = record.issues.map(mapIssue).filter((i): i is JiraIssueSummary => i !== null);
  const truncated = record.isLast === false || typeof record.nextPageToken === 'string';
  return { issues, truncated };
}

/** Translates an Atlassian HTTP status into a user-safe error. */
export function errorFromStatus(status: number): ApiError {
  switch (status) {
    case 400:
      return {
        code: 'INVALID_REQUEST',
        message: 'Jira rejected the search request.',
        upstreamStatus: status,
      };
    case 401:
      return {
        code: 'UNAUTHENTICATED',
        message: 'ScenarioForge is not authorised to read Jira as you. Grant access and try again.',
        upstreamStatus: status,
      };
    case 403:
      return {
        code: 'FORBIDDEN',
        message: 'You do not have permission to browse these Jira issues.',
        upstreamStatus: status,
      };
    case 404:
      return {
        code: 'NOT_FOUND',
        message: 'The Jira resource was not found.',
        upstreamStatus: status,
      };
    case 429:
      return {
        code: 'RATE_LIMITED',
        message: 'Jira is rate limiting requests. Wait a moment and retry.',
        upstreamStatus: status,
      };
    default:
      return {
        code: 'UPSTREAM_ERROR',
        message: `Jira returned an unexpected error (HTTP ${status}).`,
        upstreamStatus: status,
      };
  }
}
