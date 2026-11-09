import { describe, expect, it } from 'vitest';
import type { BudgetPolicy, GovernanceSettings } from '../shared/agents/budget';
import {
  DEFAULT_POLICY,
  SETTINGS_KEY,
  UsageGovernor,
  ledgerKey,
  parseSettings,
  validatePolicy,
} from '../shared/agents/budget';
import type { CacheKeyParts } from '../shared/agents/cache';
import {
  CACHE_INDEX_KEY,
  ResponseCache,
  canonicalKey,
  evidenceFingerprint,
  normalizeInputs,
} from '../shared/agents/cache';
import type { StorageAdapter, Versioned, WriteResult } from '../shared/agents/storage';
import { InMemoryStorage } from '../shared/agents/storage';

const ALICE = '557058:alice';
const BOB = '557058:bob';

/** Mutable fake clock. */
function clock(iso = '2026-11-09T12:00:00.000Z') {
  let ms = Date.parse(iso);
  return {
    now: () => new Date(ms),
    advance: (seconds: number) => {
      ms += seconds * 1000;
    },
    set: (to: string) => {
      ms = Date.parse(to);
    },
  };
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

async function enabledStorage(settings: GovernanceSettings = { aiEnabled: true }) {
  const storage = new InMemoryStorage();
  await storage.set(SETTINGS_KEY, settings, null);
  return storage;
}

const POLICY: BudgetPolicy = {
  ...DEFAULT_POLICY,
  monthlyUnitCap: 100,
  perUserDailyCap: 40,
  rateLimit: { capacity: 100, refillPerMinute: 100 },
};

async function setup(policy: BudgetPolicy = POLICY, settings?: GovernanceSettings) {
  const storage = await enabledStorage(settings);
  const c = clock();
  const governor = new UsageGovernor({ storage, now: c.now, policy, newId: ids() });
  return { storage, clock: c, governor };
}

describe('policy and settings validation', () => {
  it('accepts the default policy', () => {
    expect(validatePolicy(DEFAULT_POLICY).ok).toBe(true);
  });

  it('rejects zero costs and bad rate limits', () => {
    expect(
      validatePolicy({
        ...DEFAULT_POLICY,
        costs: { ...DEFAULT_POLICY.costs, 'explain-outcome': 0 },
      }).ok,
    ).toBe(false);
    expect(
      validatePolicy({ ...DEFAULT_POLICY, rateLimit: { capacity: 0, refillPerMinute: 1 } }).ok,
    ).toBe(false);
    expect(
      () =>
        new UsageGovernor({
          storage: new InMemoryStorage(),
          now: clock().now,
          policy: { ...DEFAULT_POLICY, monthlyUnitCap: -1 },
        }),
    ).toThrow();
  });

  it.each([null, [], { aiEnabled: 'yes' }, { aiEnabled: true, monthlyUnitCap: 1.5 }])(
    'rejects malformed settings %j',
    (raw) => {
      expect(parseSettings(raw).ok).toBe(false);
    },
  );
});

describe('kill switch and opt-in', () => {
  it('denies everything when the code policy is disabled, without reading storage', async () => {
    const storage: StorageAdapter = {
      get: async () => {
        throw new Error('should not be called');
      },
      set: async () => {
        throw new Error('should not be called');
      },
      delete: async () => undefined,
    };
    const governor = new UsageGovernor({
      storage,
      now: clock().now,
      policy: { ...POLICY, enabled: false },
    });
    const result = await governor.checkAndReserve({
      operation: 'find-recovery-risks',
      accountId: ALICE,
    });
    expect(result).toMatchObject({ ok: false, reason: 'DISABLED' });
  });

  it('is DISABLED when no settings exist (no allowance is assumed)', async () => {
    const governor = new UsageGovernor({ storage: new InMemoryStorage(), now: clock().now });
    const result = await governor.checkAndReserve({
      operation: 'find-recovery-risks',
      accountId: ALICE,
    });
    expect(result).toMatchObject({ ok: false, reason: 'DISABLED' });
  });

  it('is DISABLED when the admin switches AI off or settings are malformed', async () => {
    const off = await setup(POLICY, { aiEnabled: false });
    expect(
      await off.governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'DISABLED' });

    const storage = new InMemoryStorage();
    await storage.set(SETTINGS_KEY, { aiEnabled: 'true' }, null);
    const governor = new UsageGovernor({ storage, now: clock().now, policy: POLICY });
    expect(
      await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'DISABLED' });
  });
});

