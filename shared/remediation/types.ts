/**
 * M8 contract: a Jira work item drafted from a finding, approved by a person,
 * and only then created (docs/M8_PLAN.md).
 *
 * Everything here is pure data. Nothing in shared/remediation calls Jira or
 * Confluence; creating the work item is a later, separately approved step that
 * needs the `write:jira-work` scope, which is not granted.
 *
 * Principles:
 * - The destination project and issue type are always the user's choice;
 *   nothing is assumed or defaulted.
 * - The draft is exactly what would be sent. The approval is bound to a hash
 *   of every field, so any change after approval makes the approval stale.
 * - Quotes from the change and the runbook step are copied verbatim.
 */
import type { RetestComparison } from '../simulation/types';

/** Issue types offered until createmeta is read live (M8_PLAN §1). */
export const FIXED_ISSUE_TYPES = ['Task', 'Bug', 'Story'] as const;

/** Fixed label on every work item ScenarioForge creates. */
export const REMEDIATION_LABEL = 'scenarioforge-remediation';

/** Jira's summary limit. */
export const MAX_SUMMARY_LENGTH = 255;

/**
 * Description limit, below Jira's 32,767-character text field limit so the
 * ADF conversion (paragraph wrappers) cannot push it over.
 */
export const MAX_DESCRIPTION_LENGTH = 30_000;

/** The proposed fix the work item asks for (a scenario remediation action). */
export interface DraftFix {
  id: string;
  title: string;
  description: string;
}

/** A retest result to quote in the description, with readable objective names. */
export interface DraftRehearsalResult {
  comparison: RetestComparison;
  objectiveLabels: Record<string, string>;
}

export interface BuildDraftOptions {
  /** Destination project key, as typed or picked by the user. Never defaulted. */
  projectKey: string;
  /** Issue type, as picked by the user from `issueTypes`. */
  issueType: string;
  /** The list the user picked from (createmeta later; FIXED_ISSUE_TYPES for now). */
  issueTypes: readonly string[];
  /** The fix the work item is for. Without one, the item asks to review the step. */
  fix?: DraftFix;
  /** User-edited summary; when omitted the deterministic template is used. */
  summary?: string;
  /**
   * Site base URL, e.g. https://example.atlassian.net. When given, links are
   * absolute; otherwise they stay site-relative (/browse/..., /wiki/...).
   */
  siteUrl?: string | null;
}

/** Issue link to the change, sent as `POST /rest/api/3/issueLink`. */
export interface DraftIssueLink {
  type: 'Relates';
  /** The change the new work item relates to. */
  issueKey: string;
  url: string;
}

/** Remote link to the runbook page, sent as `POST /rest/api/3/issue/{key}/remotelink`. */
export interface DraftRemoteLink {
  /** Create-or-update key, so a retry never adds a second link. */
  globalId: string;
  url: string;
  title: string;
}

/** Exactly what would be sent to Jira. Every field is covered by the approval hash. */
export interface WorkItemDraft {
  schemaVersion: 1;
  projectKey: string;
  issueType: string;
  summary: string;
  /** Plain text, converted to ADF paragraph by paragraph at creation. */
  description: string;
  /** `REMEDIATION_LABEL` first, then the idempotency label. */
  labels: string[];
  links: {
    issueLink: DraftIssueLink;
    /** Null when the analysis has no page path to link to. */
    remoteLink: DraftRemoteLink | null;
  };
  /** Where the draft came from; also hashed, so a draft cannot be moved to another finding. */
  source: {
    changeKey: string;
    findingId: string;
    fixId: string;
    pageId: string;
    stepOrder: number;
  };
}

export type BuildDraftError = 'FINDING_NOT_FOUND' | 'ANALYSIS_NOT_USABLE';

export type BuildDraftResult =
  { ok: true; draft: WorkItemDraft } | { ok: false; error: BuildDraftError; message: string };

export type DraftField =
  'projectKey' | 'issueType' | 'summary' | 'description' | 'labels' | 'links';

export interface DraftProblem {
  field: DraftField;
  message: string;
}

/** A person's approval of one exact draft. */
export interface DraftApproval {
  /** SHA-256 of the canonical JSON of the whole draft. */
  draftHash: string;
  /**
   * SHA-256 of the canonical JSON of the exact Jira requests (request.ts).
   * Set by `approveRequest`; an approval without it never covers a request.
   */
  requestHash?: string;
  approverAccountId: string;
  approvedAt: string;
}

export type ApprovalCheck = 'valid' | 'stale' | 'missing' | 'wrong-approver';

/* State machine: drafted -> approved -> creating -> created | failed | unknown */

export type RemediationState =
  | { status: 'drafted'; draft: WorkItemDraft }
  | { status: 'approved'; draft: WorkItemDraft; approval: DraftApproval }
  | { status: 'creating'; draft: WorkItemDraft; approval: DraftApproval; startedAt: string }
  | {
      status: 'created';
      draft: WorkItemDraft;
      approval: DraftApproval;
      issueKey: string;
      /** True when an existing work item with the idempotency label was adopted. */
      adopted: boolean;
      at: string;
    }
  | { status: 'failed'; draft: WorkItemDraft; approval: DraftApproval; message: string; at: string }
  /** Sent, but no answer (e.g. timeout); resolved only by the duplicate search. */
  | { status: 'unknown'; draft: WorkItemDraft; approval: DraftApproval; at: string };

export type RemediationStatus = RemediationState['status'];

export type RemediationEvent =
  /** Replace the draft (any field edit). Drops any approval. */
  | { kind: 'edit'; draft: WorkItemDraft; actorAccountId: string; at: string }
  | { kind: 'approve'; actorAccountId: string; at: string }
  | { kind: 'revoke'; actorAccountId: string; at: string }
  /** Needs a valid approval by the same person and a duplicate check of 'none'. */
  | { kind: 'start-create'; actorAccountId: string; at: string; duplicates: DuplicateCheck }
  | { kind: 'created'; issueKey: string; at: string }
  | { kind: 'failed'; message: string; at: string }
  | { kind: 'timed-out'; at: string }
  /** From `unknown` (or `creating`): the duplicate search found the item that was created. */
  | { kind: 'adopt'; duplicates: DuplicateCheck; at: string }
  /** From `failed`: back to approved, so the same approval can be retried. */
  | { kind: 'retry'; actorAccountId: string; at: string };

/** One entry per accepted transition; never edited afterwards. */
export interface RemediationAuditRecord {
  schemaVersion: 1;
  event: RemediationEvent['kind'];
  from: RemediationStatus | null;
  to: RemediationStatus;
  at: string;
  /** Null for system events (create results). */
  actorAccountId: string | null;
  draftHash: string;
  idempotencyLabel: string;
  changeKey: string;
  findingId: string;
  issueKey?: string;
  message?: string;
}

export type TransitionResult =
  | { ok: true; state: RemediationState; audit: RemediationAuditRecord }
  | { ok: false; reason: string };

/** A work item returned by the duplicate search (`labels = "<idempotency label>"`). */
export interface ExistingWorkItem {
  key: string;
  summary: string;
  labels: string[];
}

export type DuplicateDecision = 'none' | 'duplicate' | 'ambiguous';

export interface DuplicateCheck {
  decision: DuplicateDecision;
  /** The idempotency label searched for. */
  label: string;
  /** Key to adopt when `duplicate`. */
  issueKey?: string;
  /** Every key the search returned, for the audit. */
  matches: string[];
  reason: string;
}
