import type {
  ApiError,
  ApiResult,
  CreateRemediationWorkItemRequest,
  CreateRemediationWorkItemResponse,
  RemediationLinkOutcome,
} from '../../shared/api';
import type { StorageAdapter } from '../../shared/agents/storage';
import {
  resolveFollowUpRequests,
  transition,
  type DuplicateCheck,
  type JiraWriteCall,
  type RemediationAuditRecord,
  type RemediationEvent,
  type RemediationState,
} from '../../shared/remediation';
import type { JiraResponse } from '../jira/client';
import {
  prepareRemediationRequest,
  searchDuplicates,
  type PrepareRemediationDeps,
} from './prepare';
import {
  approvalRecordKey,
  checkApprovalAge,
  fail,
  handleApproveRemediation,
  STORAGE_UNAVAILABLE_MESSAGE,
  toDraftApproval,
  verifyStoredApproval,
  WRITE_NOT_PERMITTED_MESSAGE,
  type ApprovalDeps,
  type ApprovalRecord,
} from './approvals';
import { parseCreateRemediationWorkItemRequest } from './validation';

export {
  APPROVAL_CLOCK_SKEW_MS,
  MAX_APPROVAL_AGE_MS,
  WRITE_NOT_PERMITTED_MESSAGE,
} from './approvals';
export { handleApproveRemediation };

/**
 * M8 creation adapter: turns an approved, fingerprinted request into a Jira
 * work item, as the user, exactly once.
 *
 * Hard-disabled in every deployed build: the write gateway is injected and
 * production passes null unless SF_REMEDIATION_WRITE and SF_STORAGE are both
 * `enabled` (src/remediation/gateways.ts), so the resolver answers
 * WRITE_NOT_PERMITTED before reading anything. The manifest also requests no
 * `write:jira-work`, so a mis-set flag still cannot write.
 *
 * Order when a writer and a store exist:
 * 1. Load the server-issued approval by id (src/remediation/approvals.ts). The
 *    payload carries no approver, time, age or hash.
 * 2. Rebuild the draft and exact request server-side (prepareRemediationRequest,
 *    including the duplicate search), never trusting the browser's copy, and
 *    check the stored approval: same actor, same request fingerprint, same
 *    project, same source state (change `updated`, finding, fix).
 * 3. Read the stored record for the idempotency label: `created` returns it
 *    (read-only, any age); `creating`/`unknown` only search by label (adopt or
 *    keep checking); never a second create. Then the 24 h age check by the
 *    server clock.
 * 4. Single use: the approval is marked consumed with a conditional write
 *    (expectedVersion) immediately before the first item record is written, then
 *    `approved -> creating` is written conditionally too, so two clicks or two
 *    tabs cannot both create. A consumed approval can only read back or recover
 *    its own record, never send a new create.
 * 5. Duplicate search again immediately before the create.
 * 6. Create issue, then issue link, then remote link, each with the exact
 *    fingerprinted body. A failed link after a created work item is recorded
 *    as created with follow-up needed; the create is never retried.
 * 7. A create with no clear answer (throw, 5xx, unreadable body) becomes
 *    `unknown` and is resolved only by adopting the work item with the label.
 *
 * Every step appends an audit entry to the stored record.
 */

/** Sends one exact write call as the user. Throws when no answer arrived (timeout, network). */
export interface JiraWriteGateway {
  send(call: JiraWriteCall<unknown>): Promise<JiraResponse>;
}

export interface CreateRemediationDeps extends PrepareRemediationDeps, ApprovalDeps {
  /** Null in every build until `write:jira-work` is approved. */
  writer: JiraWriteGateway | null;
  /** Null in every build until `storage:app` is approved. */
  storage: StorageAdapter | null;
}

/** A `creating`/`unknown` record this old with no labelled work item is released as failed. */
export const LOCK_EXPIRY_MS = 15 * 60 * 1000;
/** Newest audit lines kept per record. */
export const MAX_AUDIT_ENTRIES = 200;

export type CreateStep =
  | 'approve'
  | 'approval-check'
  | 'duplicate-check'
  | 'lock'
  | 'create-issue'
  | 'issue-link'
  | 'remote-link'
  | 'adopt';

