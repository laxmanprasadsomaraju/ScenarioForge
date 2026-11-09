/**
 * Usage governance for anything that may consume Rovo credits: agent actions,
 * MCP tools and enriched Teamwork Graph calls. Pure: storage, clock and id
 * generation are injected; no Forge imports. Policy and wiring:
 * docs/AI_USAGE_GOVERNANCE.md.
 *
 * Principles:
 * - Opt-in per installation. Without a stored settings record that says
 *   `aiEnabled: true`, every request is DISABLED. No org allowance is assumed.
 * - Fail closed. If the store throws or stays contended, the answer is
 *   UNAVAILABLE, never "allow".
 * - Units are app-side estimates of Rovo credits, not Atlassian's meter.
 */

import type { IsoDateTime } from '../domain/types';
import type { AgentActionKey } from './contracts';
import type { StorageAdapter, Versioned } from './storage';

export type Validated<T> = { ok: true; value: T } | { ok: false; message: string };

/** Everything the governor meters: agent/MCP actions plus enriched graph calls. */
export type GovernedOperation = AgentActionKey | 'teamwork-graph-enriched';

export const GOVERNED_OPERATIONS: readonly GovernedOperation[] = [
  'find-recovery-risks',
  'get-service-readiness',
  'prepare-rehearsal',
  'explain-outcome',
  'propose-remediation',
  'list-open-recovery-gaps',
  'teamwork-graph-enriched',
];

export interface BudgetPolicy {
  /** Code-level kill switch. `false` denies everything without touching storage. */
  enabled: boolean;
  /** Installation-wide units per UTC calendar month (committed + reserved). */
  monthlyUnitCap: number;
  /** Units per user per UTC day (committed + reserved). */
  perUserDailyCap: number;
  /** Estimated units charged per call, before the actual is known. */
  costs: Record<GovernedOperation, number>;
  /** Token bucket per (user, operation). */
  rateLimit: { capacity: number; refillPerMinute: number };
  /** Reservations not settled within this window are charged at their estimate. */
  reservationTtlSeconds: number;
}

/**
 * Estimates from "How Rovo credits work"
 * (https://support.atlassian.com/rovo/docs/rovo-usage-limits/, read 2026-11-09):
 * basic chat and basic agents are 10 credits per billable event; "vast
 * majority of enriched TWG API and tool calls are 1 to 10 Rovo credits per
 * call". We charge the upper bound. The page does not say whether a Forge
 * action invocation itself is billed, so each action is costed as one agent
 * event.
 */
export const DEFAULT_COSTS: Record<GovernedOperation, number> = {
  'find-recovery-risks': 10,
  'get-service-readiness': 10,
  'prepare-rehearsal': 10,
  'explain-outcome': 10,
  'propose-remediation': 10,
  'list-open-recovery-gaps': 10,
  'teamwork-graph-enriched': 10,
};

/** Conservative defaults; rationale in docs/AI_USAGE_GOVERNANCE.md. */
export const DEFAULT_POLICY: BudgetPolicy = {
  enabled: true,
  monthlyUnitCap: 500,
  perUserDailyCap: 50,
  costs: DEFAULT_COSTS,
  rateLimit: { capacity: 3, refillPerMinute: 1 },
  reservationTtlSeconds: 300,
};

/**
 * Admin settings stored per installation. Caps here can only lower the code
 * policy; raising a cap is a code change.
 */
export interface GovernanceSettings {
  aiEnabled: boolean;
  monthlyUnitCap?: number;
  perUserDailyCap?: number;
}

export const SETTINGS_KEY = 'ai-governance:settings';
export const ledgerKey = (period: string): string => `ai-governance:ledger:${period}`;

export interface ReserveRequest {
  operation: GovernedOperation;
  /** From the invocation context, never from action inputs. */
  accountId: string;
}

export type DenyReason =
  'BUDGET_EXHAUSTED' | 'RATE_LIMITED' | 'DISABLED' | 'INVALID' | 'UNAVAILABLE';

export type ReserveResult =
  | { ok: true; reservationId: string; units: number }
  | {
      ok: false;
      reason: DenyReason;
      message: string;
      retryAfterSeconds?: number;
      /** For BUDGET_EXHAUSTED: which cap was hit. */
      scope?: 'installation' | 'user';
    };

