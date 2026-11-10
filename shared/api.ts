/**
 * Contract between the Custom UI frontend and Forge resolver functions.
 * Resolvers never throw to the client: they return an ApiResult so the UI can
 * show an explicit error state instead of stale or fabricated data.
 */

import type { EvidenceReference, RecoveryStep } from './domain/types';
import type {
  ApprovalCheck,
  DraftApproval,
  DuplicateCheck,
  RemediationRequest,
  WorkItemDraft,
} from './remediation';

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

/*
 * Confluence recovery procedures (M2). The browser never sends CQL: it picks
 * from enumerated recovery terms and may narrow to one validated space key.
 */

export const RECOVERY_TERMS = ['runbook', 'recovery', 'failover', 'disaster recovery'] as const;
export type RecoveryTerm = (typeof RECOVERY_TERMS)[number];

export interface ListRecoveryPagesRequest {
  /** Matched with OR. Defaults to every recovery term. */
  terms: RecoveryTerm[];
  spaceKey: string | null;
  maxResults: number;
}

export const MAX_RECOVERY_PAGES = 25;

export interface ConfluencePageSummary {
  /** Numeric Confluence content id, as a string. */
  id: string;
  title: string;
  spaceKey: string | null;
  lastUpdated: string | null;
  /** Path relative to the Confluence base (`<site>/wiki`), e.g. /spaces/OPS/pages/123/Runbook. */
  webuiPath: string | null;
}

export interface ListRecoveryPagesResponse {
  pages: ConfluencePageSummary[];
  /** True when Confluence reported more results than were returned. */
  truncated: boolean;
  fetchedAt: string;
  cql: string;
}

export interface GetRecoveryProcedureRequest {
  pageId: string;
}

export interface RecoveryProcedureExcerpt {
  pageId: string;
  title: string;
  spaceId: string | null;
  lastUpdated: string | null;
  webuiPath: string | null;
  /** Plain text of the page body with all markup removed, possibly shortened. */
  excerpt: string;
  /** True when `excerpt` was cut to the length limit. */
  excerptTruncated: boolean;
  /** Items of the first top-level ordered list, in document order. */
  steps: RecoveryStep[];
  /** `none` means the page has no ordered list; steps were not guessed. */
  stepSource: 'ordered-list' | 'none';
  evidence: EvidenceReference;
}

/*
 * Change-to-recovery analysis (M3). The contract lives in shared/analysis;
 * re-exported here so the UI can import every resolver type from one place.
 */
export type { AnalyzeChangeRequest, AnalyzeChangeResponse, ChangeAnalysis } from './analysis/types';

/* Readiness graph (M4). The contract lives in shared/graph. */
export type {
  GetReadinessGraphRequest,
  GetReadinessGraphResponse,
  ReadinessGraph,
} from './graph/types';

/*
 * M8 remediation preparation (read-only). The browser names the finding, fix,
 * project and issue type; the server rebuilds everything else, including
 * every absolute URL, from Jira and Confluence as the user. Nothing is created.
 */

export interface PrepareRemediationRequest {
  changeKey: string;
  findingId: string;
  /** `rem-step`, `rem-change-check` or `review-step`. */
  fixId: string;
  projectKey: string;
  issueTypeName: string;
  /** User-edited summary; the deterministic template when omitted. */
  summary?: string;
}

export interface PrepareRemediationResponse {
  draft: WorkItemDraft;
  /** The exact calls creating the work item would make. Not sent. */
  request: RemediationRequest;
  draftHash: string;
  requestHash: string;
  /** Result of `labels = "<idempotency label>"`, read as the user. */
  duplicate: DuplicateCheck;
  /** Site origin from `GET /rest/api/3/serverInfo`, used for every link. */
  siteUrl: string;
  preparedAt: string;
}

export interface CheckRemediationApprovalRequest extends PrepareRemediationRequest {
  /** The request hash the person saw. */
  requestHash: string;
  approval: DraftApproval;
}

export interface CheckRemediationApprovalResponse {
  /** `stale` when the fresh request differs from what was seen or approved. */
  check: ApprovalCheck;
  /** Hash of the request rebuilt now. */
  requestHash: string;
  duplicate: DuplicateCheck;
  checkedAt: string;
}