/** One audit line per step. Ids only; no summaries or descriptions. */
export interface CreateAuditEntry {
  step: CreateStep;
  outcome: string;
  at: string;
  actorAccountId: string | null;
  issueKey?: string;
  /** Server-issued approval id (opaque; no account id or text). */
  approvalId?: string;
  upstreamStatus?: number;
  /** The state machine's own record when the step moved the state. */
  transition?: RemediationAuditRecord;
}

/** Stored per idempotency label (`remediation-item:<sf-rem-…>`). */
export interface RemediationItemRecord {
  schemaVersion: 1;
  state: RemediationState;
  /** The approval that started this record. */
  approvalId?: string;
  requestHash: string;
  issueLink: RemediationLinkOutcome;
  remoteLink: RemediationLinkOutcome;
  audit: CreateAuditEntry[];
}

export function remediationRecordKey(idempotencyLabel: string): string {
  return `remediation-item:${idempotencyLabel}`;
}

/**
 * Permission-safe messages for a write. A 404 does not say whether the
 * project exists; a 403 does not name what the user lacks beyond the action.
 */
export function writeErrorFromStatus(status: number, step: CreateStep): ApiError {
  const what = step === 'create-issue' ? 'create the work item' : 'add the link';
  switch (status) {
    case 400:
      return {
        code: 'INVALID_REQUEST',
        message: `Jira rejected the request to ${what}. The project may need fields this draft does not fill in.`,
        upstreamStatus: status,
      };
    case 401:
      return {
        code: 'UNAUTHENTICATED',
        message:
          'ScenarioForge is not authorised to act in Jira as you. Grant access and try again.',
        upstreamStatus: status,
      };
    case 403:
      return {
        code: 'FORBIDDEN',
        message: `You do not have permission to ${what} in this project.`,
        upstreamStatus: status,
      };
    case 404:
      return {
        code: 'NOT_FOUND',
        message: 'The project or work item was not found, or you cannot see it.',
        upstreamStatus: status,
      };
    case 429:
      return {
        code: 'RATE_LIMITED',
        message: 'Jira is rate limiting requests. Wait a moment and try again.',
        upstreamStatus: status,
      };
    default:
      return {
        code: 'UPSTREAM_ERROR',
        message: `Jira could not ${what} (HTTP ${status}).`,
        upstreamStatus: status,
      };
  }
}

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]*$/;

async function readIssueKey(response: JiraResponse): Promise<string | null> {
  try {
    const body = (await response.json()) as { key?: unknown } | null;
    return typeof body?.key === 'string' && ISSUE_KEY.test(body.key) ? body.key : null;
  } catch {
    return null;
  }
}

/** Applies one state-machine event; a refusal is an internal error, never a silent pass. */
function move(state: RemediationState, event: RemediationEvent) {
  const result = transition(state, event);
  if (!result.ok) throw new Error(`Remediation state refused: ${result.reason}`);
  return result;
}

const NOT_ATTEMPTED: RemediationLinkOutcome = { status: 'skipped', reason: 'Not attempted.' };

