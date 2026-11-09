/**
 * Storage port for usage governance. The core never imports Forge; a Forge
 * adapter (docs/AI_USAGE_GOVERNANCE.md) implements this over Custom Entity
 * Store conditional transactions.
 *
 * Contract: `get`/`set`/`delete` THROW when the store is unreachable. A
 * version mismatch is not an error; it returns `{ ok: false, reason: 'CONFLICT' }`
 * so callers can re-read and retry. Callers treat a throw as "deny".
 */

export interface Versioned<T> {
  value: T;
  /** Monotonic per key, starting at 1 on create. */
  version: number;
}

export type WriteResult = { ok: true; version: number } | { ok: false; reason: 'CONFLICT' };

export interface StorageAdapter {
  /** `undefined` when the key does not exist. */
  get<T>(key: string): Promise<Versioned<T> | undefined>;
  /**
   * Writes only if the stored version equals `expectedVersion`; `null` means
   * "create only if absent". Returns the new version.
   */
  set<T>(key: string, value: T, expectedVersion: number | null): Promise<WriteResult>;
  /** Unconditional delete; deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

/** In-memory adapter for tests and local preview. Values are deep-copied. */
export class InMemoryStorage implements StorageAdapter {
  private readonly data = new Map<string, Versioned<unknown>>();

  async get<T>(key: string): Promise<Versioned<T> | undefined> {
    const entry = this.data.get(key);
    return entry ? { value: structuredClone(entry.value) as T, version: entry.version } : undefined;
  }

  async set<T>(key: string, value: T, expectedVersion: number | null): Promise<WriteResult> {
    const current = this.data.get(key);
    if ((current?.version ?? null) !== expectedVersion) {
      return { ok: false, reason: 'CONFLICT' };
    }
    const version = (current?.version ?? 0) + 1;
    this.data.set(key, { value: structuredClone(value), version });
    return { ok: true, version };
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  /** Test helper: stored keys. */
  keys(): string[] {
    return [...this.data.keys()];
  }
}
