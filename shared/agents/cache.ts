/**
 * Response cache for governed calls, so an identical question over identical
 * evidence does not spend again. Pure: storage and clock are injected.
 *
 * Keyed by (operation, scope, normalized inputs, evidence fingerprint). The
 * scope is the caller's accountId: results are produced asUser, so sharing
 * them across users could reveal issues or pages another user cannot see.
 * Only successful results with no unknowns are cached.
 */

import type { GovernedOperation } from './budget';
import type { StorageAdapter } from './storage';

export type CacheInputValue = string | number | boolean | null | undefined;

export interface CacheKeyParts {
  operation: GovernedOperation;
  /** accountId from the invocation context. */
  scope: string;
  inputs: Record<string, CacheInputValue>;
  /** From `evidenceFingerprint`; changes whenever any cited source changes. */
  evidenceFingerprint: string;
}

/** Minimum shape of a cacheable result (matches `ActionResult` in contracts.ts). */
export interface CacheableResult {
  ok: boolean;
  unknowns?: unknown[];
  status?: string;
}

export interface CachePolicy {
  ttlSeconds: number;
  maxEntries: number;
}

/** 15 minutes: long enough to absorb repeated questions in one conversation. */
export const DEFAULT_CACHE_POLICY: CachePolicy = { ttlSeconds: 900, maxEntries: 200 };

export const CACHE_INDEX_KEY = 'ai-cache:index';
export const cacheEntryKey = (hash: string): string => `ai-cache:entry:${hash}`;

interface StoredEntry<T> {
  canonicalKey: string;
  value: T;
  evidenceIds: string[];
  storedAtMs: number;
  expiresAtMs: number;
}

interface CacheIndex {
  entries: Record<string, { storedAtMs: number; expiresAtMs: number }>;
}

export type CacheLookup<T> =
  | { hit: true; value: T; evidenceIds: string[]; storedAt: string }
  | { hit: false; reason: 'MISS' | 'EXPIRED' | 'UNAVAILABLE' };

export type CachePut =
  | { stored: true; evicted: number }
  | {
      stored: false;
      reason: 'FAILURE_NOT_CACHED' | 'UNKNOWNS_NOT_CACHED' | 'INVALID' | 'UNAVAILABLE';
    };

// Keys ----------------------------------------------------------------------

/** Trims strings, drops empty values and sorts keys so equivalent inputs match. */
export function normalizeInputs(inputs: Record<string, CacheInputValue>): string {
  const pairs = Object.keys(inputs)
    .sort()
    .flatMap((key) => {
      const raw = inputs[key];
      const value = typeof raw === 'string' ? raw.trim() : raw;
      return value === undefined || value === null || value === '' ? [] : [[key, value]];
    });
  return JSON.stringify(pairs);
}

/**
 * Order-independent fingerprint of the evidence a result was built from.
 * `version` should be whatever changes when the source changes (Jira
 * `updated`, Confluence version number, graph `retrievedAt`).
 */
export function evidenceFingerprint(evidence: { id: string; version?: string | number }[]): string {
  const parts = [...new Set(evidence.map((e) => `${e.id}@${e.version ?? ''}`))].sort();
  return hashKey(JSON.stringify(parts));
}

export function canonicalKey(parts: CacheKeyParts): string {
  return JSON.stringify([
    parts.operation,
    parts.scope,
    normalizeInputs(parts.inputs),
    parts.evidenceFingerprint,
  ]);
}

/**
 * Two FNV-1a 32-bit passes with different offsets, as 16 hex chars. Only used
 * to fit Forge's key rules; a hit also compares the full canonical key, so a
 * collision is a miss, never a wrong answer.
 */
export function hashKey(text: string): string {
  const pass = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return pass(0x811c9dc5) + pass(0x01000193 ^ 0x5bd1e995);
}

// Cache ---------------------------------------------------------------------

export interface ResponseCacheDeps {
  storage: StorageAdapter;
  now: () => Date;
  policy?: CachePolicy;
  maxAttempts?: number;
}

export class ResponseCache<T extends CacheableResult> {
  private readonly storage: StorageAdapter;
  private readonly now: () => Date;
  private readonly policy: CachePolicy;
  private readonly maxAttempts: number;

