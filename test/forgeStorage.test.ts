import type * as ForgeKvs from '@forge/kvs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, SETTINGS_KEY, UsageGovernor, ledgerKey } from '../shared/agents/budget';
import type { CacheKeyParts } from '../shared/agents/cache';
import { ResponseCache, evidenceFingerprint } from '../shared/agents/cache';
import type { GovernanceKvsClient, GovernanceRecord, WriteCondition } from '../src/ai/forgeStorage';
import {
  ForgeEntityStorage,
  ForgeStorageError,
  GOVERNANCE_ENTITY,
  MAX_RECORD_BYTES,
  forgeKvsClient,
  isPossibleConditionFailure,
} from '../src/ai/forgeStorage';

// `@forge/kvs` needs the Forge runtime for network calls; keep its real
// Filter/FilterConditions builders and replace only the `kvs` client.
const kvsMock = vi.hoisted(() => {
  const execute = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ execute }));
  return {
    execute,
    set,
    transact: vi.fn(() => ({ set })),
    entityGet: vi.fn(async (): Promise<unknown> => undefined),
    entityDelete: vi.fn(async () => undefined),
  };
});

vi.mock('@forge/kvs', async (importOriginal) => {
  const actual = await importOriginal<typeof ForgeKvs>();
  return {
    ...actual,
    kvs: {
      transact: kvsMock.transact,
      entity: () => ({ get: kvsMock.entityGet, delete: kvsMock.entityDelete }),
    },
  };
});

/** Shape of a Forge KVS API error (ForgeKvsAPIError: code + responseDetails.status). */
function apiError(status: number, code: string) {
  return Object.assign(new Error(code), { code, responseDetails: { status } });
}

/**
 * Fake Custom Entity Store. A failed condition rejects with a 400 like the
 * real API; the real error code is undocumented, so the fake uses an
 * arbitrary one to prove the adapter does not depend on it.
 */
class FakeKvs implements GovernanceKvsClient {
  readonly rows = new Map<string, GovernanceRecord>();
  failNext: Error | undefined;
  writes = 0;

  private maybeFail() {
    const error = this.failNext;
    this.failNext = undefined;
    if (error) throw error;
  }

  async get(key: string) {
    this.maybeFail();
    const row = this.rows.get(key);
    return row ? { ...row } : undefined;
  }

  async conditionalSet(key: string, record: GovernanceRecord, condition: WriteCondition) {
    this.maybeFail();
    const current = this.rows.get(key);
    const met =
      condition.kind === 'absent'
        ? current === undefined
        : current !== undefined && current.version === condition.equals;
    if (!met) throw apiError(400, 'SOME_UNDOCUMENTED_CONDITION_CODE');
    this.writes += 1;
    this.rows.set(key, { ...record });
  }

  async delete(key: string) {
    this.maybeFail();
    this.rows.delete(key);
  }
}

function setup() {
  const fake = new FakeKvs();
  return { fake, storage: new ForgeEntityStorage(fake) };
}

describe('ForgeEntityStorage get', () => {
  it('returns undefined for a missing key', async () => {
    const { storage } = setup();
    expect(await storage.get('ai-governance:settings')).toBeUndefined();
  });

  it('returns the parsed value and version for a present key', async () => {
    const { fake, storage } = setup();
    fake.rows.set('ai-governance:settings', {
      version: 4,
      payload: JSON.stringify({ aiEnabled: true }),
    });
    expect(await storage.get('ai-governance:settings')).toEqual({
      value: { aiEnabled: true },
      version: 4,
    });
  });

  it('throws on a malformed stored record', async () => {
    const { fake, storage } = setup();
    fake.rows.set('k1', { version: 0, payload: '{}' });
    await expect(storage.get('k1')).rejects.toThrow(ForgeStorageError);
    fake.rows.set('k1', { version: 1, payload: 'not json' });
    await expect(storage.get('k1')).rejects.toThrow(ForgeStorageError);
  });
});