describe('request validation', () => {
  it.each([
    { operation: 'apply-decision', accountId: ALICE },
    { operation: 'explain-outcome', accountId: '' },
    { operation: 'explain-outcome', accountId: 'bad id; drop' },
    { operation: 'explain-outcome' },
  ])('rejects %j as INVALID', async (request) => {
    const { governor } = await setup();
    expect(await governor.checkAndReserve(request as never)).toMatchObject({
      ok: false,
      reason: 'INVALID',
    });
  });

  it('rejects malformed reservation ids and amounts', async () => {
    const { governor } = await setup();
    expect(await governor.commit('nope', 1)).toMatchObject({ ok: false, reason: 'INVALID' });
    expect(await governor.release('2026-11.../x')).toMatchObject({ ok: false, reason: 'INVALID' });
    expect(await governor.commit('2026-11.id-1', -1)).toMatchObject({
      ok: false,
      reason: 'INVALID',
    });
    expect(await governor.commit('2026-11.id-1', Number.NaN)).toMatchObject({
      ok: false,
      reason: 'INVALID',
    });
  });
});

describe('monthly installation cap', () => {
  it('reserves until the cap, counting in-flight reservations', async () => {
    const { governor } = await setup({ ...POLICY, perUserDailyCap: 1000 });
    for (let i = 0; i < 10; i += 1) {
      expect(
        await governor.checkAndReserve({ operation: 'find-recovery-risks', accountId: ALICE }),
      ).toMatchObject({ ok: true, units: 10 });
    }
    const denied = await governor.checkAndReserve({
      operation: 'find-recovery-risks',
      accountId: BOB,
    });
    expect(denied).toMatchObject({ ok: false, reason: 'BUDGET_EXHAUSTED', scope: 'installation' });
    // 2026-11-09T12:00Z to 2026-12-01T00:00Z.
    expect(denied.ok ? 0 : denied.retryAfterSeconds).toBe(21 * 86400 + 12 * 3600);
  });

  it('stored settings can lower but never raise the cap', async () => {
    const lowered = await setup(POLICY, { aiEnabled: true, monthlyUnitCap: 15 });
    expect(
      await lowered.governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: true });
    expect(
      await lowered.governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'BUDGET_EXHAUSTED' });

    const raised = await setup(
      { ...POLICY, perUserDailyCap: 1000 },
      { aiEnabled: true, monthlyUnitCap: 10_000 },
    );
    const usage = await raised.governor.getUsage();
    expect(usage).toMatchObject({ ok: true, usage: { monthlyUnitCap: 100 } });
  });
});

describe('per-user daily cap', () => {
  it('limits one user without affecting others, and resets at UTC midnight', async () => {
    const { governor, clock: c } = await setup();
    for (let i = 0; i < 4; i += 1) {
      const r = await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE });
      expect(r.ok).toBe(true);
      if (r.ok) await governor.commit(r.reservationId, 10);
    }
    const denied = await governor.checkAndReserve({
      operation: 'explain-outcome',
      accountId: ALICE,
    });
    expect(denied).toMatchObject({ ok: false, reason: 'BUDGET_EXHAUSTED', scope: 'user' });
    expect(denied.ok ? 0 : denied.retryAfterSeconds).toBe(12 * 3600);

    expect(
      await governor.checkAndReserve({ operation: 'explain-outcome', accountId: BOB }),
    ).toMatchObject({ ok: true });

    c.set('2026-11-10T00:00:01.000Z');
    expect(
      await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: true });
  });
});

