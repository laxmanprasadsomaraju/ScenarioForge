import type { ListChangesRequest, UpdatedWindow } from '../shared/api';
import { MAX_RESULTS_LIMIT, UPDATED_WINDOWS } from '../shared/api';

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