describe('ForgeEntityStorage set', () => {
  it('creates only if absent', async () => {
    const { fake, storage } = setup();
    expect(await storage.set('k1', { a: 1 }, null)).toEqual({ ok: true, version: 1 });
    expect(fake.rows.get('k1')).toEqual({ version: 1, payload: '{"a":1}' });
  });

  it('create-only conflicts when the key exists', async () => {
    const { fake, storage } = setup();
    await storage.set('k1', { a: 1 }, null);
    expect(await storage.set('k1', { a: 2 }, null)).toEqual({ ok: false, reason: 'CONFLICT' });
    expect(fake.rows.get('k1')?.payload).toBe('{"a":1}');
  });

  it('updates when the version matches', async () => {
    const { storage } = setup();
    await storage.set('k1', { a: 1 }, null);
    expect(await storage.set('k1', { a: 2 }, 1)).toEqual({ ok: true, version: 2 });
    expect(await storage.get('k1')).toEqual({ value: { a: 2 }, version: 2 });
  });

  it('conflicts on a stale version or a missing key', async () => {
    const { storage } = setup();
    await storage.set('k1', { a: 1 }, null);
    await storage.set('k1', { a: 2 }, 1);
    expect(await storage.set('k1', { a: 3 }, 1)).toEqual({ ok: false, reason: 'CONFLICT' });
    expect(await storage.set('missing', { a: 1 }, 1)).toEqual({ ok: false, reason: 'CONFLICT' });
    expect(await storage.get('k1')).toEqual({ value: { a: 2 }, version: 2 });
  });

  it('throws on transport errors instead of reporting a conflict', async () => {
    const { fake, storage } = setup();
    fake.failNext = new Error('socket hang up');
    await expect(storage.set('k1', { a: 1 }, null)).rejects.toThrow('socket hang up');
    fake.failNext = apiError(500, 'INTERNAL_SERVER_ERROR');
    await expect(storage.get('k1')).rejects.toThrow('INTERNAL_SERVER_ERROR');
    fake.failNext = apiError(429, 'RATE_LIMIT_EXCEEDED');
    await expect(storage.set('k1', { a: 1 }, null)).rejects.toThrow('RATE_LIMIT_EXCEEDED');
    fake.failNext = new Error('down');
    await expect(storage.delete('k1')).rejects.toThrow('down');
  });

  it('throws on a 400 rejection when the version did not move', async () => {
    const { fake, storage } = setup();
    await storage.set('k1', { a: 1 }, null);
    fake.failNext = apiError(400, 'SOMETHING_ELSE');
    await expect(storage.set('k1', { a: 2 }, 1)).rejects.toThrow('SOMETHING_ELSE');
  });

  it('rejects an oversize payload before calling the store', async () => {
    const { fake, storage } = setup();
    const big = 'x'.repeat(MAX_RECORD_BYTES);
    await expect(storage.set('k1', { big }, null)).rejects.toThrow(/240 KiB/);
    expect(fake.writes).toBe(0);
    expect(await storage.set('k1', { big: 'x'.repeat(MAX_RECORD_BYTES - 100) }, null)).toEqual({
      ok: true,
      version: 1,
    });
  });

  it('rejects values that are not JSON and bad expected versions', async () => {
    const { storage } = setup();
    await expect(storage.set('k1', undefined, null)).rejects.toThrow(ForgeStorageError);
    await expect(storage.set('k1', 1, 0)).rejects.toThrow(ForgeStorageError);
    await expect(storage.set('k1', 1, 1.5)).rejects.toThrow(ForgeStorageError);
  });
});

describe('key validation', () => {
  it.each(['', 'x', 'a/b', 'café', '   ', 'k'.repeat(501), 'a?b'])('rejects %j', async (key) => {
    const { fake, storage } = setup();
    await expect(storage.get(key)).rejects.toThrow(ForgeStorageError);
    await expect(storage.set(key, 1, null)).rejects.toThrow(ForgeStorageError);
    await expect(storage.delete(key)).rejects.toThrow(ForgeStorageError);
    expect(fake.writes).toBe(0);
  });

  it('accepts the governance and cache key shapes', async () => {
    const { storage } = setup();
    for (const key of [
      SETTINGS_KEY,
      ledgerKey('2026-11'),
      'ai-cache:index',
      'ai-cache:entry:0123456789abcdef',
      'with space_and.dot#1',
      'k'.repeat(500),
    ]) {
      expect((await storage.set(key, 1, null)).ok).toBe(true);
    }
  });
});

describe('delete', () => {
  it('removes a key and tolerates a missing one', async () => {
    const { storage } = setup();
    await storage.set('k1', 1, null);
    await storage.delete('k1');
    await storage.delete('k1');
    expect(await storage.get('k1')).toBeUndefined();
  });
});

describe('isPossibleConditionFailure', () => {
  it('only treats 4xx rejections without a known non-condition code as candidates', () => {
    expect(isPossibleConditionFailure(apiError(400, 'ANYTHING'))).toBe(true);
    expect(isPossibleConditionFailure(apiError(409, 'CONFLICT'))).toBe(true);
    expect(isPossibleConditionFailure(apiError(400, 'MAX_SIZE'))).toBe(false);
    expect(isPossibleConditionFailure(apiError(429, 'RATE_LIMIT_EXCEEDED'))).toBe(false);
    expect(isPossibleConditionFailure(apiError(500, 'X'))).toBe(false);
    expect(isPossibleConditionFailure(new Error('network'))).toBe(false);
    expect(isPossibleConditionFailure(undefined)).toBe(false);
  });
});

