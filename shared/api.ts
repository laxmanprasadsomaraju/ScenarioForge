/**
 * Contract between the Custom UI frontend and Forge resolver functions.
 * Resolvers never throw to the client: they return an ApiResult so the UI can
 * show an explicit error state instead of stale or fabricated data.
 */

import type {
  EvidenceReference,
  ExerciseEvaluation,
  RecoveryStep,
  SimulationScenario,
} from './domain/types';
import type {
  HistoryListItem,
  PrunedEntry,
  RejectReason,
  VerifiedRetest,
  VerifiedRun,
} from './history/types';
import { scenarioFingerprint } from './simulation/replay';
import type { RetestComparison } from './simulation/types';
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
  | 'UNEXPECTED_RESPONSE'
  /** M8: creating work items is not enabled in this build (no write gateway). */
  | 'WRITE_NOT_PERMITTED'
  /** M8: the approval is missing, by someone else, stale or too old. */
  | 'APPROVAL_INVALID'
  /** M8: another create for the same fix is in progress, or the duplicate check is ambiguous. */
  | 'CONFLICT'
  /** M8: no server-side store for approvals and create state. */
  | 'STORAGE_UNAVAILABLE';

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
  /** Source state the draft was built from; bound into a server-issued approval. */
  source: ApprovalSource;
}

/** The change and finding a draft was built from, as the request builder used them. */
export interface ApprovalSource {
  changeKey: string;
  /** The change's `updated` as read from Jira (null when absent). */
  changeUpdated: string | null;
  findingId: string;
  fixId: string;
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

/**
 * M8 approve: the person approves the exact request they saw (`requestHash`).
 * The server derives the approver from the invocation context and stamps the
 * time itself; the browser can send neither.
 */
export interface ApproveRemediationRequest extends PrepareRemediationRequest {
  /** The request hash the person saw. */
  requestHash: string;
}

/** What the server issued. Holds no account id; the approver is kept server-side. */
export interface ApproveRemediationResponse {
  /** Opaque, unguessable, single-use reference to the stored approval. */
  approvalId: string;
  requestHash: string;
  /** Server clock. */
  approvedAt: string;
  /** Server clock: `approvedAt` plus 24 hours. */
  expiresAt: string;
}

/**
 * M8 create: the same inputs as prepare plus the id of a server-issued
 * approval. No approval record, time, approver or hash is accepted.
 */
export interface CreateRemediationWorkItemRequest extends PrepareRemediationRequest {
  approvalId: string;
}

/** Result of one follow-up call after the work item exists. */
export type RemediationLinkOutcome =
  | { status: 'added' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; message: string; upstreamStatus?: number };

export interface CreateRemediationWorkItemResponse {
  /**
   * `created`: work item and every link in place. `created-with-follow-up`:
   * the work item exists but a link was not added (never re-created).
   * `unknown`: the create was sent with no clear answer and no work item
   * carries the label yet; checking again never sends a second create.
   */
  outcome: 'created' | 'created-with-follow-up' | 'unknown';
  issueKey?: string;
  /** `<trusted site>/browse/<key>`, built server-side. */
  issueUrl?: string;
  /** True when an existing work item with the idempotency label was adopted. */
  adopted: boolean;
  issueLink: RemediationLinkOutcome;
  remoteLink: RemediationLinkOutcome;
  idempotencyLabel: string;
  message: string;
}

/*
 * Rehearsal history (M6 §6). The browser never sends an accountId or a
 * scenario: the server takes the user from the Forge context and rebuilds the
 * scenario itself (regenerated asUser, or a fixed authored demo id).
 */

/** Detail of every history result while storage is not wired up. */
export const HISTORY_NOT_ENABLED = 'Rehearsal history is not enabled in this environment.';

/** Where a rehearsal came from, as the server needs it to rebuild the scenario. */
export type RehearsalSourceRef =
  | { kind: 'demo'; scenarioId: string }
  | {
      kind: 'generated';
      changeKey: string;
      findingId: string;
      restoreTargetMinutes: number;
      notifyTargetMinutes: number;
    };

/** What the browser reports after a run; the server replays and recomputes it. */
export interface RehearsalSubmission {
  sessionId: string;
  startedAt: string;
  decisionIds: string[];
  /** `rehearsalContentFingerprint` of the scenario the browser played. */
  contentFingerprint: string;
  evaluation: ExerciseEvaluation;
  flags: Record<string, number>;
}

export interface SaveRehearsalRunRequest {
  source: RehearsalSourceRef;
  submission: RehearsalSubmission;
}

export interface SaveRetestRequest {
  /** Session id of the stored original run. */
  originalRunId: string;
  remediationIds: string[];
  submission: RehearsalSubmission;
}

export interface GetRehearsalRunRequest {
  runId: string;
}

export interface GetRetestComparisonRequest {
  retestId: string;
}

/** Storage is not configured, or could not be reached. `detail` is shown to the user. */
export interface HistoryUnavailable {
  status: 'UNAVAILABLE';
  detail: string;
}

/** The Forge context had no usable user; history is never read or written anonymously. */
export interface HistoryIdentityUnavailable {
  status: 'IDENTITY_UNAVAILABLE';
  detail: string;
}

export type HistoryGate = HistoryUnavailable | HistoryIdentityUnavailable;

/** Verification failures carry no record content and no problem list. */
export type HistoryVerificationFailure = { status: 'TAMPERED' } | { status: 'UNVERIFIABLE' };

export type ListRehearsalHistoryResponse =
  | { status: 'OK'; items: HistoryListItem[]; pruned: PrunedEntry[] }
  | { status: 'CONFLICT' }
  | HistoryGate;

export type GetRehearsalRunResponse =
  | { status: 'OK'; run: VerifiedRun }
  | { status: 'NOT_FOUND' }
  | HistoryVerificationFailure
  | HistoryGate;

export type GetRetestComparisonResponse =
  | { status: 'OK'; original: VerifiedRun; retest: VerifiedRetest; comparison: RetestComparison }
  | { status: 'NOT_FOUND' }
  | HistoryVerificationFailure
  | HistoryGate;

export type SaveRehearsalResponse =
  | { status: 'SAVED'; id: string; pruned: PrunedEntry[] }
  | { status: 'REJECTED'; reason: RejectReason; message: string }
  | { status: 'TOO_LARGE'; bytes: number; limit: number }
  | { status: 'CONFLICT' }
  | HistoryGate;

export type {
  HistoryIndexEntry,
  HistoryListItem,
  PrunedEntry,
  RejectReason,
  VerifiedRetest,
  VerifiedRun,
} from './history/types';

/**
 * Scenario fingerprint with evidence retrieval times left out. A scenario the
 * server regenerates from unchanged Jira and Confluence content differs from
 * the browser's copy only in `retrievedAt`, so this is what both sides compare.
 */
export function rehearsalContentFingerprint(scenario: SimulationScenario): string {
  return scenarioFingerprint(withoutRetrievalTimes(scenario) as SimulationScenario);
}

function withoutRetrievalTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRetrievalTimes);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'retrievedAt')
        .map(([key, v]) => [key, withoutRetrievalTimes(v)]),
    );
  }
  return value;
}
