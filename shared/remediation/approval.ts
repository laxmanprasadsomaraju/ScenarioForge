import { canonicalJson } from '../simulation/replay';
import { validateDraft } from './draft';
import {
  buildCreateIssueRequest,
  requestHash,
  type RemediationRequest,
  type RequestContext,
} from './request';
import { sha256Hex } from './sha256';
import { FIXED_ISSUE_TYPES } from './types';
import type {
  ApprovalCheck,
  DraftApproval,
  RemediationAuditRecord,
  RemediationEvent,
  RemediationState,
  RemediationStatus,
  TransitionResult,
  WorkItemDraft,
} from './types';

/**
 * Approval binding and the remediation state machine.
 *
 * An approval holds the SHA-256 of the canonical JSON of the whole draft:
 * project, issue type, summary, description, labels, both links and the
 * source ids. Changing any of them, even one character, gives a different
 * hash, and the approval no longer applies.
 */

export class RemediationError extends Error {
  override name = 'RemediationError';
}

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]*$/;

/** Hash of everything that would be sent. Key order never matters. */
export function draftHash(draft: WorkItemDraft): string {
  return sha256Hex(canonicalJson(draft));
}

/** Records a person's approval of this exact draft. Throws for an invalid draft. */
export function approveDraft(
  draft: WorkItemDraft,
  approverAccountId: string,
  at: string,
  issueTypes: readonly string[] = FIXED_ISSUE_TYPES,
): DraftApproval {
  if (!ACCOUNT_ID_PATTERN.test(approverAccountId)) {
    throw new RemediationError('An approval needs the approver’s Atlassian account id.');
  }
  const problems = validateDraft(draft, issueTypes);
  if (problems.length > 0) {
    throw new RemediationError(`The draft cannot be approved: ${problems[0]!.message}`);
  }
  return { draftHash: draftHash(draft), approverAccountId, approvedAt: at };
}

/**
 * Whether `approval` still covers `draft` for `actorAccountId`.
 *
 * Order: no approval is `missing`; an approval by someone else is
 * `wrong-approver` (one person cannot act on another's approval); a hash that
 * no longer matches is `stale`.
 */
export function checkApproval(
  draft: WorkItemDraft,
  approval: DraftApproval | null | undefined,
  actorAccountId: string,
): ApprovalCheck {
  if (!approval) return 'missing';
  if (approval.approverAccountId !== actorAccountId) return 'wrong-approver';
  return approval.draftHash === draftHash(draft) ? 'valid' : 'stale';
}

/**
 * Records a person's approval of the exact Jira requests built from `draft`
 * for `context`. Keeps `draftHash` (so `checkApproval` still works) and adds
 * `requestHash`, which is what a create must match. Throws when the draft is
 * invalid or cannot be turned into requests.
 */
export function approveRequest(
  draft: WorkItemDraft,
  context: RequestContext,
  approverAccountId: string,
  at: string,
  issueTypes: readonly string[] = FIXED_ISSUE_TYPES,
): DraftApproval {
  const approval = approveDraft(draft, approverAccountId, at, issueTypes);
  const built = buildCreateIssueRequest(draft, context, issueTypes);
  if (!built.ok) {
    throw new RemediationError(`The draft cannot be approved: ${built.message}`);
  }
  return {
    draftHash: approval.draftHash,
    requestHash: requestHash(built.request),
    approverAccountId,
    approvedAt: at,
  };
}

/**
 * Whether `approval` still covers the exact `request` for `actorAccountId`.
 * Same order as `checkApproval`. A draft-only approval (no `requestHash`) is
 * `stale`: it was never given for these bytes.
 */
export function checkRequestApproval(
  request: RemediationRequest,
  approval: DraftApproval | null | undefined,
  actorAccountId: string,
): ApprovalCheck {
  if (!approval) return 'missing';
  if (approval.approverAccountId !== actorAccountId) return 'wrong-approver';
  return approval.requestHash !== undefined && approval.requestHash === requestHash(request)
    ? 'valid'
    : 'stale';
}

/** Allowed moves; anything else is refused. */
export const TRANSITIONS: Record<
  RemediationStatus,
  Partial<Record<RemediationEvent['kind'], RemediationStatus>>
> = {
  drafted: { edit: 'drafted', approve: 'approved' },
  approved: { edit: 'drafted', revoke: 'drafted', 'start-create': 'creating' },
  creating: { created: 'created', failed: 'failed', 'timed-out': 'unknown', adopt: 'created' },
  unknown: { adopt: 'created', failed: 'failed' },
  failed: { retry: 'approved' },
  created: {},
};