export async function createRemediationWorkItem(
  deps: CreateRemediationDeps,
  input: CreateRemediationWorkItemRequest,
  actorAccountId: string,
): Promise<ApiResult<CreateRemediationWorkItemResponse>> {
  const writer = deps.writer;
  if (!writer) return fail('WRITE_NOT_PERMITTED', WRITE_NOT_PERMITTED_MESSAGE);
  const storage = deps.storage;
  if (!storage) return fail('STORAGE_UNAVAILABLE', STORAGE_UNAVAILABLE_MESSAGE);
  const now = deps.now ?? (() => new Date());
  const at = () => now().toISOString();

  // 1. The stored, server-issued approval.
  const approvalKey = approvalRecordKey(input.approvalId);
  let approvalEntry: Awaited<ReturnType<StorageAdapter['get']>>;
  try {
    approvalEntry = await storage.get<ApprovalRecord>(approvalKey);
  } catch {
    return fail('STORAGE_UNAVAILABLE', STORAGE_UNAVAILABLE_MESSAGE);
  }
  if (!approvalEntry) return fail('APPROVAL_INVALID', 'There is no approval for this request.');
  const approval = approvalEntry.value as ApprovalRecord;
  const approvalVersion = approvalEntry.version;
  if (approval.approverAccountId !== actorAccountId) {
    return fail('APPROVAL_INVALID', 'Only the person who approved this request can create it.');
  }

  // 2. Server-side rebuild (with the duplicate search) and approval binding.
  const prepared = await prepareRemediationRequest(deps, input);
  if (!prepared.ok) return prepared;
  const { draft, request, siteUrl } = prepared.data;
  const label = draft.labels[1]!;
  const verdict = verifyStoredApproval(approval, prepared.data, actorAccountId);
  if (!verdict.ok) return fail('APPROVAL_INVALID', verdict.message);
  const serverApproval = toDraftApproval(approval);

  const key = remediationRecordKey(label);
  let stored: Awaited<ReturnType<StorageAdapter['get']>>;
  try {
    stored = await storage.get<RemediationItemRecord>(key);
  } catch {
    return fail('STORAGE_UNAVAILABLE', STORAGE_UNAVAILABLE_MESSAGE);
  }
  let version: number | null = stored?.version ?? null;
  const storedRecord = stored?.value as RemediationItemRecord | undefined;

  const save = async (record: RemediationItemRecord): Promise<boolean> => {
    // Repeated "check again" polls append audit lines; keep the record far below the store limit.
    if (record.audit.length > MAX_AUDIT_ENTRIES) {
      record.audit.splice(0, record.audit.length - MAX_AUDIT_ENTRIES);
    }
    try {
      const written = await storage.set(key, record, version);
      if (!written.ok) return false;
      version = written.version;
      return true;
    } catch {
      return false;
    }
  };
  const respond = (record: RemediationItemRecord, message: string) =>
    ({
      ok: true,
      data: toResponse(record, label, siteUrl, message, input.changeKey),
    }) as const;
  const conflict = () =>
    fail('CONFLICT', 'Another create for this fix is in progress. Check again in a moment.');

  /** Marks the approval used, conditionally, so two tabs cannot both spend it. */
  const consume = async (): Promise<ApiResult<never> | null> => {
    const used: ApprovalRecord = {
      ...approval,
      status: 'consumed',
      consumedAt: at(),
      audit: [
        ...approval.audit,
        { step: 'consume', outcome: 'consumed', at: at(), actorAccountId },
      ],
    };
    try {
      const written = await storage.set(approvalKey, used, approvalVersion);
      return written.ok ? null : conflict();
    } catch {
      return fail('STORAGE_UNAVAILABLE', STORAGE_UNAVAILABLE_MESSAGE);
    }
  };

  const priorAudit = storedRecord?.audit ?? [];
  const record: RemediationItemRecord = {
    schemaVersion: 1,
    state: { status: 'approved', draft, approval: serverApproval },
    approvalId: approval.approvalId,
    requestHash: prepared.data.requestHash,
    issueLink: NOT_ATTEMPTED,
    remoteLink: NOT_ATTEMPTED,
    audit: [
      ...priorAudit,
      ...(priorAudit.some((e) => e.step === 'approve' && e.approvalId === approval.approvalId)
        ? []
        : [
            {
              step: 'approve' as const,
              outcome: 'issued',
              at: approval.approvedAt,
              actorAccountId: approval.approverAccountId,
              approvalId: approval.approvalId,
            },
          ]),
      {
        step: 'approval-check',
        outcome: 'valid',
        at: at(),
        actorAccountId,
        approvalId: approval.approvalId,
      },
    ],
  };

  const adoptExisting = async (dup: DuplicateCheck, links: boolean) => {
    record.audit.push({
      step: 'duplicate-check',
      outcome: dup.decision,
      at: at(),
      actorAccountId: null,
      ...(dup.issueKey ? { issueKey: dup.issueKey } : {}),
    });
    if (record.state.status === 'approved') {
      // Found before anything was sent: adopt without creating or linking.
      const issueKey = dup.issueKey!;
      const spent = await consume();
      if (spent) return spent;
      record.state = {
        status: 'created',
        draft,
        approval: serverApproval,
        issueKey,
        adopted: true,
        at: at(),
      };
      record.issueLink = { status: 'skipped', reason: 'Existing work item adopted; not changed.' };
      record.remoteLink = record.issueLink;
      record.audit.push({ step: 'adopt', outcome: 'adopted', at: at(), actorAccountId, issueKey });
      if (!(await save(record))) return conflict();
      return respond(record, `${issueKey} already exists for this fix and was adopted.`);
    }
    const moved = move(record.state, { kind: 'adopt', duplicates: dup, at: at() });
    record.state = moved.state;
    record.audit.push({
      step: 'adopt',
      outcome: 'adopted',
      at: at(),
      actorAccountId: null,
      issueKey: dup.issueKey!,
      transition: moved.audit,
    });
    if (!(await save(record))) return conflict();
    if (links) await addLinks(record);
    if (!(await save(record))) return conflict();
    return respond(record, `${dup.issueKey} was found by its label and adopted.`);
  };

  async function recover(existing: RemediationItemRecord) {
    Object.assign(record, existing);
    const dup = await searchDuplicates(deps.jira, label);
    if (!dup.ok) return dup;
    if (dup.data.decision === 'duplicate') return adoptExisting(dup.data, true);
    if (dup.data.decision === 'ambiguous') {
      return fail('CONFLICT', `${dup.data.reason} A person needs to decide which one to keep.`);
    }
    record.audit.push({ step: 'duplicate-check', outcome: 'none', at: at(), actorAccountId: null });
    // Lock expiry: a `creating`/`unknown` record older than LOCK_EXPIRY_MS with
    // no work item carrying the label means the process died (or the create was
    // never accepted). Release it as failed so a fresh approval can retry; the
    // label search above already ran, so an accepted create would have been adopted.
    const since =
      record.state.status === 'creating'
        ? record.state.startedAt
        : record.state.status === 'unknown'
          ? record.state.at
          : null;
    if (since !== null && now().getTime() - Date.parse(since) > LOCK_EXPIRY_MS) {
      const moved = move(record.state, {
        kind: 'failed',
        message: 'The earlier create attempt expired without creating a work item.',
        at: at(),
      });
      record.state = moved.state;
      record.audit.push({
        step: 'lock',
        outcome: 'expired',
        at: at(),
        actorAccountId: null,
        transition: moved.audit,
      });
      if (!(await save(record))) return conflict();
      return fail(
        'CONFLICT',
        'The earlier create attempt expired and no work item was found. Create again to retry.',
      );
    }
    if (!(await save(record))) return conflict();
    return respond(
      record,
      'The create was sent but Jira did not confirm it, and no work item carries the label yet. Checking again never sends a second create.',
    );
  }

  // 3. Existing record: never create twice.
  if (storedRecord) {
    const status = storedRecord.state.status;
    if (status === 'created') {
      // The label is per change/finding/fix, not per project or person. A different
      // request (other project, summary or approver view) must not learn the key or URL
      // of a work item it may not be able to see.
      if (storedRecord.requestHash !== prepared.data.requestHash) {
        return fail(
          'CONFLICT',
          'A work item was already created for this fix from a different request. A person needs to decide.',
        );
      }
      return respond(storedRecord, `${issueKeyOf(storedRecord)} was already created for this fix.`);
    }
    if (status === 'creating' || status === 'unknown') {
      // Recovery never creates, but it may add links, so the same bindings apply.
      if (storedRecord.requestHash !== prepared.data.requestHash) {
        return fail(
          'CONFLICT',
          'A create for this fix from a different request is in progress. A person needs to decide.',
        );
      }
      if (approval.status === 'consumed' && storedRecord.approvalId !== approval.approvalId) {
        return fail(
          'APPROVAL_INVALID',
          'This approval was already used. Approve the request again.',
        );
      }
      const age = checkApprovalAge(approval, now());
      if (!age.ok) return fail('APPROVAL_INVALID', age.message);
      return recover(storedRecord);
    }
    // `failed`: a definite refusal before anything was created; a fresh approval may retry below.
  }

  // Single use: a consumed approval never starts a create (it only reads back or recovers above).
  if (approval.status === 'consumed') {
    return fail('APPROVAL_INVALID', 'This approval was already used. Approve the request again.');
  }
  const ageVerdict = checkApprovalAge(approval, now());
  if (!ageVerdict.ok) return fail('APPROVAL_INVALID', ageVerdict.message);

  // Pre-create duplicate from the fresh preparation.
  if (prepared.data.duplicate.decision === 'ambiguous') {
    return fail('CONFLICT', `${prepared.data.duplicate.reason} A person needs to decide.`);
  }
  if (prepared.data.duplicate.decision === 'duplicate') {
    return adoptExisting(prepared.data.duplicate, false);
  }

  // 4. Conditional move to `creating`.
  const started = transition(record.state, {
    kind: 'start-create',
    actorAccountId,
    at: at(),
    duplicates: prepared.data.duplicate,
  });
  if (!started.ok) return fail('APPROVAL_INVALID', started.reason);
  record.state = started.state;
  record.audit.push({
    step: 'lock',
    outcome: 'creating',
    at: at(),
    actorAccountId,
    transition: started.audit,
  });
  const spent = await consume();
  if (spent) return spent;
  if (!(await save(record))) return conflict();

  const failRecord = async (error: ApiError) => {
    const moved = move(record.state, { kind: 'failed', message: error.message, at: at() });
    record.state = moved.state;
    record.audit.push({
      step: 'create-issue',
      outcome: 'failed',
      at: at(),
      actorAccountId: null,
      ...(error.upstreamStatus !== undefined ? { upstreamStatus: error.upstreamStatus } : {}),
      transition: moved.audit,
    });
    await save(record);
    return { ok: false, error } as const;
  };

  // 5. Duplicate re-check immediately before the create.
  const recheck = await searchDuplicates(deps.jira, label);
  if (!recheck.ok) return failRecord(recheck.error);
  if (recheck.data.decision === 'duplicate') return adoptExisting(recheck.data, false);
  if (recheck.data.decision === 'ambiguous') {
    return failRecord({ code: 'CONFLICT', message: recheck.data.reason });
  }
  record.audit.push({ step: 'duplicate-check', outcome: 'none', at: at(), actorAccountId: null });

  // 6. Create, exactly the approved body.
  const toUnknown = async (upstreamStatus?: number) => {
    const moved = move(record.state, { kind: 'timed-out', at: at() });
    record.state = moved.state;
    record.audit.push({
      step: 'create-issue',
      outcome: 'unknown',
      at: at(),
      actorAccountId: null,
      ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
      transition: moved.audit,
    });
    await save(record);
    return recover(record);
  };

  let response: JiraResponse;
  try {
    response = await writer.send(request.createIssue);
  } catch {
    return toUnknown();
  }
  if (!response.ok) {
    if (response.status >= 500) return toUnknown(response.status);
    return failRecord(writeErrorFromStatus(response.status, 'create-issue'));
  }
  const issueKey = await readIssueKey(response);
  if (!issueKey) return toUnknown(response.status);

  const created = transition(record.state, { kind: 'created', issueKey, at: at() });
  if (!created.ok) return toUnknown(response.status);
  record.state = created.state;
  record.audit.push({
    step: 'create-issue',
    outcome: 'created',
    at: at(),
    actorAccountId: null,
    issueKey,
    upstreamStatus: response.status,
    transition: created.audit,
  });
  const createdSaved = await save(record);

  // 7. Links; never re-create, never retried.
  await addLinks(record);
  const linksSaved = await save(record);
  const unsaved =
    createdSaved && linksSaved
      ? ''
      : ` The record of this create could not be saved; find the work item by the label ${label}.`;
  const done = respond(record, `${issueKey} was created.${unsaved}`);
  if (unsaved && done.data.outcome === 'created-with-follow-up') {
    done.data.message += unsaved;
  }
  return done;

  async function addLinks(target: RemediationItemRecord) {
    const key = issueKeyOf(target);
    const follow = resolveFollowUpRequests(request, key);
    if (!follow.ok) {
      target.issueLink = { status: 'failed', message: follow.message };
      target.remoteLink = { status: 'failed', message: follow.message };
      return;
    }
    target.issueLink = await sendLink(follow.issueLink, 'issue-link', key);
    target.remoteLink = follow.remoteLink
      ? await sendLink(follow.remoteLink, 'remote-link', key)
      : { status: 'skipped', reason: 'The runbook page path is unknown.' };
  }

  async function sendLink(
    call: JiraWriteCall<unknown>,
    step: 'issue-link' | 'remote-link',
    issueKey: string,
  ): Promise<RemediationLinkOutcome> {
    let outcome: RemediationLinkOutcome;
    try {
      const res = await writer!.send(call);
      outcome = res.ok
        ? { status: 'added' }
        : {
            status: 'failed',
            message: writeErrorFromStatus(res.status, step).message,
            upstreamStatus: res.status,
          };
    } catch {
      outcome = { status: 'failed', message: 'Jira did not answer the link request.' };
    }
    record.audit.push({
      step,
      outcome: outcome.status,
      at: at(),
      actorAccountId: null,
      issueKey,
      ...(outcome.status === 'failed' && outcome.upstreamStatus !== undefined
        ? { upstreamStatus: outcome.upstreamStatus }
        : {}),
    });
    return outcome;
  }
}

