import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, SETTINGS_KEY, ledgerKey } from '../shared/agents/budget';
import { CACHE_INDEX_KEY, cacheEntryKey, hashKey } from '../shared/agents/cache';
import {
  FORGE_MAX_VALUE_BYTES,
  KEY_PATTERN as HISTORY_KEY_PATTERN,
  MAX_ID_LENGTH,
  MAX_KEY_LENGTH as HISTORY_MAX_KEY_LENGTH,
  MAX_VALUE_BYTES,
  indexKey,
  retestKey,
  runKey,
} from '../shared/history';
import {
  CRISIS_ENTITY,
  GOVERNANCE_ENTITY,
  HISTORY_ENTITY,
  MAX_KEY_LENGTH,
  MAX_RECORD_BYTES,
  validateKey,
} from '../src/ai/forgeStorage';
import {
  PER_USER_DAILY_CAP_CEILING,
  PER_USER_DAILY_CAP_DEFAULT,
  AI_FLAG,
  CRISIS_FLAG,
  STORAGE_FLAG,
  USER_DAILY_CAP_VARIABLE,
  crisisStorage,
  governancePolicy,
  governanceStorage,
  historyStorage,
  historyStore,
  perUserDailyCap,
  responseCache,
  siteStorageEnabled,
  usageGovernor,
} from '../src/platform/storageFactory';
import { fakeStore } from './helpers/fakeKvs';

const ON = { [STORAGE_FLAG]: 'enabled' };
const NOW = () => new Date('2026-11-10T12:00:00.000Z');

describe('crisis room storage (SF_STORAGE and SF_CRISIS)', () => {
  it('is null unless both flags are exactly enabled', () => {
    const { clientFor } = fakeStore();
    expect(crisisStorage({ env: {}, clientFor })).toBeNull();
    expect(crisisStorage({ env: ON, clientFor })).toBeNull();
    expect(crisisStorage({ env: { [CRISIS_FLAG]: 'enabled' }, clientFor })).toBeNull();
    expect(crisisStorage({ env: { ...ON, [CRISIS_FLAG]: 'true' }, clientFor })).toBeNull();
    expect(process.env[CRISIS_FLAG]).toBeUndefined();
  });

  it('uses the crisis-room entity when both flags are on', async () => {
    const { clientFor, entities } = fakeStore();
    const storage = crisisStorage({ env: { ...ON, [CRISIS_FLAG]: 'enabled' }, clientFor })!;
    expect(await storage.set('sfc1:x:room:r1', { a: 1 }, null)).toMatchObject({ ok: true });
    expect([...entities.keys()]).toEqual([CRISIS_ENTITY]);
  });
});

describe('storage flag (SF_STORAGE)', () => {
  it('defaults to off, so every factory returns null', () => {
    const { clientFor, entities } = fakeStore();
    for (const env of [{}, { [STORAGE_FLAG]: undefined }]) {
      const options = { env, clientFor, now: NOW };
      expect(siteStorageEnabled(env)).toBe(false);
      expect(governanceStorage(options)).toBeNull();
      expect(historyStorage(options)).toBeNull();
      expect(usageGovernor(options)).toBeNull();
      expect(responseCache(options)).toBeNull();
      expect(historyStore(options)).toBeNull();
    }
    expect(entities.size).toBe(0);
  });

  it('accepts only the exact value "enabled"', () => {
    for (const value of ['true', '1', 'Enabled', ' enabled', 'enabled ', 'yes', '']) {
      expect(siteStorageEnabled({ [STORAGE_FLAG]: value })).toBe(false);
    }
    expect(siteStorageEnabled(ON)).toBe(true);
  });

  it('is off in this test process (no variable set)', () => {
    expect(process.env[STORAGE_FLAG]).toBeUndefined();
    expect(governanceStorage()).toBeNull();
    expect(historyStorage()).toBeNull();
  });
});

describe('per-user daily cap variable', () => {
  it.each([
    [undefined, 50],
    ['50', 50],
    ['120', 120],
    ['300', 300],
    [' 300 ', 300],
    ['301', 50],
    ['49', 50],
    ['0', 50],
    ['-100', 50],
    ['100.5', 50],
    ['1e2', 50],
    ['0x64', 50],
    ['abc', 50],
    ['', 50],
    ['99999', 50],
  ])('%s gives %i', (raw, expected) => {
    expect(perUserDailyCap({ [USER_DAILY_CAP_VARIABLE]: raw })).toBe(expected);
  });

  it('default and floor equal the code policy default', () => {
    expect(PER_USER_DAILY_CAP_DEFAULT).toBe(DEFAULT_POLICY.perUserDailyCap);
    expect(PER_USER_DAILY_CAP_CEILING).toBe(300);
  });

  it('changes only perUserDailyCap in the policy', () => {
    const ai = { [AI_FLAG]: 'enabled' };
    const policy = governancePolicy({ ...ai, [USER_DAILY_CAP_VARIABLE]: '300' });
    expect(policy).toEqual({ ...DEFAULT_POLICY, perUserDailyCap: 300 });
    expect(governancePolicy(ai)).toEqual(DEFAULT_POLICY);
    // Without the site opt-in the policy is switched off (kill switch AND opt-in).
    expect(governancePolicy({})).toEqual({ ...DEFAULT_POLICY, enabled: false });
  });
});