describe('rate limiting (token bucket per user and operation)', () => {
  const limited: BudgetPolicy = { ...POLICY, rateLimit: { capacity: 2, refillPerMinute: 1 } };

  it('allows a burst up to capacity, then refills over time', async () => {
    const { governor, clock: c } = await setup(limited);
    const ask = (operation: 'explain-outcome' | 'find-recovery-risks' = 'explain-outcome') =>
      governor.checkAndReserve({ operation, accountId: ALICE });

    expect((await ask()).ok).toBe(true);
    expect((await ask()).ok).toBe(true);
    const denied = await ask();
    expect(denied).toMatchObject({ ok: false, reason: 'RATE_LIMITED', retryAfterSeconds: 60 });

    // Separate bucket per operation and per user.
    expect((await ask('find-recovery-risks')).ok).toBe(true);
    expect(
      (await governor.checkAndReserve({ operation: 'explain-outcome', accountId: BOB })).ok,
    ).toBe(true);

    c.advance(30);
    expect(await ask()).toMatchObject({ ok: false, reason: 'RATE_LIMITED', retryAfterSeconds: 30 });
    c.advance(30);
    expect((await ask()).ok).toBe(true);
  });

  it('a released reservation does not refund the rate-limit token', async () => {
    const { governor } = await setup(limited);
    for (let i = 0; i < 2; i += 1) {
      const r = await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE });
      if (r.ok) await governor.release(r.reservationId);
    }
    expect(
      await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'RATE_LIMITED' });
  });
});

describe('reserve, commit, release', () => {
  it('commit charges actual units, rounded up', async () => {
    const { governor } = await setup();
    const r = await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE });
    if (!r.ok) throw new Error('expected reservation');
    expect(r.reservationId).toBe('2026-11.id-1');
    expect(await governor.commit(r.reservationId, 3.2)).toEqual({ ok: true, chargedUnits: 4 });
    expect(await governor.getUsage()).toMatchObject({
      ok: true,
      usage: {
        committedUnits: 4,
        reservedUnits: 0,
        remainingUnits: 96,
        topUsersToday: [{ accountId: ALICE, units: 4 }],
      },
    });
  });

  it('release frees the reservation so failed calls do not count', async () => {
    const { governor } = await setup();
    const r = await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE });
    if (!r.ok) throw new Error('expected reservation');
    expect(await governor.getUsage()).toMatchObject({ usage: { reservedUnits: 10 } });
    expect(await governor.release(r.reservationId)).toEqual({ ok: true, chargedUnits: 0 });
    expect(await governor.getUsage()).toMatchObject({
      usage: { committedUnits: 0, reservedUnits: 0, remainingUnits: 100 },
    });
  });

  it('settling twice is UNKNOWN_RESERVATION, not a double charge', async () => {
    const { governor } = await setup();
    const r = await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE });
    if (!r.ok) throw new Error('expected reservation');
    await governor.commit(r.reservationId, 10);
    expect(await governor.commit(r.reservationId, 10)).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_RESERVATION',
    });
    expect(await governor.release('2026-10.never')).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_RESERVATION',
    });
    expect(await governor.getUsage()).toMatchObject({ usage: { committedUnits: 10 } });
  });

  it('settle(): unknown outcomes are charged at the estimate, not released', async () => {
    const { governor } = await setup();
    const reserve = async () => {
      const r = await governor.checkAndReserve({
        operation: 'teamwork-graph-enriched',
        accountId: ALICE,
      });
      if (!r.ok) throw new Error('expected reservation');
      return r.reservationId;
    };
    expect(await governor.settle(await reserve(), { kind: 'failed-unknown' })).toEqual({
      ok: true,
      chargedUnits: 10,
    });
    expect(await governor.settle(await reserve(), { kind: 'not-called' })).toEqual({
      ok: true,
      chargedUnits: 0,
    });
    expect(await governor.settle(await reserve(), { kind: 'succeeded', actualUnits: 2 })).toEqual({
      ok: true,
      chargedUnits: 2,
    });
    expect(await governor.settle(await reserve(), { kind: 'succeeded' })).toEqual({
      ok: true,
      chargedUnits: 10,
    });
  });

  it('never-settled reservations expire and are charged at their estimate', async () => {
    const { governor, clock: c } = await setup();
    const r = await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE });
    if (!r.ok) throw new Error('expected reservation');
    c.advance(POLICY.reservationTtlSeconds);
    expect(await governor.getUsage()).toMatchObject({
      usage: { committedUnits: 10, expiredUnits: 10, reservedUnits: 0 },
    });
    expect(await governor.release(r.reservationId)).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_RESERVATION',
    });
  });
});