describe('forgeKvsClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create-only writes use a notExists condition on version', async () => {
    await forgeKvsClient().conditionalSet('k1', { version: 1, payload: '1' }, { kind: 'absent' });
    const [key, record, entity] = kvsMock.set.mock.calls[0] as unknown as [
      string,
      GovernanceRecord,
      { entityName: string; conditions: unknown },
    ];
    expect(key).toBe('k1');
    expect(record).toEqual({ version: 1, payload: '1' });
    expect(entity.entityName).toBe(GOVERNANCE_ENTITY);
    expect(JSON.parse(JSON.stringify(entity.conditions))).toEqual({
      items: [{ property: 'version', condition: 'NOT_EXISTS', values: [true] }],
    });
    expect(kvsMock.execute).toHaveBeenCalledTimes(1);
  });

  it('versioned writes use an equalTo condition on version', async () => {
    await forgeKvsClient().conditionalSet(
      'k1',
      { version: 3, payload: '1' },
      { kind: 'version', equals: 2 },
    );
    const entity = (
      kvsMock.set.mock.calls[0] as unknown as [string, unknown, { conditions: unknown }]
    )[2];
    expect(JSON.parse(JSON.stringify(entity.conditions))).toEqual({
      items: [{ property: 'version', condition: 'EQUAL_TO', values: [2] }],
    });
  });

  it('reads and deletes through the entity API', async () => {
    kvsMock.entityGet.mockResolvedValueOnce({ version: 1, payload: '"v"' });
    const storage = new ForgeEntityStorage();
    expect(await storage.get('k1')).toEqual({ value: 'v', version: 1 });
    await storage.delete('k1');
    expect(kvsMock.entityDelete).toHaveBeenCalledWith('k1');
  });
});

describe('UsageGovernor and ResponseCache on ForgeEntityStorage', () => {
  const ALICE = '557058:alice';
  const now = () => new Date('2026-11-10T12:00:00.000Z');
  type Output = { ok: boolean; unknowns: string[]; answer: string };
  const PARTS: CacheKeyParts = {
    operation: 'find-recovery-risks',
    scope: ALICE,
    inputs: { changeKey: 'OPS-42' },
    evidenceFingerprint: evidenceFingerprint([{ id: 'jira:OPS-42', version: 1 }]),
  };

  it('denies while AI is not enabled, then reserves, caches and settles', async () => {
    const { fake, storage } = setup();
    let n = 0;
    const governor = new UsageGovernor({ storage, now, newId: () => `id-${++n}` });
    const cache = new ResponseCache<Output>({ storage, now });

    expect(
      await governor.checkAndReserve({ operation: 'find-recovery-risks', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'DISABLED' });

    await storage.set(SETTINGS_KEY, { aiEnabled: true }, null);
    const r = await governor.checkAndReserve({
      operation: 'find-recovery-risks',
      accountId: ALICE,
    });
    expect(r).toMatchObject({ ok: true, units: 10 });
    if (!r.ok) return;

    expect(await cache.get(PARTS)).toEqual({ hit: false, reason: 'MISS' });
    const answer: Output = { ok: true, unknowns: [], answer: 'two procedures at risk' };
    expect(await governor.settle(r.reservationId, { kind: 'succeeded' })).toEqual({
      ok: true,
      chargedUnits: 10,
    });
    expect(await cache.put(PARTS, answer, ['jira:OPS-42'])).toMatchObject({ stored: true });
    expect(await cache.get(PARTS)).toMatchObject({ hit: true, value: answer });

    expect(await governor.getUsage()).toMatchObject({
      ok: true,
      usage: { committedUnits: 10, reservedUnits: 0 },
    });
    expect(fake.rows.get(ledgerKey('2026-11'))?.version).toBeGreaterThan(1);
  });

  it('fails closed when the store is unreachable', async () => {
    const { fake, storage } = setup();
    await storage.set(SETTINGS_KEY, { aiEnabled: true }, null);
    const governor = new UsageGovernor({ storage, now, policy: DEFAULT_POLICY });
    fake.failNext = apiError(503, 'SERVICE_UNAVAILABLE');
    expect(
      await governor.checkAndReserve({ operation: 'find-recovery-risks', accountId: ALICE }),
    ).toMatchObject({ ok: false, reason: 'UNAVAILABLE' });
  });

  it('retries a lost race through the conflict path', async () => {
    const { fake, storage } = setup();
    await storage.set(SETTINGS_KEY, { aiEnabled: true }, null);
    let n = 0;
    const governor = new UsageGovernor({ storage, now, newId: () => `id-${++n}` });
    // Another invocation creates the ledger between our read and our write.
    const original = fake.conditionalSet.bind(fake);
    let raced = false;
    fake.conditionalSet = async (key, record, condition) => {
      if (!raced && key === ledgerKey('2026-11')) {
        raced = true;
        const other = new UsageGovernor({ storage, now, newId: () => 'other' });
        await other.checkAndReserve({ operation: 'explain-outcome', accountId: '557058:bob' });
      }
      return original(key, record, condition);
    };
    const r = await governor.checkAndReserve({
      operation: 'find-recovery-risks',
      accountId: ALICE,
    });
    expect(r).toMatchObject({ ok: true });
    expect(await governor.getUsage()).toMatchObject({ usage: { reservedUnits: 20 } });
  });
});