export type SettleResult =
  | { ok: true; chargedUnits: number }
  | { ok: false; reason: 'UNKNOWN_RESERVATION' | 'INVALID' | 'UNAVAILABLE'; message: string };

/**
 * How a governed call ended. `failed-unknown` means the call may have reached
 * Atlassian (timeout, thrown error after sending); it is charged at the
 * estimate and the action must report NOT_ASSESSED, never a pass.
 */
export type CallOutcome =
  { kind: 'succeeded'; actualUnits?: number } | { kind: 'not-called' } | { kind: 'failed-unknown' };

export interface UsageSnapshot {
  period: string;
  aiEnabled: boolean;
  monthlyUnitCap: number;
  perUserDailyCap: number;
  committedUnits: number;
  /** Portion of `committedUnits` charged from reservations that were never settled. */
  expiredUnits: number;
  reservedUnits: number;
  remainingUnits: number;
  resetsAt: IsoDateTime;
  /** Today's heaviest users, highest first, at most 10. */
  topUsersToday: { accountId: string; units: number }[];
}

interface Reservation {
  units: number;
  accountId: string;
  operation: GovernedOperation;
  day: string;
  createdAtMs: number;
}

export interface LedgerRecord {
  period: string;
  committedUnits: number;
  expiredUnits: number;
  reservations: Record<string, Reservation>;
  /** Committed units per user for `day` only; older days are dropped. */
  userDaily: { day: string; units: Record<string, number> };
  buckets: Record<string, { tokens: number; updatedAtMs: number }>;
}

export interface GovernorDeps {
  storage: StorageAdapter;
  now: () => Date;
  policy?: BudgetPolicy;
  newId?: () => string;
  /** Optimistic-write attempts before giving up with UNAVAILABLE. */
  maxAttempts?: number;
}

const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const RESERVATION_ID = /^(\d{4}-\d{2})\.([A-Za-z0-9-]{1,64})$/;

// Calendar helpers (UTC) ----------------------------------------------------

export function periodOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function nextDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

function secondsUntil(target: Date, now: Date): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

// Validation ----------------------------------------------------------------

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function validatePolicy(policy: BudgetPolicy): Validated<BudgetPolicy> {
  if (!isCount(policy.monthlyUnitCap) || !isCount(policy.perUserDailyCap)) {
    return { ok: false, message: 'Caps must be non-negative integers.' };
  }
  for (const op of GOVERNED_OPERATIONS) {
    const cost = policy.costs[op];
    if (!isCount(cost) || cost === 0) {
      return { ok: false, message: `Cost for ${op} must be a positive integer.` };
    }
  }
  const { capacity, refillPerMinute } = policy.rateLimit;
  if (!isCount(capacity) || capacity < 1 || !(refillPerMinute > 0)) {
    return { ok: false, message: 'Rate limit needs capacity >= 1 and a positive refill rate.' };
  }
  if (!isCount(policy.reservationTtlSeconds) || policy.reservationTtlSeconds < 1) {
    return { ok: false, message: 'reservationTtlSeconds must be a positive integer.' };
  }
  return { ok: true, value: policy };
}

/** Stored settings are untrusted; anything malformed disables AI (fail closed). */
export function parseSettings(raw: unknown): Validated<GovernanceSettings> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'Settings must be an object.' };
  }
  const { aiEnabled, monthlyUnitCap, perUserDailyCap } = raw as Record<string, unknown>;
  if (typeof aiEnabled !== 'boolean') {
    return { ok: false, message: 'aiEnabled must be a boolean.' };
  }
  if (monthlyUnitCap !== undefined && !isCount(monthlyUnitCap)) {
    return { ok: false, message: 'monthlyUnitCap must be a non-negative integer.' };
  }
  if (perUserDailyCap !== undefined && !isCount(perUserDailyCap)) {
    return { ok: false, message: 'perUserDailyCap must be a non-negative integer.' };
  }
  return { ok: true, value: { aiEnabled, monthlyUnitCap, perUserDailyCap } };
}

