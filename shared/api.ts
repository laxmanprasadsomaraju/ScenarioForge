/**
 * Contract between the Custom UI frontend and Forge resolver functions.
 * Resolvers never throw to the client: they return an ApiResult so the UI can
 * show an explicit error state instead of stale or fabricated data.
 */

export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'UNEXPECTED_RESPONSE';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** HTTP status returned by the Atlassian API, when there was one. */
  upstreamStatus?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export const UPDATED_WINDOWS = ['7d', '30d', '90d', '365d'] as const;
export type UpdatedWindow = (typeof UPDATED_WINDOWS)[number];

export interface ListChangesRequest {
  updatedWithin: UpdatedWindow;
  maxResults: number;
}

export const MAX_RESULTS_LIMIT = 50;

export interface JiraIssueSummary {
  key: string;
  summary: string;
  status: string;
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown';
  issueType: string;
  projectKey: string | null;
  updated: string | null;
  /** Relative Jira path, e.g. /browse/SF-1. Joined with the site URL in the UI. */
  browsePath: string;
}

export interface ListChangesResponse {
  issues: JiraIssueSummary[];
  /** True when Jira reported more results than were returned. */
  truncated: boolean;
  fetchedAt: string;
  jql: string;
}

export interface ConnectionStatus {
  connected: boolean;
  userDisplayName: string | null;
  checkedAt: string;
}