  constructor(deps: ResponseCacheDeps) {
    const policy = deps.policy ?? DEFAULT_CACHE_POLICY;
    if (
      !Number.isInteger(policy.ttlSeconds) ||
      policy.ttlSeconds < 1 ||
      !Number.isInteger(policy.maxEntries) ||
      policy.maxEntries < 1
    ) {
      throw new Error('Cache policy needs a positive integer TTL and max entries.');
    }
    this.storage = deps.storage;
    this.now = deps.now;
    this.policy = policy;
    this.maxAttempts = deps.maxAttempts ?? 3;
  }

  /** Never throws. A store error is a miss: the caller has already reserved budget. */
  async get(parts: CacheKeyParts): Promise<CacheLookup<T>> {
    const key = canonicalKey(parts);
    let stored;
    try {
      stored = await this.storage.get<StoredEntry<T>>(cacheEntryKey(hashKey(key)));
    } catch {
      return { hit: false, reason: 'UNAVAILABLE' };
    }
    if (!stored || stored.value.canonicalKey !== key) return { hit: false, reason: 'MISS' };
    if (stored.value.expiresAtMs <= this.now().getTime()) return { hit: false, reason: 'EXPIRED' };
    return {
      hit: true,
      value: stored.value.value,
      evidenceIds: stored.value.evidenceIds,
      storedAt: new Date(stored.value.storedAtMs).toISOString(),
    };
  }

  /** Stores a successful, fully assessed result. Failures are never cached. */
  async put(parts: CacheKeyParts, value: T, evidenceIds: string[]): Promise<CachePut> {
    if (value.ok !== true) return { stored: false, reason: 'FAILURE_NOT_CACHED' };
    if ((value.unknowns?.length ?? 0) > 0 || value.status === 'not-assessed') {
      return { stored: false, reason: 'UNKNOWNS_NOT_CACHED' };
    }
    if (!Array.isArray(evidenceIds) || !evidenceIds.every((id) => typeof id === 'string')) {
      return { stored: false, reason: 'INVALID' };
    }

    const key = canonicalKey(parts);
    const hash = hashKey(key);
    const nowMs = this.now().getTime();
    const entry: StoredEntry<T> = {
      canonicalKey: key,
      value,
      evidenceIds: [...evidenceIds],
      storedAtMs: nowMs,
      expiresAtMs: nowMs + this.policy.ttlSeconds * 1000,
    };

    try {
      // Index first so the entry count stays bounded even if the entry write fails.
      const evicted = await this.admit(hash, entry);
      if (evicted === null) return { stored: false, reason: 'UNAVAILABLE' };
      const current = await this.storage.get<StoredEntry<T>>(cacheEntryKey(hash));
      const write = await this.storage.set(cacheEntryKey(hash), entry, current?.version ?? null);
      if (!write.ok) return { stored: false, reason: 'UNAVAILABLE' };
      await Promise.all(evicted.map((h) => this.storage.delete(cacheEntryKey(h))));
      return { stored: true, evicted: evicted.length };
    } catch {
      return { stored: false, reason: 'UNAVAILABLE' };
    }
  }

  /** Adds `hash` to the index, dropping expired then oldest entries. Returns evicted hashes. */
  private async admit(hash: string, entry: StoredEntry<T>): Promise<string[] | null> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const stored = await this.storage.get<CacheIndex>(CACHE_INDEX_KEY);
      const entries = { ...(stored?.value.entries ?? {}) };
      const evicted: string[] = [];
      for (const [h, meta] of Object.entries(entries)) {
        if (meta.expiresAtMs <= entry.storedAtMs) {
          delete entries[h];
          evicted.push(h);
        }
      }
      entries[hash] = { storedAtMs: entry.storedAtMs, expiresAtMs: entry.expiresAtMs };
      const byAge = Object.entries(entries)
        .filter(([h]) => h !== hash)
        .sort(([ha, a], [hb, b]) => a.storedAtMs - b.storedAtMs || ha.localeCompare(hb));
      while (Object.keys(entries).length > this.policy.maxEntries && byAge.length > 0) {
        const [oldest] = byAge.shift()!;
        delete entries[oldest];
        evicted.push(oldest);
      }
      const write = await this.storage.set<CacheIndex>(
        CACHE_INDEX_KEY,
        { entries },
        stored?.version ?? null,
      );
      if (write.ok) return evicted.filter((h) => h !== hash);
    }
    return null;
  }
}