function parseReserveRequest(request: unknown): Validated<ReserveRequest> {
  if (typeof request !== 'object' || request === null) {
    return { ok: false, message: 'Request must be an object.' };
  }
  const { operation, accountId } = request as Record<string, unknown>;
  if (
    typeof operation !== 'string' ||
    !(GOVERNED_OPERATIONS as readonly string[]).includes(operation)
  ) {
    return { ok: false, message: 'Unknown governed operation.' };
  }
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) {
    return { ok: false, message: 'A valid accountId from the invocation context is required.' };
  }
  return { ok: true, value: { operation: operation as GovernedOperation, accountId } };
}

// Pure ledger operations ----------------------------------------------------

export function emptyLedger(period: string, day: string): LedgerRecord {
  return {
    period,
    committedUnits: 0,
    expiredUnits: 0,
    reservations: {},
    userDaily: { day, units: {} },
    buckets: {},
  };
}

function addUserUnits(ledger: LedgerRecord, accountId: string, day: string, units: number): void {
  if (ledger.userDaily.day === day) {
    ledger.userDaily.units[accountId] = (ledger.userDaily.units[accountId] ?? 0) + units;
  }
}

function refill(
  bucket: { tokens: number; updatedAtMs: number } | undefined,
  nowMs: number,
  rate: BudgetPolicy['rateLimit'],
): number {
  if (!bucket) return rate.capacity;
  const elapsedMinutes = Math.max(0, nowMs - bucket.updatedAtMs) / 60_000;
  return Math.min(rate.capacity, bucket.tokens + elapsedMinutes * rate.refillPerMinute);
}

/**
 * Rolls the user-day forward, charges expired reservations at their estimate
 * (we cannot know whether the call ran) and drops refilled buckets.
 */
function normalize(ledger: LedgerRecord, now: Date, policy: BudgetPolicy): LedgerRecord {
  const next = structuredClone(ledger);
  const nowMs = now.getTime();
  const today = dayOf(now);
  if (next.userDaily.day !== today) {
    next.userDaily = { day: today, units: {} };
  }
  for (const [id, r] of Object.entries(next.reservations)) {
    if (nowMs - r.createdAtMs >= policy.reservationTtlSeconds * 1000) {
      next.committedUnits += r.units;
      next.expiredUnits += r.units;
      addUserUnits(next, r.accountId, r.day, r.units);
      delete next.reservations[id];
    }
  }
  for (const [key, bucket] of Object.entries(next.buckets)) {
    if (refill(bucket, nowMs, policy.rateLimit) >= policy.rateLimit.capacity) {
      delete next.buckets[key];
    }
  }
  return next;
}

function reservedUnits(ledger: LedgerRecord, accountId?: string, day?: string): number {
  return Object.values(ledger.reservations)
    .filter(
      (r) => (accountId === undefined || r.accountId === accountId) && (!day || r.day === day),
    )
    .reduce((sum, r) => sum + r.units, 0);
}

const bucketKey = (accountId: string, operation: GovernedOperation) => `${accountId}#${operation}`;

// Governor ------------------------------------------------------------------

type Step<R> = { next?: LedgerRecord; result: R };

export class UsageGovernor {
  private readonly storage: StorageAdapter;
  private readonly now: () => Date;
  private readonly policy: BudgetPolicy;
  private readonly newId: () => string;
  private readonly maxAttempts: number;

  constructor(deps: GovernorDeps) {
    const checked = validatePolicy(deps.policy ?? DEFAULT_POLICY);
    if (!checked.ok) throw new Error(`Invalid budget policy: ${checked.message}`);
    this.policy = checked.value;
    this.storage = deps.storage;
    this.now = deps.now;
    this.newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
    this.maxAttempts = deps.maxAttempts ?? 3;
  }

