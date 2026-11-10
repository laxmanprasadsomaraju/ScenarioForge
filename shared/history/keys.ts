import { canonicalJson } from '../simulation/replay';
import type { HistoryUser } from './types';

/**
 * Storage keys and size limits for rehearsal history.
 *
 * Limits are the Custom Entity Store limits cited by the lane-a2 adapter
 * (`src/ai/forgeStorage.ts` on origin/lane-a2-forge-storage, from
 * https://developer.atlassian.com/platform/forge/limits-kvs-ce/):
 * - "A key can contain a maximum of 500 characters" (and at least 2);
 * - key pattern `^(?!\s+$)[a-zA-Z0-9:._\s-#]+$`;
 * - "240KiB (RAW) per object".
 */

/** "A key can contain a maximum of 500 characters." */
export const MAX_KEY_LENGTH = 500;
/** Documented KVS key pattern, copied from the lane-a2 adapter (no `u` flag: `\s-#` is literal). */
export const KEY_PATTERN = /^(?!\s+$)[a-zA-Z0-9:._\s-#]+$/;
/** Forge per-value limit: 240 KiB. */
export const FORGE_MAX_VALUE_BYTES = 240 * 1024;
/**
 * Our budget per stored value, measured the way the lane-a2 adapter stores it
 * (a `{ version, payload }` envelope with the value as a JSON string). 40 KiB
 * below the platform limit, per docs/M6_PLAN.md §6.1 ("larger than 200 KiB is
 * not stored").
 */
export const MAX_VALUE_BYTES = 200 * 1024;
/** Longest raw id (installation, accountId, run id) accepted before encoding. */
export const MAX_ID_LENGTH = 128;

/** Prefix and schema generation of every history key. */
export const KEY_PREFIX = 'sfh1';

export class HistoryInputError extends Error {}

/**
 * Encodes one key segment injectively into characters the key pattern allows.
 * `[A-Za-z0-9.-]` pass through; every other UTF-16 unit (including `:`, the
 * separator, and `_`, the escape) becomes `_` + 4 hex digits. So
 * `ari:cloud:jira::site/x` and an accountId containing `:` cannot collide with
 * another user's segment or split into extra segments.
 */
export function encodeSegment(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ID_LENGTH) {
    throw new HistoryInputError(`Identifier must be 1 to ${MAX_ID_LENGTH} characters.`);
  }
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    out += /[A-Za-z0-9.-]/.test(ch) ? ch : '_' + raw.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return out;
}

/** Throws HistoryInputError unless `key` meets the documented key limits. */
export function validateKey(key: string): string {
  if (key.length < 2 || key.length > MAX_KEY_LENGTH) {
    throw new HistoryInputError(`Storage key must be 2 to ${MAX_KEY_LENGTH} characters.`);
  }
  if (!KEY_PATTERN.test(key)) {
    throw new HistoryInputError('Storage key contains characters Forge storage does not allow.');
  }
  return key;
}

/** All keys of one user in one installation share this prefix. */
export function userPrefix(user: HistoryUser): string {
  return `${KEY_PREFIX}:${encodeSegment(user.installation)}:${encodeSegment(user.accountId)}`;
}

export function indexKey(user: HistoryUser): string {
  return validateKey(`${userPrefix(user)}:index`);
}

export function runKey(user: HistoryUser, runId: string): string {
  return validateKey(`${userPrefix(user)}:run:${encodeSegment(runId)}`);
}

export function retestKey(user: HistoryUser, retestId: string): string {
  return validateKey(`${userPrefix(user)}:retest:${encodeSegment(retestId)}`);
}

/** Largest version the lane-a2 adapter writes (32-bit integer attribute). */
const MAX_VERSION = 2_147_483_647;

/**
 * Bytes the value occupies in the Forge entity, measured as the lane-a2
 * adapter encodes it: `{ version, payload: JSON.stringify(value) }`. The
 * payload is a JSON string inside JSON, so quotes are escaped and counted.
 */
export function storedBytes(value: unknown): number {
  const envelope = JSON.stringify({ version: MAX_VERSION, payload: JSON.stringify(value) });
  return new TextEncoder().encode(envelope).length;
}

/**
 * Content digest: two 32-bit FNV-1a hashes over canonical JSON (same scheme as
 * scenarioFingerprint). It detects edits to one stored value; it is not a
 * signature, since anyone able to rewrite storage could rewrite both values.
 */
export function contentDigest(value: unknown): string {
  const text = canonicalJson(value);
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193 ^ 0x5bd1e995);
}

function fnv1a(text: string, offset: number): string {
  let hash = offset >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
