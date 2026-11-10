import { Filter, FilterConditions, kvs } from '@forge/kvs';
import type { StorageAdapter, Versioned, WriteResult } from '../../shared/agents/storage';

/**
 * Forge Custom Entity Store adapter for usage governance and the response
 * cache (docs/AI_USAGE_GOVERNANCE.md §6). Plain KVS has no conditional
 * writes, so every record lives in one custom entity and versioned writes go
 * through a conditional `kvs.transact()`.
 *
 * Contract (shared/agents/storage.ts): a lost race returns
 * `{ ok: false, reason: 'CONFLICT' }`; anything else that goes wrong THROWS,
 * so the governor denies (fails closed).
 */

/** Must match `app.storage.entities[].name` in manifest.yml. */
export const GOVERNANCE_ENTITY = 'ai-governance';

/** One stored record. `payload` is JSON text; strings must not be empty. */
export interface GovernanceRecord {
  version: number;
  payload: string;
}

/** Condition attached to a conditional write. */
export type WriteCondition = { kind: 'absent' } | { kind: 'version'; equals: number };

/**
 * The few Forge storage calls the adapter needs, so tests can use a fake.
 * `get` returns `undefined` for a missing key; `delete` of a missing key is
 * not an error.
 */
export interface GovernanceKvsClient {
  get(key: string): Promise<GovernanceRecord | undefined>;
  conditionalSet(key: string, record: GovernanceRecord, condition: WriteCondition): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Per-value limit: "240KiB (RAW) per object" (limits-kvs-ce). */
export const MAX_RECORD_BYTES = 240 * 1024;
/** "A key can contain a maximum of 500 characters." (limits-kvs-ce) */
export const MAX_KEY_LENGTH = 500;
/** Documented KVS key pattern (limits-kvs-ce); no `u` flag, `\s-#` is literal. */
const KEY_PATTERN = /^(?!\s+$)[a-zA-Z0-9:._\s-#]+$/;
/** Custom entity `integer` is "a 32-bit signed integer". */
const MAX_VERSION = 2_147_483_647;

/** HTTP statuses where the server rejected the request without applying it. */
const REJECTED_STATUSES = new Set([400, 409, 412]);
/** Documented 400 codes that are never a failed condition. */
const NOT_A_CONDITION_CODES = new Set([
  'KEY_TOO_SHORT',
  'KEY_TOO_LONG',
  'INVALID_KEY',
  'MAX_SIZE',
  'MAX_DEPTH',
  'INVALID_FILTER_CONDITION',
  'INVALID_FILTER_VALUES',
  'RATE_LIMIT_EXCEEDED',
  'TOO_MANY_REQUESTS',
]);

export class ForgeStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForgeStorageError';
  }
}

export function validateKey(key: string): void {
  if (typeof key !== 'string' || key.length < 2 || key.length > MAX_KEY_LENGTH) {
    throw new ForgeStorageError('Storage key must be 2 to 500 characters.');
  }
  if (!KEY_PATTERN.test(key)) {
    throw new ForgeStorageError('Storage key contains characters Forge storage does not allow.');
  }
}

function encode(value: unknown, version: number): GovernanceRecord {
  const payload = JSON.stringify(value);
  if (payload === undefined) {
    throw new ForgeStorageError('Value is not JSON-serialisable.');
  }
  const record = { version, payload };
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_RECORD_BYTES) {
    throw new ForgeStorageError('Value exceeds the 240 KiB Forge storage limit.');
  }
  return record;
}

function decode<T>(key: string, record: unknown): Versioned<T> {
  const r = record as Partial<GovernanceRecord> | null;
  if (
    !r ||
    typeof r !== 'object' ||
    !Number.isInteger(r.version) ||
    (r.version as number) < 1 ||
    typeof r.payload !== 'string'
  ) {
    throw new ForgeStorageError(`Stored record for ${key} is malformed.`);
  }
  try {
    return { value: JSON.parse(r.payload) as T, version: r.version as number };
  } catch {
    throw new ForgeStorageError(`Stored payload for ${key} is not valid JSON.`);
  }
}

/**
 * True when the error is a server-side rejection that could be a failed
 * condition. The error code for a failed condition is not documented, so this
 * is only a candidate; `set` confirms by re-reading the version.
 */
export function isPossibleConditionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; responseDetails?: { status?: unknown } };
  const status = e.responseDetails?.status;
  if (typeof status !== 'number' || !REJECTED_STATUSES.has(status)) return false;
  return !(typeof e.code === 'string' && NOT_A_CONDITION_CODES.has(e.code));
}

export class ForgeEntityStorage implements StorageAdapter {
  constructor(private readonly client: GovernanceKvsClient = forgeKvsClient()) {}

  async get<T>(key: string): Promise<Versioned<T> | undefined> {
    validateKey(key);
    const record = await this.client.get(key);
    return record === undefined ? undefined : decode<T>(key, record);
  }

  async set<T>(key: string, value: T, expectedVersion: number | null): Promise<WriteResult> {
    validateKey(key);
    if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      throw new ForgeStorageError('expectedVersion must be a positive integer or null.');
    }
    const version = (expectedVersion ?? 0) + 1;
    if (version > MAX_VERSION) {
      throw new ForgeStorageError('Record version exceeds the 32-bit integer attribute.');
    }
    const record = encode(value, version);
    const condition: WriteCondition =
      expectedVersion === null ? { kind: 'absent' } : { kind: 'version', equals: expectedVersion };
    try {
      await this.client.conditionalSet(key, record, condition);
      return { ok: true, version };
    } catch (error) {
      if (!isPossibleConditionFailure(error)) throw error;
      // Confirm: it is a conflict only if the stored version no longer matches.
      const current = await this.client.get(key);
      const currentVersion = current === undefined ? null : decode(key, current).version;
      if (currentVersion !== expectedVersion) return { ok: false, reason: 'CONFLICT' };
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    validateKey(key);
    await this.client.delete(key);
  }
}

/** The real client over `@forge/kvs`. Needs the `storage:app` scope. */
export function forgeKvsClient(entityName: string = GOVERNANCE_ENTITY): GovernanceKvsClient {
  return {
    get: (key) => kvs.entity<GovernanceRecord>(entityName).get(key),
    conditionalSet: (key, record, condition) => {
      const conditions =
        condition.kind === 'absent'
          ? new Filter<GovernanceRecord>().and('version', FilterConditions.notExists())
          : new Filter<GovernanceRecord>().and(
              'version',
              FilterConditions.equalTo(condition.equals),
            );
      return kvs.transact().set(key, record, { entityName, conditions }).execute();
    },
    delete: (key) => kvs.entity<GovernanceRecord>(entityName).delete(key),
  };
}
