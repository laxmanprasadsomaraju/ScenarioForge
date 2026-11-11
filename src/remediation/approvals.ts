import { randomBytes } from 'node:crypto';
import type {
  ApiError,
  ApiResult,
  ApproveRemediationRequest,
  ApproveRemediationResponse,
  ApprovalSource,
  PrepareRemediationResponse,
} from '../../shared/api';
import type { StorageAdapter } from '../../shared/agents/storage';
import type { DraftApproval } from '../../shared/remediation';
import { prepareRemediationRequest, type PrepareRemediationDeps } from './prepare';
import { parseApproveRemediationRequest } from './validation';

/**
 * Server-issued approvals (M8).
 *
 * The browser never supplies who approved, when, or how old an approval is.
 * `approveRemediation` derives the approver from the Forge invocation context,
 * stamps the time with the server clock, rebuilds the draft and exact request
 * server-side, and stores the approval under its own key prefix, bound to the
 * request fingerprint, the destination project, the source state (change key
 * and `updated`, finding, fix) and the approver. `createRemediationWorkItem`
 * accepts only the approval id.
 *
 * Stored in the existing rehearsal-history entity under
 * `remediation-approval:<id>`. That prefix cannot collide with history keys
 * (`sfh1:`) or remediation records (`remediation-item:`), and the id is
 * `sfa-` plus 128 random bits, so it is unguessable and never derived from
 * user input. Nothing here is returned to the browser except the id, the
 * request hash and the two server timestamps; the approver stays server-side.
 */

export const APPROVAL_KEY_PREFIX = 'remediation-approval:';
export const MAX_APPROVAL_AGE_MS = 24 * 60 * 60 * 1000;
/** A stored approval time this far ahead of the server clock means the clock moved; refuse. */
export const APPROVAL_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function approvalRecordKey(approvalId: string): string {
  return `${APPROVAL_KEY_PREFIX}${approvalId}`;
}

export function newApprovalId(): string {
  return `sfa-${randomBytes(16).toString('hex')}`;
}

/** Stored per approval id. Account ids stay here and are never returned. */
export interface ApprovalRecord {
  schemaVersion: 1;
  approvalId: string;
  /** From the invocation context, never the payload. */
  approverAccountId: string;
  /** Server clock when issued. */
  approvedAt: string;
  requestHash: string;
  draftHash: string;
  projectKey: string;
  /** Idempotency label of the draft (`sf-rem-…`). */
  label: string;
  source: ApprovalSource;
  status: 'active' | 'consumed';
  consumedAt?: string;
  /** Ids only; no draft text. */
  audit: { step: 'approve' | 'consume'; outcome: string; at: string; actorAccountId: string }[];
}

export interface ApprovalDeps extends PrepareRemediationDeps {
  /** Null in every build until `write:jira-work` is approved; approvals are then refused too. */
  writer: object | null;
  /** Null in every build until `storage:app` is approved. */
  storage: StorageAdapter | null;
  newApprovalId?: () => string;
}

export const WRITE_NOT_PERMITTED_MESSAGE =
  'Creating work items needs the write:jira-work permission, which is not granted in this build. Nothing was sent to Jira.';
export const STORAGE_UNAVAILABLE_MESSAGE =
  'Approvals cannot be stored in this environment, so nothing can be created.';

export function fail(code: ApiError['code'], message: string, upstreamStatus?: number) {
  return {
    ok: false,
    error: { code, message, ...(upstreamStatus !== undefined ? { upstreamStatus } : {}) },
  } as const satisfies ApiResult<never>;
}

/** The record as the state machine's approval; every field comes from the server. */
export function toDraftApproval(record: ApprovalRecord): DraftApproval {
  return {
    draftHash: record.draftHash,
    requestHash: record.requestHash,
    approverAccountId: record.approverAccountId,
    approvedAt: record.approvedAt,
  };
}

