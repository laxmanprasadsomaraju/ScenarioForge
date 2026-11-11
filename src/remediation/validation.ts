import type {
  ApproveRemediationRequest,
  CheckRemediationApprovalRequest,
  CreateRemediationWorkItemRequest,
  PrepareRemediationRequest,
} from '../../shared/api';
import {
  FIXED_ISSUE_TYPES,
  MAX_SUMMARY_LENGTH,
  PROJECT_KEY_PATTERN,
  REVIEW_STEP_FIX_ID,
  type DraftApproval,
} from '../../shared/remediation';
import { REMEDIATION_IDS } from '../../shared/rehearsal/generate';
import type { Validated } from '../validation';
import { isIssueKey } from '../validation';

/**
 * Validates the untrusted payloads of the remediation resolvers. Only the
 * named fields are read; anything else the browser sends (for example a site
 * URL, a link or a description) is ignored and never reaches a draft.
 */

/** Fixes a work item can be drafted for. */
export const FIX_IDS = [REMEDIATION_IDS.step, REMEDIATION_IDS.process, REVIEW_STEP_FIX_ID] as const;

/** Finding ids from shared/analysis: `<change>:<pageId>:<step>:<subject term>`. */
const FINDING_ID = /^([A-Z][A-Z0-9_]*-\d+):\d{1,19}:\d{1,4}:[A-Za-z0-9._-]{1,40}$/;
const HASH = /^[0-9a-f]{64}$/;
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_TIMESTAMP_LENGTH = 40;

function asRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

export function parsePrepareRemediationRequest(
  payload: unknown,
): Validated<PrepareRemediationRequest> {
  const record = asRecord(payload);
  if (!record) {
    return { ok: false, message: 'Request payload must be an object.' };
  }
  const { changeKey, findingId, fixId, projectKey, issueTypeName, summary } = record;
  if (!isIssueKey(changeKey)) {
    return { ok: false, message: 'changeKey must be a Jira issue key such as OPS-123.' };
  }
  const findingMatch = typeof findingId === 'string' ? FINDING_ID.exec(findingId) : null;
  if (!findingMatch || findingMatch[1] !== changeKey) {
    return { ok: false, message: `findingId must be a finding of ${changeKey}.` };
  }
  if (typeof fixId !== 'string' || !(FIX_IDS as readonly string[]).includes(fixId)) {
    return { ok: false, message: `fixId must be one of ${FIX_IDS.join(', ')}.` };
  }
  if (typeof projectKey !== 'string' || !PROJECT_KEY_PATTERN.test(projectKey)) {
    return { ok: false, message: 'projectKey must be a Jira project key such as OPS.' };
  }
  if (
    typeof issueTypeName !== 'string' ||
    !(FIXED_ISSUE_TYPES as readonly string[]).includes(issueTypeName)
  ) {
    return { ok: false, message: `issueTypeName must be one of ${FIXED_ISSUE_TYPES.join(', ')}.` };
  }
  const value: PrepareRemediationRequest = {
    changeKey,
    findingId: findingId as string,
    fixId,
    projectKey,
    issueTypeName,
  };
  if (summary !== undefined && summary !== null) {
    if (
      typeof summary !== 'string' ||
      summary.trim() === '' ||
      summary.length > MAX_SUMMARY_LENGTH ||
      /[\r\n]/.test(summary)
    ) {
      return {
        ok: false,
        message: `summary must be one line of 1 to ${MAX_SUMMARY_LENGTH} characters.`,
      };
    }
    value.summary = summary;
  }
  return { ok: true, value };
}

