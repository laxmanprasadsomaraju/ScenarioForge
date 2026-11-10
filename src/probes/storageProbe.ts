import { UsageGovernor } from '../../shared/agents/budget';
import type { StorageAdapter } from '../../shared/agents/storage';
import type { GovernanceKvsClient } from '../ai/forgeStorage';
import { ForgeStorageError } from '../ai/forgeStorage';
import type { KvsClientFactory, PlatformEnv } from '../platform/storageFactory';
import { governancePolicy, governanceStorage, historyStorage } from '../platform/storageFactory';

/**
 * TEST-ONLY `storage-probe` action (docs/M6_DEPLOYMENT_READINESS.md §2.5).
 * `rovo-test` build only; removed in the next `rovo-test` deploy.
 *
 * Runs S1–S9 against the real `ai-governance` entity and H1–H3 against the
 * real `rehearsal-history` entity. Writes only keys starting with `probe:`
 * and deletes every one of them before returning, whatever happened. The
 * governor steps never reserve: S6 runs before any opt-in exists and S7 with
 * the kill switch; if S6 unexpectedly reserves, the reservation is released.
 *
 * Returns step results only (step id, pass, short enum-like observation).
 * Logs key names, step ids and error name / code / HTTP status only.
 */

export const PROBE_KEY_PREFIX = 'probe:';
/** Synthetic caller for S6/S7: never a real accountId, never stored when DISABLED. */
export const PROBE_ACCOUNT_ID = 'scenarioforge-probe';

export type ProbeStepId =
  'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'H1' | 'H2' | 'H3';

export interface ProbeStep {
  step: ProbeStepId;
  pass: boolean;
  /** Short description of what happened, e.g. `ok:v1`, `CONFLICT`, `DISABLED`. */
  observed: string;
}

export interface StorageProbeResult {
  probe: 'storage';
  /** `storage-disabled`: the rovo-test flag is not set, nothing was touched. */
  status: 'completed' | 'storage-disabled';
  passed: number;
  total: number;
  /** True only when every step passed and every probe key was deleted. */
  allPassed: boolean;
  cleanup: 'done' | 'failed' | 'not-needed';
  steps: ProbeStep[];
}

export interface StorageProbeDeps {
  env: PlatformEnv;
  /** Real `forgeKvsClient` in Forge; a fake in tests. */
  clientFor: KvsClientFactory;
  now: () => Date;
  newId: () => string;
  log: (line: string) => void;
}

function errorShape(error: unknown): { name: string; code?: string; status?: number } {
  const e = (error ?? {}) as { name?: unknown; code?: unknown; responseDetails?: unknown };
  const details = (e.responseDetails ?? {}) as { status?: unknown };
  return {
    name: typeof e.name === 'string' ? e.name : 'Error',
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(typeof details.status === 'number' ? { status: details.status } : {}),
  };
}

/** Logs the raw error shape of every failed client call (the undocumented condition error). */
function loggingClient(
  inner: GovernanceKvsClient,
  entity: string,
  log: (line: string) => void,
): GovernanceKvsClient {
  const wrap =
    <A extends unknown[], R>(op: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        log(JSON.stringify({ probe: 'storage', entity, op, error: errorShape(error) }));
        throw error;
      }
    };
  return {
    get: wrap('get', (key) => inner.get(key)),
    conditionalSet: wrap('conditionalSet', (key, record, condition) =>
      inner.conditionalSet(key, record, condition),
    ),
    delete: wrap('delete', (key) => inner.delete(key)),
  };
}

/** Counts every storage call, for the kill-switch step. */
class CountingStorage implements StorageAdapter {
  calls = 0;
  constructor(private readonly inner: StorageAdapter) {}
  get<T>(key: string) {
    this.calls += 1;
    return this.inner.get<T>(key);
  }
  set<T>(key: string, value: T, expectedVersion: number | null) {
    this.calls += 1;
    return this.inner.set(key, value, expectedVersion);
  }
  delete(key: string) {
    this.calls += 1;
    return this.inner.delete(key);
  }
}

async function attempt(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (error) {
    return `threw:${errorShape(error).name}`;
  }
}

const writeLabel = (r: { ok: true; version: number } | { ok: false; reason: string }) =>
  r.ok ? `ok:v${r.version}` : r.reason;

const readLabel = (r: { value: unknown; version: number } | undefined) =>
  r === undefined ? 'absent' : `v${r.version}:${JSON.stringify(r.value)}`;

