import type { BudgetPolicy } from '../../shared/agents/budget';
import { DEFAULT_POLICY, UsageGovernor } from '../../shared/agents/budget';
import type { CacheableResult } from '../../shared/agents/cache';
import { ResponseCache } from '../../shared/agents/cache';
import type { StorageAdapter } from '../../shared/agents/storage';
import { HistoryStore } from '../../shared/history';
import type { GovernanceKvsClient } from '../ai/forgeStorage';
import {
  ForgeEntityStorage,
  GOVERNANCE_ENTITY,
  HISTORY_ENTITY,
  forgeKvsClient,
} from '../ai/forgeStorage';

/**
 * Storage wiring for the `rovo-test` build ONLY (branch `rovo-test/build`,
 * docs/M6_ROVO_TEST_RUNBOOK.md). Every factory returns `null` unless the
 * Forge environment variable `SF_ROVO_TEST_STORAGE` is exactly `enabled`, so
 * a build that reaches any other environment without that variable behaves as
 * if storage did not exist (callers already treat `null` as "not available").
 *
 * Forge variables are per environment and are read from `process.env` at
 * runtime (https://developer.atlassian.com/platform/forge/cli-reference/variables-set/).
 */

/** Environment variable that switches the factories on. */
export const ROVO_TEST_STORAGE_FLAG = 'SF_ROVO_TEST_STORAGE';
/** The only value that switches them on. Anything else (or absent) means off. */
export const ROVO_TEST_STORAGE_FLAG_VALUE = 'enabled';

/** Environment variable that raises the per-user daily cap on `rovo-test`. */
export const USER_DAILY_CAP_VARIABLE = 'SF_ROVO_TEST_USER_DAILY_CAP';
/** Code default, and the lowest accepted value (DEFAULT_POLICY.perUserDailyCap). */
export const PER_USER_DAILY_CAP_DEFAULT = 50;
/** Reviewed ceiling: the variable can never raise the cap above this. */
export const PER_USER_DAILY_CAP_CEILING = 300;

export type PlatformEnv = Readonly<Record<string, string | undefined>>;
export type KvsClientFactory = (entityName: string) => GovernanceKvsClient;

export interface PlatformOptions {
  /** Defaults to `process.env`. */
  env?: PlatformEnv;
  /** Defaults to the real `@forge/kvs` client. Tests pass a fake. */
  clientFor?: KvsClientFactory;
  now?: () => Date;
}

const envOf = (options?: PlatformOptions): PlatformEnv => options?.env ?? process.env;

export function rovoTestStorageEnabled(env: PlatformEnv = process.env): boolean {
  return env[ROVO_TEST_STORAGE_FLAG] === ROVO_TEST_STORAGE_FLAG_VALUE;
}

/**
 * `SF_ROVO_TEST_USER_DAILY_CAP` as a plain decimal integer in
 * [PER_USER_DAILY_CAP_DEFAULT, PER_USER_DAILY_CAP_CEILING]; anything else,
 * including absent, gives the code default. A misconfiguration can therefore
 * never exceed the reviewed ceiling.
 */
export function perUserDailyCap(env: PlatformEnv = process.env): number {
  const raw = env[USER_DAILY_CAP_VARIABLE];
  if (typeof raw !== 'string' || !/^\d{1,4}$/.test(raw.trim())) return PER_USER_DAILY_CAP_DEFAULT;
  const value = Number(raw.trim());
  return value >= PER_USER_DAILY_CAP_DEFAULT && value <= PER_USER_DAILY_CAP_CEILING
    ? value
    : PER_USER_DAILY_CAP_DEFAULT;
}

/** DEFAULT_POLICY with the clamped per-user cap. Everything else is code default. */
export function governancePolicy(env: PlatformEnv = process.env): BudgetPolicy {
  return { ...DEFAULT_POLICY, perUserDailyCap: perUserDailyCap(env) };
}

function entityStorage(entityName: string, options?: PlatformOptions): StorageAdapter | null {
  if (!rovoTestStorageEnabled(envOf(options))) return null;
  const clientFor = options?.clientFor ?? forgeKvsClient;
  return new ForgeEntityStorage(clientFor(entityName));
}

/** Governor ledger, settings and response cache: entity `ai-governance`. */
export function governanceStorage(options?: PlatformOptions): StorageAdapter | null {
  return entityStorage(GOVERNANCE_ENTITY, options);
}

/** Rehearsal history: entity `rehearsal-history`. */
export function historyStorage(options?: PlatformOptions): StorageAdapter | null {
  return entityStorage(HISTORY_ENTITY, options);
}

export function usageGovernor(options?: PlatformOptions): UsageGovernor | null {
  const storage = governanceStorage(options);
  if (!storage) return null;
  return new UsageGovernor({
    storage,
    now: options?.now ?? (() => new Date()),
    policy: governancePolicy(envOf(options)),
  });
}

export function responseCache<T extends CacheableResult>(
  options?: PlatformOptions,
): ResponseCache<T> | null {
  const storage = governanceStorage(options);
  if (!storage) return null;
  return new ResponseCache<T>({ storage, now: options?.now ?? (() => new Date()) });
}

export function historyStore(options?: PlatformOptions): HistoryStore | null {
  const storage = historyStorage(options);
  if (!storage) return null;
  return new HistoryStore({ storage, now: options?.now });
}
