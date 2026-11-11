import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY } from '../shared/agents/budget';
import { GOVERNANCE_ENTITY, HISTORY_ENTITY } from '../src/ai/forgeStorage';
import { STORAGE_FLAG } from '../src/platform/storageFactory';
import type { StorageProbeDeps } from '../src/probes/storageProbe';
import { PROBE_KEY_PREFIX, runStorageProbe } from '../src/probes/storageProbe';
import type { MyselfResponse } from '../src/probes/whoamiProbe';
import { locateAccountId, runWhoamiProbe } from '../src/probes/whoamiProbe';
import { apiError, fakeStore } from './helpers/fakeKvs';

const ACCOUNT = '712020:aaaabbbb-cccc-dddd-eeee-ffff00001111';

function response(status: number, body: unknown): MyselfResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

function whoamiHarness(result: () => Promise<MyselfResponse>) {
  const logs: string[] = [];
  let calls = 0;
  const deps = {
    requestMyself: () => {
      calls += 1;
      return result();
    },
    log: (line: string) => logs.push(line),
  };
  return { deps, logs, calls: () => calls };
}

describe('whoami-probe', () => {
  it('reports a match when /myself returns the context accountId', async () => {
    const h = whoamiHarness(async () =>
      response(200, { accountId: ACCOUNT, displayName: 'Secret Name', emailAddress: 'x@y' }),
    );
    const result = await runWhoamiProbe(h.deps, {}, { accountId: ACCOUNT, cloudId: 'c' });
    expect(result).toEqual({ accountIdMatch: true, httpStatus: 200 });
    expect(Object.keys(result).sort()).toEqual(['accountIdMatch', 'httpStatus']);
    expect(h.calls()).toBe(1);
    expect(JSON.parse(h.logs[0]!)).toEqual({
      probe: 'whoami',
      contextKeys: ['accountId', 'cloudId'],
      payloadKeys: [],
      payloadContextKeys: [],
      accountIdIn: 'context',
    });
  });

  it('reads payload.context when the second argument has no accountId', async () => {
    const h = whoamiHarness(async () => response(200, { accountId: ACCOUNT }));
    const result = await runWhoamiProbe(h.deps, { context: { accountId: ACCOUNT } }, undefined);
    expect(result).toEqual({ accountIdMatch: true, httpStatus: 200 });
    expect(JSON.parse(h.logs[0]!).accountIdIn).toBe('payload.context');
  });

  it('reports a mismatch as false', async () => {
    const h = whoamiHarness(async () => response(200, { accountId: 'someone-else' }));
    expect(await runWhoamiProbe(h.deps, {}, { accountId: ACCOUNT })).toEqual({
      accountIdMatch: false,
      httpStatus: 200,
    });
  });

  it('reports null when no accountId is in the invocation', async () => {
    const h = whoamiHarness(async () => response(200, { accountId: ACCOUNT }));
    expect(await runWhoamiProbe(h.deps, null, {})).toEqual({
      accountIdMatch: null,
      httpStatus: 200,
    });
    expect(JSON.parse(h.logs[0]!).accountIdIn).toBe('none');
  });

  it.each([401, 403, 404, 500])('returns a non-2xx status %i without a match', async (status) => {
    const h = whoamiHarness(async () => response(status, {}));
    expect(await runWhoamiProbe(h.deps, {}, { accountId: ACCOUNT })).toEqual({
      accountIdMatch: null,
      httpStatus: status,
    });
  });

  it('maps a thrown NEEDS_AUTHENTICATION_ERR to 401 and logs only its name', async () => {
    const error = Object.assign(new Error('no grant for ' + ACCOUNT), {
      name: 'NEEDS_AUTHENTICATION_ERR',
      status: 401,
    });
    const h = whoamiHarness(async () => {
      throw error;
    });
    expect(await runWhoamiProbe(h.deps, {}, { accountId: ACCOUNT })).toEqual({
      accountIdMatch: null,
      httpStatus: 401,
    });
    expect(JSON.parse(h.logs.at(-1)!)).toEqual({
      probe: 'whoami',
      threw: 'NEEDS_AUTHENTICATION_ERR',
      httpStatus: 401,
    });
    expect(h.calls()).toBe(1); // no retry, no other identity
  });

  it('maps any other throw to a null status', async () => {
    const h = whoamiHarness(async () => {
      throw Object.assign(new Error('x'), { name: 'ProxyRequestError' });
    });
    expect(await runWhoamiProbe(h.deps, {}, { accountId: ACCOUNT })).toEqual({
      accountIdMatch: null,
      httpStatus: null,
    });
  });

  it('handles an unparseable body', async () => {
    const h = whoamiHarness(async () => response(200, new SyntaxError('bad json')));
    expect(await runWhoamiProbe(h.deps, {}, { accountId: ACCOUNT })).toEqual({
      accountIdMatch: null,
      httpStatus: 200,
    });
  });

  it('never logs an accountId or Jira field value', async () => {
    const h = whoamiHarness(async () =>
      response(200, { accountId: ACCOUNT, displayName: 'Secret Name', emailAddress: 'x@y' }),
    );
    await runWhoamiProbe(h.deps, { context: { accountId: ACCOUNT } }, { accountId: ACCOUNT });
    const all = h.logs.join('\n');
    expect(all).not.toContain(ACCOUNT);
    expect(all).not.toContain('Secret Name');
    expect(all).not.toContain('x@y');
  });

  it('ignores non-string and empty accountIds', () => {
    expect(locateAccountId({ context: { accountId: 5 } }, { accountId: '' })).toEqual({
      accountId: undefined,
      location: 'none',
    });
  });
});