export async function runStorageProbe(deps: StorageProbeDeps): Promise<StorageProbeResult> {
  const clientFor: KvsClientFactory = (entity) =>
    loggingClient(deps.clientFor(entity), entity, deps.log);
  const options = { env: deps.env, clientFor };
  const governance = governanceStorage(options);
  const history = historyStorage(options);
  if (!governance || !history) {
    deps.log(JSON.stringify({ probe: 'storage', status: 'storage-disabled' }));
    return {
      probe: 'storage',
      status: 'storage-disabled',
      passed: 0,
      total: 0,
      allPassed: false,
      cleanup: 'not-needed',
      steps: [],
    };
  }

  const key = `${PROBE_KEY_PREFIX}${deps.newId()}`;
  const historyKey = `${PROBE_KEY_PREFIX}h:${deps.newId()}`;
  const steps: ProbeStep[] = [];
  const record = (step: ProbeStepId, observed: string, expected: string | RegExp) => {
    const pass = typeof expected === 'string' ? observed === expected : expected.test(observed);
    steps.push({ step, pass, observed });
    deps.log(JSON.stringify({ probe: 'storage', step, pass, observed }));
  };
  deps.log(JSON.stringify({ probe: 'storage', keys: [key, historyKey] }));

  let cleanup: StorageProbeResult['cleanup'] = 'done';
  try {
    // S1 missing key reads as absent.
    record('S1', await attempt(async () => readLabel(await governance.get(key))), 'absent');
    // S2 first create-only write (`version notExists`).
    record(
      'S2',
      await attempt(async () => writeLabel(await governance.set(key, { n: 1 }, null))),
      'ok:v1',
    );
    // S3 repeat create-only write must be a CONFLICT, not an overwrite or a throw.
    record(
      'S3',
      await attempt(async () => writeLabel(await governance.set(key, { n: 9 }, null))),
      'CONFLICT',
    );
    // S4 optimistic version check: v1 -> v2 succeeds, a second write at v1 conflicts.
    record(
      'S4',
      await attempt(async () => {
        const first = writeLabel(await governance.set(key, { n: 2 }, 1));
        const stale = writeLabel(await governance.set(key, { n: 3 }, 1));
        return `${first},${stale}`;
      }),
      'ok:v2,CONFLICT',
    );
    // S5 failed writes did not apply.
    record('S5', await attempt(async () => readLabel(await governance.get(key))), 'v2:{"n":2}');
    // S6 governor before opt-in (no settings record): DISABLED, nothing reserved.
    record(
      'S6',
      await attempt(async () => {
        const governor = new UsageGovernor({
          storage: governance,
          now: deps.now,
          policy: governancePolicy(deps.env),
        });
        const result = await governor.checkAndReserve({
          operation: 'find-recovery-risks',
          accountId: PROBE_ACCOUNT_ID,
        });
        if (result.ok) {
          // Opt-in already exists on this installation: undo the reservation.
          await governor.release(result.reservationId);
          return 'RESERVED(released)';
        }
        return result.reason;
      }),
      'DISABLED',
    );
    // S7 kill switch: DISABLED without any storage call.
    record(
      'S7',
      await attempt(async () => {
        const counting = new CountingStorage(governance);
        const governor = new UsageGovernor({
          storage: counting,
          now: deps.now,
          policy: { ...governancePolicy(deps.env), enabled: false },
        });
        const result = await governor.checkAndReserve({
          operation: 'find-recovery-risks',
          accountId: PROBE_ACCOUNT_ID,
        });
        return `${result.ok ? 'RESERVED' : result.reason},calls:${counting.calls}`;
      }),
      'DISABLED,calls:0',
    );
    // S8 invalid key is refused locally (never reaches Forge).
    record(
      'S8',
      await attempt(async () => {
        try {
          await governance.set(`${PROBE_KEY_PREFIX}bad key!`, { n: 1 }, null);
          return 'written';
        } catch (error) {
          return error instanceof ForgeStorageError ? 'threw:ForgeStorageError' : 'threw:other';
        }
      }),
      'threw:ForgeStorageError',
    );
    // S9 delete, then the key reads as absent.
    record(
      'S9',
      await attempt(async () => {
        await governance.delete(key);
        return readLabel(await governance.get(key));
      }),
      'absent',
    );
    // H1–H3 the history entity exists and accepts the same record shape.
    record(
      'H1',
      await attempt(async () => writeLabel(await history.set(historyKey, { n: 1 }, null))),
      'ok:v1',
    );
    record('H2', await attempt(async () => readLabel(await history.get(historyKey))), 'v1:{"n":1}');
    record(
      'H3',
      await attempt(async () => {
        await history.delete(historyKey);
        return readLabel(await history.get(historyKey));
      }),
      'absent',
    );
  } finally {
    // Best-effort cleanup of every key this probe may have written.
    for (const [storage, k] of [
      [governance, key],
      [history, historyKey],
    ] as const) {
      try {
        await storage.delete(k);
        if ((await storage.get(k)) !== undefined) cleanup = 'failed';
      } catch {
        cleanup = 'failed';
      }
    }
    deps.log(JSON.stringify({ probe: 'storage', cleanup }));
  }

  const passed = steps.filter((s) => s.pass).length;
  return {
    probe: 'storage',
    status: 'completed',
    passed,
    total: steps.length,
    allPassed: passed === steps.length && cleanup === 'done',
    cleanup,
    steps,
  };
}