export function initialState(draft: WorkItemDraft): RemediationState {
  return { status: 'drafted', draft };
}

/**
 * Applies one event. Returns the next state and its audit record, or the
 * reason the move is refused. Never throws for a refused move.
 */
export function transition(
  state: RemediationState,
  event: RemediationEvent,
  issueTypes: readonly string[] = FIXED_ISSUE_TYPES,
): TransitionResult {
  const to = TRANSITIONS[state.status][event.kind];
  if (!to) {
    return { ok: false, reason: `Cannot ${event.kind} a work item that is ${state.status}.` };
  }
  const refuse = (reason: string): TransitionResult => ({ ok: false, reason });
  let next: RemediationState;
  switch (event.kind) {
    case 'edit':
      next = { status: 'drafted', draft: event.draft };
      break;
    case 'approve': {
      try {
        const approval = approveDraft(state.draft, event.actorAccountId, event.at, issueTypes);
        next = { status: 'approved', draft: state.draft, approval };
      } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error));
      }
      break;
    }
    case 'revoke':
      next = { status: 'drafted', draft: state.draft };
      break;
    case 'start-create': {
      if (state.status !== 'approved') return refuse('Only an approved draft can be created.');
      const check = checkApproval(state.draft, state.approval, event.actorAccountId);
      if (check !== 'valid') return refuse(`The approval is ${check}.`);
      const problems = validateDraft(state.draft, issueTypes);
      if (problems.length > 0) return refuse(problems[0]!.message);
      if (event.duplicates.label !== state.draft.labels[1]) {
        return refuse('The duplicate check searched for a different label.');
      }
      if (event.duplicates.decision !== 'none') {
        return refuse(`The duplicate check found ${event.duplicates.decision} results.`);
      }
      next = { ...state, status: 'creating', startedAt: event.at };
      break;
    }
    case 'created':
    case 'adopt': {
      if (state.status !== 'creating' && state.status !== 'unknown') {
        return refuse('Not waiting for a create result.');
      }
      let issueKey: string;
      if (event.kind === 'adopt') {
        if (event.duplicates.decision !== 'duplicate' || !event.duplicates.issueKey) {
          return refuse('Adopting needs exactly one existing work item with the label.');
        }
        if (event.duplicates.label !== state.draft.labels[1]) {
          return refuse('The duplicate check searched for a different label.');
        }
        issueKey = event.duplicates.issueKey;
      } else {
        issueKey = event.issueKey;
      }
      if (!ISSUE_KEY_PATTERN.test(issueKey) || !issueKey.startsWith(`${state.draft.projectKey}-`)) {
        return refuse(`${issueKey} is not a work item key in ${state.draft.projectKey}.`);
      }
      next = {
        status: 'created',
        draft: state.draft,
        approval: state.approval,
        issueKey,
        adopted: event.kind === 'adopt',
        at: event.at,
      };
      break;
    }
    case 'failed':
      if (state.status !== 'creating' && state.status !== 'unknown') {
        return refuse('Not waiting for a create result.');
      }
      next = {
        status: 'failed',
        draft: state.draft,
        approval: state.approval,
        message: event.message,
        at: event.at,
      };
      break;
    case 'timed-out':
      if (state.status !== 'creating') return refuse('Not waiting for a create result.');
      next = { status: 'unknown', draft: state.draft, approval: state.approval, at: event.at };
      break;
    case 'retry': {
      if (state.status !== 'failed') return refuse('Only a failed create can be retried.');
      const check = checkApproval(state.draft, state.approval, event.actorAccountId);
      if (check !== 'valid') return refuse(`The approval is ${check}.`);
      next = { status: 'approved', draft: state.draft, approval: state.approval };
      break;
    }
  }
  if (next.status !== to) return refuse(`Internal: ${event.kind} led to ${next.status}.`);
  return { ok: true, state: next, audit: auditRecord(state, next, event) };
}

function auditRecord(
  from: RemediationState,
  to: RemediationState,
  event: RemediationEvent,
): RemediationAuditRecord {
  const record: RemediationAuditRecord = {
    schemaVersion: 1,
    event: event.kind,
    from: from.status,
    to: to.status,
    at: event.at,
    actorAccountId: 'actorAccountId' in event ? event.actorAccountId : null,
    draftHash: draftHash(to.draft),
    idempotencyLabel: to.draft.labels[1] ?? '',
    changeKey: to.draft.source.changeKey,
    findingId: to.draft.source.findingId,
  };
  if (to.status === 'created') record.issueKey = to.issueKey;
  if (to.status === 'failed') record.message = to.message;
  return record;
}