let seq = 0;
function storageHarness(env: Record<string, string | undefined> = { [STORAGE_FLAG]: 'enabled' }) {
  const store = fakeStore();
  const logs: string[] = [];
  const deps: StorageProbeDeps = {
    env,
    clientFor: store.clientFor,
    now: () => new Date('2026-11-10T12:00:00.000Z'),
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    log: (line) => logs.push(line),
  };
  return { ...store, deps, logs };
}

const observed = (steps: { step: string; observed: string }[]) =>
  Object.fromEntries(steps.map((s) => [s.step, s.observed]));

function allWrittenKeys(entities: Map<string, { ops: string[] }>): string[] {
  return [...entities.values()].flatMap((e) =>
    e.ops.filter((op) => op.startsWith('set ')).map((op) => op.slice(4)),
  );
}

describe('storage-probe', () => {
  it('does nothing when the rovo-test flag is not set', async () => {
    const h = storageHarness({});
    const result = await runStorageProbe(h.deps);
    expect(result).toMatchObject({ status: 'storage-disabled', steps: [], allPassed: false });
    expect(h.entities.size).toBe(0);
  });

  it('passes S1-S9 and H1-H3 on a store that behaves as documented', async () => {
    const h = storageHarness();
    const result = await runStorageProbe(h.deps);
    expect(result.status).toBe('completed');
    expect(observed(result.steps)).toEqual({
      S1: 'absent',
      S2: 'ok:v1',
      S3: 'CONFLICT',
      S4: 'ok:v2,CONFLICT',
      S5: 'v2:{"n":2}',
      S6: 'DISABLED',
      S7: 'DISABLED,calls:0',
      S8: 'threw:ForgeStorageError',
      S9: 'absent',
      H1: 'ok:v1',
      H2: 'v1:{"n":1}',
      H3: 'absent',
    });
    expect(result).toMatchObject({ passed: 12, total: 12, allPassed: true, cleanup: 'done' });
  });

  it('writes only probe: keys, deletes them all, and leaves no governance state', async () => {
    const h = storageHarness();
    await runStorageProbe(h.deps);
    const written = allWrittenKeys(h.entities);
    expect(written.length).toBeGreaterThan(0);
    for (const key of written) expect(key.startsWith(PROBE_KEY_PREFIX)).toBe(true);
    expect(h.entities.get(GOVERNANCE_ENTITY)!.rows.size).toBe(0);
    expect(h.entities.get(HISTORY_ENTITY)!.rows.size).toBe(0);
    expect([...h.entities.keys()].sort()).toEqual([GOVERNANCE_ENTITY, HISTORY_ENTITY]);
  });

  it('returns step results only (no stored values beyond the probe payloads)', async () => {
    const h = storageHarness();
    const result = await runStorageProbe(h.deps);
    expect(Object.keys(result).sort()).toEqual(
      ['allPassed', 'cleanup', 'passed', 'probe', 'status', 'steps', 'total'].sort(),
    );
    for (const step of result.steps)
      expect(Object.keys(step).sort()).toEqual(['observed', 'pass', 'step']);
  });

  it('logs the raw error shape of the create-only conflict (S3)', async () => {
    const h = storageHarness();
    await runStorageProbe(h.deps);
    const errors = h.logs.map((l) => JSON.parse(l)).filter((l) => l.error);
    expect(errors[0]).toEqual({
      probe: 'storage',
      entity: GOVERNANCE_ENTITY,
      op: 'conditionalSet',
      error: { name: 'Error', code: 'SOME_UNDOCUMENTED_CONDITION_CODE', status: 400 },
    });
  });

  it('fails S2/S3 (gate) when create-only is not supported, and still cleans up', async () => {
    const h = storageHarness();
    h.clientFor(GOVERNANCE_ENTITY).rejectCreateOnly = true;
    const result = await runStorageProbe(h.deps);
    const o = observed(result.steps);
    expect(o.S2).toBe('threw:Error');
    expect(result.steps.find((s) => s.step === 'S2')!.pass).toBe(false);
    expect(result.allPassed).toBe(false);
    expect(h.entities.get(GOVERNANCE_ENTITY)!.rows.size).toBe(0);
  });

  it('fails S3 when the real condition error is not a 400/409/412', async () => {
    const h = storageHarness();
    let sets = 0;
    h.clientFor(GOVERNANCE_ENTITY).failOn = (op) =>
      op === 'set' && ++sets === 2 ? apiError(500, 'INTERNAL') : undefined;
    const result = await runStorageProbe(h.deps);
    expect(observed(result.steps).S3).toBe('threw:Error');
    expect(result.allPassed).toBe(false);
  });

  it('S6 releases a reservation if the site has already opted in', async () => {
    const h = storageHarness();
    const governance = h.clientFor(GOVERNANCE_ENTITY);
    governance.rows.set(SETTINGS_KEY, { version: 1, payload: '{"aiEnabled":true}' });
    // Phase 2: the opt-in also needs SF_AI=enabled.
    const result = await runStorageProbe({
      ...h.deps,
      env: { ...h.deps.env, SF_AI: 'enabled' },
    });
    expect(observed(result.steps).S6).toBe('RESERVED(released)');
    expect(result.allPassed).toBe(false);
    const ledger = [...governance.rows.entries()].find(([k]) =>
      k.startsWith('ai-governance:ledger'),
    );
    const value = JSON.parse(ledger![1].payload);
    expect(value.reservations).toEqual({});
    expect(value.committedUnits).toBe(0);
  });

  it('reports cleanup failure when deletes fail', async () => {
    const h = storageHarness();
    h.clientFor(HISTORY_ENTITY).failOn = (op) => (op === 'delete' ? new Error('down') : undefined);
    const result = await runStorageProbe(h.deps);
    expect(result.cleanup).toBe('failed');
    expect(result.allPassed).toBe(false);
  });

  it('logs no accountId-like values, only probe keys and enums', async () => {
    const h = storageHarness();
    await runStorageProbe(h.deps);
    for (const line of h.logs) {
      const parsed = JSON.parse(line);
      expect(parsed.probe).toBe('storage');
      expect(line).not.toMatch(/712020/);
    }
  });
});

describe('no app-identity fallback', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
    });
  }

  it.each(['src/agents', 'src/platform', 'src/probes', 'src/ai'])('%s never uses asApp', (dir) => {
    const files = sources(join(__dirname, '..', dir));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\basApp\s*\(/);
      expect(text, file).not.toMatch(/import[^;]*\basApp\b/);
      expect(text, file).not.toMatch(/\.\s*asApp\b/);
    }
  });

  it('the probe entry point calls Jira with asUser', () => {
    const text = readFileSync(join(__dirname, '..', 'src/probes/forge.ts'), 'utf8');
    expect(text).toMatch(/api\.asUser\(\)\.requestJira\(route`\/rest\/api\/3\/myself`\)/);
  });
});