describe('month rollover (UTC)', () => {
  it('starts a fresh ledger on the 1st and settles old reservations in their own month', async () => {
    const { governor, clock: c, storage } = await setup({ ...POLICY, perUserDailyCap: 1000 });
    c.set('2026-11-30T23:59:00.000Z');
    const reservations: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const r = await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE });
      if (r.ok) reservations.push(r.reservationId);
    }
    expect(
      await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'BUDGET_EXHAUSTED', retryAfterSeconds: 60 });

    c.set('2026-12-01T00:00:00.000Z');
    const fresh = await governor.checkAndReserve({
      operation: 'explain-outcome',
      accountId: ALICE,
    });
    expect(fresh).toMatchObject({ ok: true });
    expect(fresh.ok && fresh.reservationId.startsWith('2026-12.')).toBe(true);

    expect(await governor.commit(reservations[0]!, 10)).toEqual({ ok: true, chargedUnits: 10 });
    const november = await storage.get<{ committedUnits: number }>(ledgerKey('2026-11'));
    expect(november?.value.committedUnits).toBe(10);
    expect(await governor.getUsage()).toMatchObject({
      usage: { period: '2026-12', committedUnits: 0, reservedUnits: 10 },
    });
  });
});

describe('optimistic concurrency', () => {
  /** Lets a competing writer bump the ledger between our read and write. */
  class RacingStorage extends InMemoryStorage {
    races = 0;
    override async set<T>(key: string, value: T, expected: number | null): Promise<WriteResult> {
      if (this.races > 0 && key.startsWith('ai-governance:ledger:')) {
        this.races -= 1;
        const current = await this.get<T>(key);
        await super.set(key, (current?.value ?? value) as T, current?.version ?? null);
      }
      return super.set(key, value, expected);
    }
  }

  it('two concurrent reservations for the last slot: exactly one wins', async () => {
    const storage = await enabledStorage();
    const governor = new UsageGovernor({
      storage,
      now: clock().now,
      policy: { ...POLICY, monthlyUnitCap: 10 },
      newId: ids(),
    });
    const results = await Promise.all([
      governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
      governor.checkAndReserve({ operation: 'explain-outcome', accountId: BOB }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: 'BUDGET_EXHAUSTED' });
    expect((await storage.get(ledgerKey('2026-11')))?.version).toBe(1);
  });

  it('retries after a version conflict and keeps both writes', async () => {
    const storage = new RacingStorage();
    await storage.set(SETTINGS_KEY, { aiEnabled: true }, null);
    const governor = new UsageGovernor({ storage, now: clock().now, policy: POLICY, newId: ids() });
    await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE });
    storage.races = 1;
    expect(
      await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: true });
    expect(await governor.getUsage()).toMatchObject({ usage: { reservedUnits: 20 } });
  });

  it('gives up with UNAVAILABLE (deny) when contention never clears', async () => {
    const storage = new RacingStorage();
    await storage.set(SETTINGS_KEY, { aiEnabled: true }, null);
    storage.races = 99;
    const governor = new UsageGovernor({
      storage,
      now: clock().now,
      policy: POLICY,
      maxAttempts: 3,
    });
    expect(
      await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
  });
});

