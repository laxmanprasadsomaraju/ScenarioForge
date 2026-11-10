import type { AnalyzeChangeRequest } from '../shared/analysis/types';
import type {
  GetRecoveryProcedureRequest,
  ListChangesRequest,
  ListRecoveryPagesRequest,
  RecoveryTerm,
  UpdatedWindow,
} from '../shared/api';
import {
  MAX_RECOVERY_PAGES,
  MAX_RESULTS_LIMIT,
  RECOVERY_TERMS,
  UPDATED_WINDOWS,
} from '../shared/api';

export type Validated<T> = { ok: true; value: T } | { ok: false; message: string };

const DEFAULT_REQUEST: ListChangesRequest = { updatedWithin: '30d', maxResults: 25 };

/**
 * Validates the untrusted payload sent by the browser. Only enumerated values
 * are accepted so client input can never be spliced into JQL.
 */
export function parseListChangesRequest(payload: unknown): Validated<ListChangesRequest> {
  if (payload === undefined || payload === null) {
    return { ok: true, value: DEFAULT_REQUEST };
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'Request payload must be an object.' };
  }
  const { updatedWithin, maxResults } = payload as Record<string, unknown>;

  const window = updatedWithin ?? DEFAULT_REQUEST.updatedWithin;
  if (typeof window !== 'string' || !(UPDATED_WINDOWS as readonly string[]).includes(window)) {
    return { ok: false, message: `updatedWithin must be one of ${UPDATED_WINDOWS.join(', ')}.` };
  }

  const limit = maxResults ?? DEFAULT_REQUEST.maxResults;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_RESULTS_LIMIT
  ) {
    return {
      ok: false,
      message: `maxResults must be an integer between 1 and ${MAX_RESULTS_LIMIT}.`,
    };
  }

  return { ok: true, value: { updatedWithin: window as UpdatedWindow, maxResults: limit } };
}

/** JQL is built only from validated enum values. */
export function buildRecentChangesJql(window: UpdatedWindow): string {
  return `updated >= -${window} ORDER BY updated DESC`;
}

/**
 * Confluence space keys are "only alphanumeric characters (A-Z, 0-9)" and at
 * most 255 long (support.atlassian.com, "Create a space"). Personal spaces use
 * a leading `~`. Anything else is rejected rather than escaped.
 */
const SPACE_KEY = /^~?[A-Za-z0-9]{1,255}$/;

/** Confluence content ids are int64, so at most 19 digits. */
const PAGE_ID = /^[0-9]{1,19}$/;

const DEFAULT_RECOVERY_REQUEST: ListRecoveryPagesRequest = {
  terms: [...RECOVERY_TERMS],
  spaceKey: null,
  maxResults: 10,
};

function asPayloadRecord(payload: unknown): Record<string, unknown> | null {
  if (payload === undefined || payload === null) {
    return {};
  }
  return typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/**
 * Validates a recovery page search. Search text is limited to enumerated
 * recovery terms; raw CQL or free text from the browser is never accepted.
 */
export function parseListRecoveryPagesRequest(
  payload: unknown,
): Validated<ListRecoveryPagesRequest> {
  const record = asPayloadRecord(payload);
  if (!record) {
    return { ok: false, message: 'Request payload must be an object.' };
  }
  const { terms, spaceKey, maxResults } = record;

  const chosen = terms ?? DEFAULT_RECOVERY_REQUEST.terms;
  if (
    !Array.isArray(chosen) ||
    chosen.length === 0 ||
    !chosen.every((t) => typeof t === 'string' && (RECOVERY_TERMS as readonly string[]).includes(t))
  ) {
    return {
      ok: false,
      message: `terms must be a non-empty list of: ${RECOVERY_TERMS.join(', ')}.`,
    };
  }

  const space = spaceKey ?? null;
  if (space !== null && (typeof space !== 'string' || !SPACE_KEY.test(space))) {
    return { ok: false, message: 'spaceKey must be a Confluence space key (letters and digits).' };
  }

  const limit = maxResults ?? DEFAULT_RECOVERY_REQUEST.maxResults;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_RECOVERY_PAGES
  ) {
    return {
      ok: false,
      message: `maxResults must be an integer between 1 and ${MAX_RECOVERY_PAGES}.`,
    };
  }

  return {
    ok: true,
    value: {
      terms: [...new Set(chosen as RecoveryTerm[])],
      spaceKey: space,
      maxResults: limit,
    },
  };
}