describe('wiring when enabled', () => {
  it('governor is DISABLED without SF_AI and touches no storage', async () => {
    const { clientFor, entities } = fakeStore();
    const env = { ...ON, [USER_DAILY_CAP_VARIABLE]: '300' };
    for (const value of [undefined, 'true', 'Enabled', 'enabled ', '1']) {
      const governor = usageGovernor({
        env: { ...env, [AI_FLAG]: value },
        clientFor,
        now: NOW,
      })!;
      const denied = await governor.checkAndReserve({
        operation: 'find-recovery-risks',
        accountId: 'user-1',
      });
      expect(denied).toMatchObject({ ok: false, reason: 'DISABLED' });
    }
    expect([...entities.values()].flatMap((e) => e.ops)).toEqual([]);
  });

  it('governor with SF_AI=enabled uses ai-governance and applies the cap', async () => {
    const { clientFor, entities } = fakeStore();
    const env = { ...ON, [USER_DAILY_CAP_VARIABLE]: '300', [AI_FLAG]: 'enabled' };
    const governor = usageGovernor({ env, clientFor, now: NOW })!;
    const reserved = await governor.checkAndReserve({
      operation: 'find-recovery-risks',
      accountId: 'user-1',
    });
    expect(reserved.ok).toBe(true);
    expect([...entities.keys()]).toEqual([GOVERNANCE_ENTITY]);
    expect(entities.get(GOVERNANCE_ENTITY)!.rows.has(ledgerKey('2026-11'))).toBe(true);
    // The opt-in is never written as a settings record.
    expect(entities.get(GOVERNANCE_ENTITY)!.rows.has(SETTINGS_KEY)).toBe(false);
    const usage = await governor.getUsage();
    expect(usage).toMatchObject({
      ok: true,
      usage: { aiEnabled: true, perUserDailyCap: 300, monthlyUnitCap: 500 },
    });
  });

  it('a stored settings record overrides the opt-in (off switch, fail closed)', async () => {
    for (const payload of [{ aiEnabled: false }, { aiEnabled: 'yes' }]) {
      const { clientFor, entities } = fakeStore();
      const env = { ...ON, [AI_FLAG]: 'enabled' };
      const governor = usageGovernor({ env, clientFor, now: NOW })!;
      await governor.checkAndReserve({ operation: 'find-recovery-risks', accountId: 'user-1' });
      entities.get(GOVERNANCE_ENTITY)!.rows.set(SETTINGS_KEY, {
        version: 1,
        payload: JSON.stringify(payload),
      });
      const denied = await governor.checkAndReserve({
        operation: 'find-recovery-risks',
        accountId: 'user-2',
      });
      expect(denied).toMatchObject({ ok: false, reason: 'DISABLED' });
    }
  });

  it('a stored settings record can only lower the cap', async () => {
    const { clientFor, entities } = fakeStore();
    const env = { ...ON, [USER_DAILY_CAP_VARIABLE]: '300', [AI_FLAG]: 'enabled' };
    const governor = usageGovernor({ env, clientFor, now: NOW })!;
    await governor.checkAndReserve({ operation: 'find-recovery-risks', accountId: 'user-1' });
    entities.get(GOVERNANCE_ENTITY)!.rows.set(SETTINGS_KEY, {
      version: 1,
      payload: JSON.stringify({ aiEnabled: true, perUserDailyCap: 20 }),
    });
    expect(await governor.getUsage()).toMatchObject({ ok: true, usage: { perUserDailyCap: 20 } });
  });

  it('response cache uses ai-governance with ai-cache keys', async () => {
    const { clientFor, entities } = fakeStore();
    const cache = responseCache<{ ok: boolean }>({ env: ON, clientFor, now: NOW })!;
    const parts = {
      operation: 'find-recovery-risks' as const,
      scope: 'user-1',
      inputs: { issueKey: 'MC-62' },
      evidenceFingerprint: 'abc',
    };
    expect(await cache.put(parts, { ok: true }, ['jira:MC-62'])).toMatchObject({ stored: true });
    const keys = [...entities.get(GOVERNANCE_ENTITY)!.rows.keys()].sort();
    expect(keys[1]).toBe(CACHE_INDEX_KEY);
    expect(keys[0]).toMatch(/^ai-cache:entry:[0-9a-f]{16}$/);
    expect(await cache.get(parts)).toMatchObject({ hit: true });
  });

  it('history store uses rehearsal-history only', async () => {
    const { clientFor, entities } = fakeStore();
    const store = historyStore({ env: ON, clientFor, now: NOW })!;
    const result = await store.listRuns({
      installation: 'ari:cloud:jira::site/1',
      accountId: 'u1',
    });
    expect(result).toEqual({ status: 'OK', items: [], pruned: [] });
    expect([...entities.keys()]).toEqual([HISTORY_ENTITY]);
  });

  it('history storage surfaces outages as UNAVAILABLE, never an empty list', async () => {
    const { clientFor, entities } = fakeStore();
    const store = historyStore({ env: ON, clientFor, now: NOW })!;
    clientFor(HISTORY_ENTITY).failOn = () => new Error('network');
    const result = await store.listRuns({ installation: 'i', accountId: 'u1' });
    expect(result).toEqual({ status: 'UNAVAILABLE' });
    expect(entities.get(HISTORY_ENTITY)!.rows.size).toBe(0);
  });
});