describe('fail closed', () => {
  function throwing(on: 'get' | 'set', keyPrefix = ''): StorageAdapter {
    const inner = new InMemoryStorage();
    void inner.set(SETTINGS_KEY, { aiEnabled: true }, null);
    return {
      get: async <T>(key: string): Promise<Versioned<T> | undefined> => {
        if (on === 'get' && key.startsWith(keyPrefix)) throw new Error('store down');
        return inner.get<T>(key);
      },
      set: async <T>(key: string, value: T, expected: number | null) => {
        if (on === 'set' && key.startsWith(keyPrefix)) throw new Error('store down');
        return inner.set(key, value, expected);
      },
      delete: (key) => inner.delete(key),
    };
  }

  it.each([
    ['settings read', throwing('get', SETTINGS_KEY)],
    ['ledger read', throwing('get', 'ai-governance:ledger:')],
    ['ledger write', throwing('set', 'ai-governance:ledger:')],
  ])('denies with UNAVAILABLE when the %s throws', async (_label, storage) => {
    const governor = new UsageGovernor({ storage, now: clock().now, policy: POLICY });
    expect(
      await governor.checkAndReserve({ operation: 'explain-outcome', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
  });

  it('settle and getUsage report UNAVAILABLE instead of throwing', async () => {
    const governor = new UsageGovernor({
      storage: throwing('get'),
      now: clock().now,
      policy: POLICY,
    });
    expect(await governor.commit('2026-11.id-1', 1)).toMatchObject({
      ok: false,
      reason: 'UNAVAILABLE',
    });
    expect(await governor.getUsage()).toEqual({ ok: false, reason: 'UNAVAILABLE' });
  });
});

// Response cache --------------------------------------------------------------

type Output = { ok: boolean; unknowns: string[]; answer?: string; status?: string };

const PARTS: CacheKeyParts = {
  operation: 'find-recovery-risks',
  scope: ALICE,
  inputs: { changeKey: 'OPS-42' },
  evidenceFingerprint: evidenceFingerprint([
    { id: 'jira:OPS-42', version: '2026-11-08T09:30:00Z' },
    { id: 'confluence:123', version: 7 },
  ]),
};

const GOOD: Output = { ok: true, unknowns: [], answer: 'two procedures at risk' };

function cacheSetup(policy = { ttlSeconds: 60, maxEntries: 2 }) {
  const storage = new InMemoryStorage();
  const c = clock();
  return { storage, clock: c, cache: new ResponseCache<Output>({ storage, now: c.now, policy }) };
}

describe('cache keys', () => {
  it('normalizes inputs: key order, whitespace and empty values do not matter', () => {
    expect(normalizeInputs({ b: ' x ', a: 1, c: undefined, d: '' })).toBe(
      normalizeInputs({ a: 1, b: 'x', e: null }),
    );
    expect(normalizeInputs({ a: 'OPS-1' })).not.toBe(normalizeInputs({ a: 'ops-1' }));
  });

  it('evidence fingerprint ignores order but changes with versions', () => {
    const a = evidenceFingerprint([
      { id: 'x', version: 1 },
      { id: 'y', version: 2 },
    ]);
    expect(a).toBe(
      evidenceFingerprint([
        { id: 'y', version: 2 },
        { id: 'x', version: 1 },
      ]),
    );
    expect(a).not.toBe(
      evidenceFingerprint([
        { id: 'x', version: 1 },
        { id: 'y', version: 3 },
      ]),
    );
  });

  it('scopes keys by user', () => {
    expect(canonicalKey(PARTS)).not.toBe(canonicalKey({ ...PARTS, scope: BOB }));
  });
});

describe('ResponseCache', () => {
  it('misses, stores, then hits with the evidence ids used', async () => {
    const { cache } = cacheSetup();
    expect(await cache.get(PARTS)).toEqual({ hit: false, reason: 'MISS' });
    expect(await cache.put(PARTS, GOOD, ['jira:OPS-42', 'confluence:123'])).toEqual({
      stored: true,
      evicted: 0,
    });
    expect(await cache.get({ ...PARTS, inputs: { changeKey: ' OPS-42 ' } })).toEqual({
      hit: true,
      value: GOOD,
      evidenceIds: ['jira:OPS-42', 'confluence:123'],
      storedAt: '2026-11-09T12:00:00.000Z',
    });
  });

  it('misses for another user or changed evidence', async () => {
    const { cache } = cacheSetup();
    await cache.put(PARTS, GOOD, []);
    expect((await cache.get({ ...PARTS, scope: BOB })).hit).toBe(false);
    expect(
      (await cache.get({ ...PARTS, evidenceFingerprint: evidenceFingerprint([{ id: 'other' }]) }))
        .hit,
    ).toBe(false);
  });

  it('expires after the TTL', async () => {
    const { cache, clock: c } = cacheSetup();
    await cache.put(PARTS, GOOD, []);
    c.advance(59);
    expect((await cache.get(PARTS)).hit).toBe(true);
    c.advance(1);
    expect(await cache.get(PARTS)).toEqual({ hit: false, reason: 'EXPIRED' });
  });

  it('evicts the oldest entry beyond max entries and deletes it from storage', async () => {
    const { cache, clock: c, storage } = cacheSetup();
    const keyed = (k: string): CacheKeyParts => ({ ...PARTS, inputs: { changeKey: k } });
    await cache.put(keyed('A-1'), GOOD, []);
    c.advance(1);
    await cache.put(keyed('A-2'), GOOD, []);
    c.advance(1);
    expect(await cache.put(keyed('A-3'), GOOD, [])).toEqual({ stored: true, evicted: 1 });
    expect((await cache.get(keyed('A-1'))).hit).toBe(false);
    expect((await cache.get(keyed('A-2'))).hit).toBe(true);
    expect((await cache.get(keyed('A-3'))).hit).toBe(true);
    const index = await storage.get<{ entries: Record<string, unknown> }>(CACHE_INDEX_KEY);
    expect(Object.keys(index?.value.entries ?? {})).toHaveLength(2);
    expect(storage.keys().filter((k) => k.startsWith('ai-cache:entry:'))).toHaveLength(2);
  });

  it('never caches failures or results with unknowns', async () => {
    const { cache, storage } = cacheSetup();
    expect(await cache.put(PARTS, { ok: false, unknowns: [] }, [])).toEqual({
      stored: false,
      reason: 'FAILURE_NOT_CACHED',
    });
    expect(await cache.put(PARTS, { ok: true, unknowns: ['Confluence unavailable'] }, [])).toEqual({
      stored: false,
      reason: 'UNKNOWNS_NOT_CACHED',
    });
    expect(await cache.put(PARTS, { ok: true, unknowns: [], status: 'not-assessed' }, [])).toEqual({
      stored: false,
      reason: 'UNKNOWNS_NOT_CACHED',
    });
    expect(storage.keys()).toEqual([]);
    expect(await cache.get(PARTS)).toEqual({ hit: false, reason: 'MISS' });
  });

  it('a store error is a miss on read and not-stored on write, never a throw', async () => {
    const broken: StorageAdapter = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      delete: async () => undefined,
    };
    const cache = new ResponseCache<Output>({ storage: broken, now: clock().now });
    expect(await cache.get(PARTS)).toEqual({ hit: false, reason: 'UNAVAILABLE' });
    expect(await cache.put(PARTS, GOOD, [])).toEqual({ stored: false, reason: 'UNAVAILABLE' });
  });
});