export function parseGetRecoveryProcedureRequest(
  payload: unknown,
): Validated<GetRecoveryProcedureRequest> {
  const record = asPayloadRecord(payload);
  const pageId = record?.pageId;
  if (typeof pageId !== 'string' || !PAGE_ID.test(pageId)) {
    return { ok: false, message: 'pageId must be a numeric Confluence page id.' };
  }
  return { ok: true, value: { pageId } };
}

/**
 * Quotes a CQL string value. Inputs are already restricted to enum terms and
 * validated space keys; escaping is a second line of defence.
 */
export function cqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * CQL is built only from validated values. `text` is Confluence's master
 * field covering title, body and labels, so it also matches page titles.
 */
export function buildRecoveryPagesCql(request: ListRecoveryPagesRequest): string {
  const termClause = request.terms.map((term) => `text ~ ${cqlString(term)}`).join(' OR ');
  const spaceClause = request.spaceKey ? ` AND space = ${cqlString(request.spaceKey)}` : '';
  return `type = page AND (${termClause})${spaceClause}`;
}

/*
 * M3: change-to-recovery analysis.
 */

/** Jira issue keys: project key, hyphen, number (same pattern as issue mapping). */
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const MAX_ISSUE_KEY_LENGTH = 64;

export function isIssueKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ISSUE_KEY_LENGTH && ISSUE_KEY.test(value);
}

/**
 * Validates an `analyzeChange` payload. Only `issueKey` is read; any other
 * field (for example raw JQL or CQL) is ignored and never reaches a query.
 */
export function parseAnalyzeChangeRequest(payload: unknown): Validated<AnalyzeChangeRequest> {
  const record = asPayloadRecord(payload);
  const issueKey = record?.issueKey;
  if (!isIssueKey(issueKey)) {
    return { ok: false, message: 'issueKey must be a Jira issue key such as OPS-123.' };
  }
  return { ok: true, value: { issueKey } };
}

/**
 * Subject terms come from the analysis engine, which derives them from the
 * change text. They are still checked here: one word of letters, digits, dot,
 * underscore or hyphen, 2..40 characters. Anything else is rejected rather
 * than escaped.
 */
const SUBJECT_TERM = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;
export const MAX_SUBJECT_TERMS = 5;

export function parseSubjectTerms(terms: readonly unknown[]): Validated<string[]> {
  if (terms.length === 0) {
    return { ok: false, message: 'No search terms were derived from the change.' };
  }
  if (!terms.every((t): t is string => typeof t === 'string' && SUBJECT_TERM.test(t))) {
    return { ok: false, message: 'A search term derived from the change was not a plain word.' };
  }
  const unique = [...new Set(terms as string[])];
  if (unique.length > MAX_SUBJECT_TERMS) {
    return {
      ok: false,
      message: `At most ${MAX_SUBJECT_TERMS} search terms can be used per analysis.`,
    };
  }
  return { ok: true, value: unique };
}

/**
 * CQL for recovery pages that also mention at least one change subject.
 * Built only from the enumerated recovery terms and validated subject terms,
 * each quoted with `cqlString`.
 */
export function buildRunbookSubjectCql(subjectTerms: readonly string[]): string {
  const recoveryClause = RECOVERY_TERMS.map((term) => `text ~ ${cqlString(term)}`).join(' OR ');
  const subjectClause = subjectTerms.map((term) => `text ~ ${cqlString(term)}`).join(' OR ');
  return `type = page AND (${recoveryClause}) AND (${subjectClause})`;
}