function parseApproval(value: unknown): DraftApproval | null {
  const record = asRecord(value);
  if (!record) return null;
  const { draftHash, requestHash, approverAccountId, approvedAt } = record;
  if (
    typeof draftHash !== 'string' ||
    !HASH.test(draftHash) ||
    (requestHash !== undefined && (typeof requestHash !== 'string' || !HASH.test(requestHash))) ||
    typeof approverAccountId !== 'string' ||
    !ACCOUNT_ID.test(approverAccountId) ||
    typeof approvedAt !== 'string' ||
    approvedAt.length > MAX_TIMESTAMP_LENGTH
  ) {
    return null;
  }
  return {
    draftHash,
    ...(requestHash !== undefined ? { requestHash: requestHash as string } : {}),
    approverAccountId,
    approvedAt,
  };
}

export function parseCheckRemediationApprovalRequest(
  payload: unknown,
): Validated<CheckRemediationApprovalRequest> {
  const prepared = parsePrepareRemediationRequest(payload);
  if (!prepared.ok) return prepared;
  const record = asRecord(payload)!;
  if (typeof record.requestHash !== 'string' || !HASH.test(record.requestHash)) {
    return { ok: false, message: 'requestHash must be 64 lowercase hex characters.' };
  }
  const approval = parseApproval(record.approval);
  if (!approval) {
    return { ok: false, message: 'approval is not a ScenarioForge approval record.' };
  }
  return {
    ok: true,
    value: { ...prepared.value, requestHash: record.requestHash, approval },
  };
}

/** Fields that name who approved, when, or how old: the server alone decides these. */
const AUTHORITY_FIELDS = [
  'approval',
  'approvedAt',
  'approver',
  'approverAccountId',
  'accountId',
  'expiresAt',
  'age',
  'draftHash',
] as const;

const PREPARE_FIELDS = [
  'changeKey',
  'findingId',
  'fixId',
  'projectKey',
  'issueTypeName',
  'summary',
] as const;

/** Server-issued approval ids: `sfa-` and 32 lowercase hex characters. */
export const APPROVAL_ID_PATTERN = /^sfa-[0-9a-f]{32}$/;

/**
 * Strict payloads for the two authority-bearing resolvers: any field outside
 * the allow-list is rejected, and fields that would carry an approver, a time
 * or an age get a specific message. Nothing the browser sends can set them.
 */
function rejectUnexpected(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  for (const field of Object.keys(record)) {
    if ((AUTHORITY_FIELDS as readonly string[]).includes(field)) {
      return 'The approver, approval time and age are set by the server and cannot be sent.';
    }
    if (!allowed.includes(field)) return 'The request contains a field that is not accepted.';
  }
  return null;
}

export function parseApproveRemediationRequest(
  payload: unknown,
): Validated<ApproveRemediationRequest> {
  const record = asRecord(payload);
  if (!record) return { ok: false, message: 'Request payload must be an object.' };
  const unexpected = rejectUnexpected(record, [...PREPARE_FIELDS, 'requestHash']);
  if (unexpected) return { ok: false, message: unexpected };
  const prepared = parsePrepareRemediationRequest(payload);
  if (!prepared.ok) return prepared;
  if (typeof record.requestHash !== 'string' || !HASH.test(record.requestHash)) {
    return { ok: false, message: 'requestHash must be 64 lowercase hex characters.' };
  }
  return { ok: true, value: { ...prepared.value, requestHash: record.requestHash } };
}

/** Create payload: the prepare fields and the id of a server-issued approval. Nothing else. */
export function parseCreateRemediationWorkItemRequest(
  payload: unknown,
): Validated<CreateRemediationWorkItemRequest> {
  const record = asRecord(payload);
  if (!record) return { ok: false, message: 'Request payload must be an object.' };
  const unexpected = rejectUnexpected(record, [...PREPARE_FIELDS, 'approvalId']);
  if (unexpected) return { ok: false, message: unexpected };
  const prepared = parsePrepareRemediationRequest(payload);
  if (!prepared.ok) return prepared;
  if (typeof record.approvalId !== 'string' || !APPROVAL_ID_PATTERN.test(record.approvalId)) {
    return { ok: false, message: 'approvalId is not a ScenarioForge approval id.' };
  }
  return { ok: true, value: { ...prepared.value, approvalId: record.approvalId } };
}