describe('schema final review (docs/M6_DEPLOYMENT_READINESS.md §2)', () => {
  const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
  const storageBlock = manifest.slice(manifest.indexOf('\n    entities:'));
  const entitiesText = storageBlock.slice(0, storageBlock.indexOf('\n  runtime:'));

  it('declares exactly the four proposed entities, version + payload, no indexes', () => {
    const names = [...entitiesText.matchAll(/- name: (\S+)/g)].map((m) => m[1]);
    expect(names).toEqual([GOVERNANCE_ENTITY, HISTORY_ENTITY, CRISIS_ENTITY, 'remediation-item']);
    for (const name of names) {
      // Entity names: 3-60 chars of a-z 0-9 : - _ . (limits-kvs-ce).
      expect(name).toMatch(/^[a-z0-9:\-_.]{3,60}$/);
    }
    const attributes = [...entitiesText.matchAll(/^ {10}(\w+):\n {12}type: (\w+)$/gm)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(attributes).toEqual(
      Array.from({ length: 4 }, () => ['version:integer', 'payload:string']).flat(),
    );
    expect(entitiesText).not.toMatch(/^\s+indexes:/m);
  });

  it('keeps the four current scopes plus storage:app, and Confluence optional', () => {
    const scopes = [...manifest.matchAll(/^ {4}- ([a-z:-]+)$/gm)].map((m) => m[1]);
    expect(scopes).toEqual([
      'read:jira-work',
      'read:jira-user',
      'search:confluence',
      'read:page:confluence',
      'storage:app',
    ]);
    expect(manifest).toMatch(/confluence:\n\s+required: false/);
    expect(manifest).toMatch(/jira:\n\s+required: true/);
  });

  it('every governance, cache and history key passes the adapter key rules', () => {
    // Realistic shapes: installContext ARI and an Atlassian accountId.
    const uuid = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
    const user = { installation: `ari:cloud:jira::site/${uuid}`, accountId: `712020:${uuid}` };
    const longId = 'x'.repeat(MAX_ID_LENGTH);
    const keys = [
      SETTINGS_KEY,
      ledgerKey('2026-11'),
      CACHE_INDEX_KEY,
      cacheEntryKey(hashKey('anything')),
      indexKey(user),
      runKey(user, longId),
      retestKey(user, `${uuid}:${uuid}`),
      'probe:00000000-0000-4000-8000-000000000000',
    ];
    for (const key of keys) {
      expect(() => validateKey(key)).not.toThrow();
      expect(key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    }
    // Namespaces do not overlap.
    expect(new Set(keys.map((k) => k.split(':')[0])).size).toBe(4);
  });

  it('pathological ids are refused before any storage call (fail closed)', () => {
    // 128 escaped characters per segment would exceed 500; the key builder throws.
    const worst = ':'.repeat(MAX_ID_LENGTH);
    expect(() => indexKey({ installation: worst, accountId: worst })).toThrow();
  });

  it('history limits agree with the adapter limits', () => {
    expect(FORGE_MAX_VALUE_BYTES).toBe(MAX_RECORD_BYTES);
    expect(MAX_VALUE_BYTES).toBeLessThan(MAX_RECORD_BYTES);
    expect(HISTORY_MAX_KEY_LENGTH).toBe(MAX_KEY_LENGTH);
    expect(HISTORY_KEY_PATTERN.source).toBe('^(?!\\s+$)[a-zA-Z0-9:._\\s-#]+$');
  });
});