export async function approveRemediation(
  deps: ApprovalDeps,
  input: ApproveRemediationRequest,
  actorAccountId: string,
): Promise<ApiResult<ApproveRemediationResponse>> {
  if (!deps.writer) return fail('WRITE_NOT_PERMITTED', WRITE_NOT_PERMITTED_MESSAGE);
  const storage = deps.storage;
  if (!storage) return fail('STORAGE_UNAVAILABLE', STORAGE_UNAVAILABLE_MESSAGE);
  const now = deps.now ?? (() => new Date());

  const prepared = await prepareRemediationRequest(deps, input);
  if (!prepared.ok) return prepared;
  const p = prepared.data;
  if (p.requestHash !== input.requestHash) {
    return fail(
      'APPROVAL_INVALID',
      'The request rebuilt now differs from the one you were shown. Review and approve it again.',
    );
  }

  const approvedAt = now();
  const approvalId = (deps.newApprovalId ?? newApprovalId)();
  const record: ApprovalRecord = {
    schemaVersion: 1,
    approvalId,
    approverAccountId: actorAccountId,
    approvedAt: approvedAt.toISOString(),
    requestHash: p.requestHash,
    draftHash: p.draftHash,
    projectKey: p.draft.projectKey,
    label: p.draft.labels[1]!,
    source: p.source,
    status: 'active',
    audit: [{ step: 'approve', outcome: 'issued', at: approvedAt.toISOString(), actorAccountId }],
  };
  try {
    const written = await storage.set(approvalRecordKey(approvalId), record, null);
    if (!written.ok) return fail('STORAGE_UNAVAILABLE', 'The approval could not be stored.');
  } catch {
    return fail('STORAGE_UNAVAILABLE', 'The approval could not be stored.');
  }
  return {
    ok: true,
    data: {
      approvalId,
      requestHash: p.requestHash,
      approvedAt: record.approvedAt,
      expiresAt: new Date(approvedAt.getTime() + MAX_APPROVAL_AGE_MS).toISOString(),
    },
  };
}

type Verdict = { ok: true } | { ok: false; message: string };

const sameSource = (a: ApprovalSource, b: ApprovalSource) =>
  a.changeKey === b.changeKey &&
  a.changeUpdated === b.changeUpdated &&
  a.findingId === b.findingId &&
  a.fixId === b.fixId;

/**
 * Checks a stored approval against the request rebuilt now. Order: approver,
 * request fingerprint, project, source state. Age is checked separately
 * (`checkApprovalAge`) because a finished create may be read back later.
 */
export function verifyStoredApproval(
  record: ApprovalRecord,
  fresh: PrepareRemediationResponse,
  actorAccountId: string,
): Verdict {
  if (record.approverAccountId !== actorAccountId) {
    return { ok: false, message: 'Only the person who approved this request can create it.' };
  }
  if (
    record.requestHash !== fresh.requestHash ||
    record.draftHash !== fresh.draftHash ||
    record.label !== fresh.draft.labels[1]
  ) {
    return {
      ok: false,
      message:
        'The approval is stale: the request rebuilt now differs from the one approved. Review and approve it again.',
    };
  }
  if (record.projectKey !== fresh.draft.projectKey) {
    return {
      ok: false,
      message: 'The approval was for a different project. Review and approve it again.',
    };
  }
  if (!sameSource(record.source, fresh.source)) {
    return {
      ok: false,
      message:
        'The change or finding was updated after you approved. Review the new draft and approve it again.',
    };
  }
  return { ok: true };
}

/** At most 24 h by the server clock (the boundary itself is still valid). */
export function checkApprovalAge(record: ApprovalRecord, now: Date): Verdict {
  const approvedAt = Date.parse(record.approvedAt);
  if (Number.isNaN(approvedAt) || approvedAt - now.getTime() > APPROVAL_CLOCK_SKEW_MS) {
    return {
      ok: false,
      message: 'The approval time cannot be trusted. Approve the request again.',
    };
  }
  if (now.getTime() - approvedAt > MAX_APPROVAL_AGE_MS) {
    return {
      ok: false,
      message: 'The approval is older than 24 hours. Approve the request again.',
    };
  }
  return { ok: true };
}

/** Resolver body for `approveRemediationRequest`. */
export async function handleApproveRemediation(
  deps: ApprovalDeps,
  payload: unknown,
  accountId: unknown,
): Promise<ApiResult<ApproveRemediationResponse>> {
  if (!deps.writer) return fail('WRITE_NOT_PERMITTED', WRITE_NOT_PERMITTED_MESSAGE);
  const parsed = parseApproveRemediationRequest(payload);
  if (!parsed.ok) return fail('INVALID_REQUEST', parsed.message);
  if (typeof accountId !== 'string' || accountId === '') {
    return fail('UNAUTHENTICATED', 'Sign in to Jira to approve a work item.');
  }
  return approveRemediation(deps, parsed.value, accountId);
}