  /** Reserves the estimated cost of one call, or says why not. Never throws. */
  async checkAndReserve(request: ReserveRequest): Promise<ReserveResult> {
    const parsed = parseReserveRequest(request);
    if (!parsed.ok) return { ok: false, reason: 'INVALID', message: parsed.message };
    if (!this.policy.enabled) {
      return { ok: false, reason: 'DISABLED', message: 'AI features are switched off.' };
    }
    const { operation, accountId } = parsed.value;

    const limits = await this.loadLimits();
    if (limits === 'unavailable') return unavailable();
    if (!limits.aiEnabled) {
      return {
        ok: false,
        reason: 'DISABLED',
        message: 'AI features are not enabled for this site. An admin can enable them in Settings.',
      };
    }

    const now = this.now();
    const period = periodOf(now);
    const today = dayOf(now);
    const units = this.policy.costs[operation];
    const reservationId = `${period}.${this.newId()}`;
    if (!RESERVATION_ID.test(reservationId)) {
      return { ok: false, reason: 'INVALID', message: 'Generated reservation id is malformed.' };
    }

    return this.mutate<ReserveResult>(
      period,
      today,
      (ledger) => {
        const inFlight = reservedUnits(ledger);
        if (ledger.committedUnits + inFlight + units > limits.monthlyUnitCap) {
          return {
            result: {
              ok: false,
              reason: 'BUDGET_EXHAUSTED',
              scope: 'installation',
              message: 'This site has used its AI allowance for the month.',
              retryAfterSeconds: secondsUntil(nextMonthStart(now), now),
            },
          };
        }
        const userToday =
          (ledger.userDaily.units[accountId] ?? 0) + reservedUnits(ledger, accountId, today);
        if (userToday + units > limits.perUserDailyCap) {
          return {
            result: {
              ok: false,
              reason: 'BUDGET_EXHAUSTED',
              scope: 'user',
              message: 'You have used your AI allowance for today.',
              retryAfterSeconds: secondsUntil(nextDayStart(now), now),
            },
          };
        }
        const key = bucketKey(accountId, operation);
        const tokens = refill(ledger.buckets[key], now.getTime(), this.policy.rateLimit);
        if (tokens < 1) {
          const perSecond = this.policy.rateLimit.refillPerMinute / 60;
          return {
            result: {
              ok: false,
              reason: 'RATE_LIMITED',
              message: 'Too many requests. Try again shortly.',
              retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / perSecond)),
            },
          };
        }
        ledger.buckets[key] = { tokens: tokens - 1, updatedAtMs: now.getTime() };
        ledger.reservations[reservationId] = {
          units,
          accountId,
          operation,
          day: today,
          createdAtMs: now.getTime(),
        };
        return { next: ledger, result: { ok: true, reservationId, units } };
      },
      unavailable,
    );
  }

  /** Charges `actualUnits` (rounded up) against the reservation's period. */
  async commit(reservationId: string, actualUnits: number): Promise<SettleResult> {
    if (typeof actualUnits !== 'number' || !Number.isFinite(actualUnits) || actualUnits < 0) {
      return {
        ok: false,
        reason: 'INVALID',
        message: 'actualUnits must be a non-negative number.',
      };
    }
    return this.settleReservation(reservationId, () => Math.ceil(actualUnits));
  }

  /** Frees a reservation for a call that was never made; nothing is charged. */
  async release(reservationId: string): Promise<SettleResult> {
    return this.settleReservation(reservationId, () => 0);
  }

  /** Commits or releases according to how the call ended. */
  async settle(reservationId: string, outcome: CallOutcome): Promise<SettleResult> {
    switch (outcome.kind) {
      case 'not-called':
        return this.release(reservationId);
      case 'failed-unknown':
        return this.settleReservation(reservationId, (r) => r.units);
      case 'succeeded':
        return outcome.actualUnits === undefined
          ? this.settleReservation(reservationId, (r) => r.units)
          : this.commit(reservationId, outcome.actualUnits);
    }
  }

  /** Read-only view for the admin Settings panel. */
  async getUsage(): Promise<
    { ok: true; usage: UsageSnapshot } | { ok: false; reason: 'UNAVAILABLE' }
  > {
    const limits = await this.loadLimits();
    if (limits === 'unavailable') return { ok: false, reason: 'UNAVAILABLE' };
    const now = this.now();
    const period = periodOf(now);
    let stored: Versioned<LedgerRecord> | undefined;
    try {
      stored = await this.storage.get<LedgerRecord>(ledgerKey(period));
    } catch {
      return { ok: false, reason: 'UNAVAILABLE' };
    }
    const ledger = normalize(stored?.value ?? emptyLedger(period, dayOf(now)), now, this.policy);
    const reserved = reservedUnits(ledger);
    return {
      ok: true,
      usage: {
        period,
        aiEnabled: this.policy.enabled && limits.aiEnabled,
        monthlyUnitCap: limits.monthlyUnitCap,
        perUserDailyCap: limits.perUserDailyCap,
        committedUnits: ledger.committedUnits,
        expiredUnits: ledger.expiredUnits,
        reservedUnits: reserved,
        remainingUnits: Math.max(0, limits.monthlyUnitCap - ledger.committedUnits - reserved),
        resetsAt: nextMonthStart(now).toISOString(),
        topUsersToday: Object.entries(ledger.userDaily.units)
          .map(([accountId, units]) => ({ accountId, units }))
          .sort((a, b) => b.units - a.units || a.accountId.localeCompare(b.accountId))
          .slice(0, 10),
      },
    };
  }

  // internals ---------------------------------------------------------------

  /** Effective caps: stored settings may only lower the code policy. */
  private async loadLimits(): Promise<
    { aiEnabled: boolean; monthlyUnitCap: number; perUserDailyCap: number } | 'unavailable'
  > {
    let stored: Versioned<unknown> | undefined;
    try {
      stored = await this.storage.get<unknown>(SETTINGS_KEY);
    } catch {
      return 'unavailable';
    }
    const settings = stored ? parseSettings(stored.value) : undefined;
    const valid = settings?.ok ? settings.value : undefined;
    return {
      aiEnabled: valid?.aiEnabled === true,
      monthlyUnitCap: Math.min(
        this.policy.monthlyUnitCap,
        valid?.monthlyUnitCap ?? this.policy.monthlyUnitCap,
      ),
      perUserDailyCap: Math.min(
        this.policy.perUserDailyCap,
        valid?.perUserDailyCap ?? this.policy.perUserDailyCap,
      ),
    };
  }

  private async settleReservation(
    reservationId: string,
    charge: (r: Reservation) => number,
  ): Promise<SettleResult> {
    const match = typeof reservationId === 'string' ? RESERVATION_ID.exec(reservationId) : null;
    if (!match?.[1]) {
      return { ok: false, reason: 'INVALID', message: 'Malformed reservation id.' };
    }
    const period = match[1];
    const now = this.now();
    return this.mutate<SettleResult>(
      period,
      dayOf(now),
      (ledger) => {
        const r = ledger.reservations[reservationId];
        if (!r) {
          // Unknown, already settled, or expired (and charged at its estimate).
          return {
            result: {
              ok: false,
              reason: 'UNKNOWN_RESERVATION',
              message: 'Reservation not found; it may have expired and been charged.',
            },
          };
        }
        const units = charge(r);
        delete ledger.reservations[reservationId];
        ledger.committedUnits += units;
        addUserUnits(ledger, r.accountId, r.day, units);
        return { next: ledger, result: { ok: true, chargedUnits: units } };
      },
      (message) => ({ ok: false, reason: 'UNAVAILABLE', message }),
      { createIfMissing: false },
    );
  }

  /**
   * Read-modify-write with optimistic versioning. Retries on CONFLICT; any
   * throw, or exhausting attempts, is UNAVAILABLE (fail closed).
   */
  private async mutate<R>(
    period: string,
    today: string,
    step: (ledger: LedgerRecord) => Step<R>,
    fail: (message: string) => R,
    options: { createIfMissing: boolean } = { createIfMissing: true },
  ): Promise<R> {
    const key = ledgerKey(period);
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const stored = await this.storage.get<LedgerRecord>(key);
        if (!stored && !options.createIfMissing) {
          return step(emptyLedger(period, today)).result;
        }
        const base = stored?.value ?? emptyLedger(period, today);
        const { next, result } = step(normalize(base, this.now(), this.policy));
        if (!next) return result;
        const write = await this.storage.set(key, next, stored?.version ?? null);
        if (write.ok) return result;
      } catch {
        return fail(UNAVAILABLE_MESSAGE);
      }
    }
    return fail('Usage store is busy. Try again shortly.');
  }
}

const UNAVAILABLE_MESSAGE = 'Usage limits could not be checked, so the request was not sent.';

function unavailable(message = UNAVAILABLE_MESSAGE): ReserveResult {
  return { ok: false, reason: 'UNAVAILABLE', message };
}
