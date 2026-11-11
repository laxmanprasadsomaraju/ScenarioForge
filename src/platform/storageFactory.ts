import type { BudgetPolicy } from '../../shared/agents/budget';
import { DEFAULT_POLICY, SETTINGS_KEY, UsageGovernor } from '../../shared/agents/budget';
import type { CacheableResult } from '../../shared/agents/cache';
import { ResponseCache } from '../../shared/agents/cache';
import type { StorageAdapter, Versioned } from '../../shared/agents/storage';
import { HistoryStore } from '../../shared/history';
import type { GovernanceKvsClient } from '../ai/forgeStorage';
import {
  ForgeEntityStorage,
  GOVERNANCE_ENTITY,
  CRISIS_ENTITY,
  HISTORY_ENTITY,
  forgeKvsClient,
} from '../ai/forgeStorage';

/**
 * Storage wiring (environment-neutral flags, docs/proposals/M10_RELEASE_REVIEW.md
 * §Flags). Every factory returns `null` unless the Forge environment variable
 * `SF_STORAGE` is exactly `enabled`, so an environment without that variable
 * behaves as if storage did not exist (callers already treat `null` as "not
 * available"). Crisis rooms additionally need `SF_CRISIS=enabled`.
 *
 * Forge variables are per environment and are read from `process.env` at
 * runtime (https://developer.atlassian.com/platform/forge/cli-reference/variables-set/).
 */

/** Environment variable that switches the factories on. */
export const STORAGE_FLAG = 'SF_STORAGE';
/** The only value that switches them on. Anything else (or absent) means off. */
export const STORAGE_FLAG_VALUE = 'enabled';

/**
 * Site AI opt-in. Admin-only: Forge variables are
 * set by the app developer with `forge variables set`, never by site users.
 * Absent or any value other than exactly `enabled` means AI is OFF: the
 * governor gets `enabled: false` and denies every call as DISABLED without
 * reading or writing storage, so nothing is spent.
 */
export const AI_FLAG = 'SF_AI';
export const AI_FLAG_VALUE = 'enabled';

export function siteAiEnabled(env: PlatformEnv = process.env): boolean {
  return env[AI_FLAG] === AI_FLAG_VALUE;
}

/** Environment variable that raises the per-user daily cap. */
export const USER_DAILY_CAP_VARIABLE = 'SF_USER_DAILY_CAP';
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

export function siteStorageEnabled(env: PlatformEnv = process.env): boolean {
  return env[STORAGE_FLAG] === STORAGE_FLAG_VALUE;
}

/**
 * `SF_USER_DAILY_CAP` as a plain decimal integer in
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
  return {
    ...DEFAULT_POLICY,
    // Code kill switch AND site opt-in: both must allow.
    enabled: DEFAULT_POLICY.enabled && siteAiEnabled(env),
    perUserDailyCap: perUserDailyCap(env),
  };
}

/**
 * Makes the `SF_AI` opt-in visible to the governor as the settings
 * record `aiEnabled: true`, but only when no settings record is stored. A
 * stored record always wins, so a stored `aiEnabled: false` still switches AI
 * off and a malformed record still fails closed. Caps in a stored record can
 * only lower the code policy (UsageGovernor.loadLimits). Writes pass through.
 */
export function withSiteOptIn(storage: StorageAdapter): StorageAdapter {
  return {
    async get<T>(key: string): Promise<Versioned<T> | undefined> {
      const stored = await storage.get<T>(key);
      if (key !== SETTINGS_KEY || stored !== undefined) return stored;
      return { value: { aiEnabled: true } as T, version: 0 };
    },
    set: (key, value, expectedVersion) => storage.set(key, value, expectedVersion),
    delete: (key) => storage.delete(key),
  };
}

function entityStorage(entityName: string, options?: PlatformOptions): StorageAdapter | null {
  if (!siteStorageEnabled(envOf(options))) return null;
  const clientFor = options?.clientFor ?? forgeKvsClient;
  return new ForgeEntityStorage(clientFor(entityName));
}

/** Governor ledger, settings and response cache: entity `ai-governance`. */
export function governanceStorage(options?: PlatformOptions): StorageAdapter | null {
  return entityStorage(GOVERNANCE_ENTITY, options);
}

/** Crisis Room (M7) opt-in, on top of `SF_STORAGE`. Exactly `enabled`, else off. */
export const CRISIS_FLAG = 'SF_CRISIS';
export const CRISIS_FLAG_VALUE = 'enabled';

export function crisisRoomsEnabled(env: PlatformEnv = process.env): boolean {
  return env[CRISIS_FLAG] === CRISIS_FLAG_VALUE;
}

/** Crisis Room event logs: entity `crisis-room`. Needs SF_STORAGE and SF_CRISIS. */
export function crisisStorage(options?: PlatformOptions): StorageAdapter | null {
  if (!crisisRoomsEnabled(envOf(options))) return null;
  return entityStorage(CRISIS_ENTITY, options);
}

/** Rehearsal history: entity `rehearsal-history`. */
export function historyStorage(options?: PlatformOptions): StorageAdapter | null {
  return entityStorage(HISTORY_ENTITY, options);
}

export function usageGovernor(options?: PlatformOptions): UsageGovernor | null {
  const storage = governanceStorage(options);
  if (!storage) return null;
  const env = envOf(options);
  return new UsageGovernor({
    // Without the opt-in the policy is disabled and storage is never touched.
    storage: siteAiEnabled(env) ? withSiteOptIn(storage) : storage,
    now: options?.now ?? (() => new Date()),
    policy: governancePolicy(env),
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

/**
 * M8 write gateway opt-in, on top of `SF_STORAGE`. Exactly `enabled`, else off.
 * Server-side only. Even when set, the manifest has no `write:jira-work`
 * scope, so Jira would refuse every write.
 */
export const REMEDIATION_WRITE_FLAG = 'SF_REMEDIATION_WRITE';

export function remediationWriteEnabled(env: PlatformEnv = process.env): boolean {
  return env[REMEDIATION_WRITE_FLAG] === 'enabled';
}

/**
 * Approval and audit records for remediation creates. They reuse the existing
 * `rehearsal-history` entity under the `remediation-item:` key prefix (no new
 * manifest entity). Needs SF_STORAGE and SF_REMEDIATION_WRITE.
 */
export function remediationStorage(options?: PlatformOptions): StorageAdapter | null {
  if (!remediationWriteEnabled(envOf(options))) return null;
  return entityStorage(HISTORY_ENTITY, options);
}