function issueKeyOf(record: RemediationItemRecord): string {
  return record.state.status === 'created' ? record.state.issueKey : '';
}

/**
 * Says exactly what exists after a created work item with a failed link:
 * the work item key, which link failed, and that the person adds it in Jira.
 * Links are never retried by ScenarioForge, so nothing here suggests it.
 */
export function followUpMessage(
  record: RemediationItemRecord,
  issueKey: string,
  changeKey: string,
): string {
  const missing: string[] = [];
  if (record.issueLink.status === 'failed') missing.push(`the "Relates" link to ${changeKey}`);
  if (record.remoteLink.status === 'failed') missing.push('the link to the runbook page');
  const unanswered = [record.issueLink, record.remoteLink].some(
    (l) => l.status === 'failed' && l.upstreamStatus === undefined,
  );
  return (
    `${issueKey} was created in Jira, but ${missing.join(' and ')} ${missing.length > 1 ? 'were' : 'was'} not added. ` +
    `ScenarioForge does not retry links: open ${issueKey} in Jira and add ${missing.length > 1 ? 'them' : 'it'} manually.` +
    (unanswered
      ? ` Jira did not answer a link request, so look at ${issueKey} first: that link may already exist.`
      : '')
  );
}

function toResponse(
  record: RemediationItemRecord,
  label: string,
  siteUrl: string,
  message: string,
  changeKey: string,
): CreateRemediationWorkItemResponse {
  const state = record.state;
  const base = {
    issueLink: record.issueLink,
    remoteLink: record.remoteLink,
    idempotencyLabel: label,
    message,
  };
  if (state.status !== 'created') return { outcome: 'unknown', adopted: false, ...base };
  const followUp = record.issueLink.status === 'failed' || record.remoteLink.status === 'failed';
  if (followUp) base.message = followUpMessage(record, state.issueKey, changeKey);
  return {
    outcome: followUp ? 'created-with-follow-up' : 'created',
    issueKey: state.issueKey,
    issueUrl: `${siteUrl}/browse/${state.issueKey}`,
    adopted: state.adopted,
    ...base,
  };
}

/**
 * Resolver body for `createRemediationWorkItem`. With no writer it answers
 * WRITE_NOT_PERMITTED before parsing or reading anything.
 */
export async function handleCreateRemediationWorkItem(
  deps: CreateRemediationDeps,
  payload: unknown,
  accountId: unknown,
): Promise<ApiResult<CreateRemediationWorkItemResponse>> {
  if (!deps.writer) return fail('WRITE_NOT_PERMITTED', WRITE_NOT_PERMITTED_MESSAGE);
  const parsed = parseCreateRemediationWorkItemRequest(payload);
  if (!parsed.ok) return fail('INVALID_REQUEST', parsed.message);
  if (typeof accountId !== 'string' || accountId === '') {
    return fail('UNAUTHENTICATED', 'Sign in to Jira to create a work item.');
  }
  return createRemediationWorkItem(deps, parsed.value, accountId);
}
