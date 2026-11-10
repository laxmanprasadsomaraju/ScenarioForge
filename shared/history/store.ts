import type { StorageAdapter, Versioned, WriteResult } from '../agents/storage';
import type { ExerciseSession, SimulationScenario } from '../domain/types';
import { SimulationError } from '../simulation/engine';
import {
  canonicalJson,
  createAuditRecord,
  replaySession,
  scenarioFingerprint,
  verifyAuditRecord,
} from '../simulation/replay';
import { buildRetest, compareRetest } from '../simulation/retest';
import type { RetestComparison, SessionAuditRecord } from '../simulation/types';
import {
  contentDigest,
  HistoryInputError,
  indexKey,
  MAX_VALUE_BYTES,
  retestKey,
  runKey,
  storedBytes,
} from './keys';
import type {
  GetComparisonResult,
  GetRunResult,
  HistoryIndex,
  HistoryIndexEntry,
  HistoryListItem,
  HistoryUser,
  ListResult,
  PrunedEntry,
  RejectReason,
  RetestRecord,
  RunRecord,
  RunSubmission,
  SaveResult,
  SaveRetestInput,
  TrustedScenario,
  VerificationFailure,
  VerifiedRetest,
  VerifiedRun,
} from './types';

/**
 * Durable rehearsal history over a StorageAdapter (docs/M6_PLAN.md §6).
 *
 * Integrity: the server never stores what the browser claims. saveRun and
 * saveRetest replay the submitted decisions against the trusted scenario and
 * reject any difference in fingerprint, flags or evaluation; the retest
 * scenario and the before/after comparison are computed here, not submitted.
 * Every read re-verifies the stored record (digest, ownership, replay, and
 * for retests the remediation and comparison) and returns TAMPERED or
 * UNVERIFIABLE instead of the data when that fails.
 *
 * Layout per user (keys.ts): one index value listing the user's records, and
 * one value per run or retest holding a full scenario snapshot. The record is
 * written first (create-only), then the index with a version check, so the
 * index never points at a record that was not written.
 *
 * Failure: a storage throw becomes `UNAVAILABLE` (never an empty list); a
 * version conflict on the index is retried up to MAX_WRITE_ATTEMPTS times.
 */

/** Most original runs kept per user; the oldest are pruned first. */
export const MAX_RUNS_PER_USER = 50;
/** Runs older than this are pruned on write and on list. */
export const MAX_AGE_DAYS = 90;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
/** Retests kept per run; more are refused, which keeps the index bounded. */
export const MAX_RETESTS_PER_RUN = 5;
/** Attempts at the index write before reporting CONFLICT. */
export const MAX_WRITE_ATTEMPTS = 3;
/**
 * Version of the simulation semantics (engine, replay, remediation, retest
 * rules) a record was verified under. Bump it when those semantics change:
 * older records then read as UNVERIFIABLE ("recorded under an earlier
 * version") instead of being reported as tampered.
 */
export const ENGINE_VERSION = 1;

export interface HistoryStoreOptions {
  storage: StorageAdapter;
  /** Injected clock; defaults to the system clock. */
  now?: () => Date;
}

/** Internal: the adapter threw. Mapped to `UNAVAILABLE` at the public boundary. */
class StorageUnavailableError extends Error {}

type Rejection = { status: 'REJECTED'; reason: RejectReason; message: string };

const reject = (reason: RejectReason, message: string): Rejection => ({
  status: 'REJECTED',
  reason,
  message,
});

interface CheckedSubmission {
  session: ExerciseSession;
  audit: SessionAuditRecord;
}

interface LoadedRun {
  status: 'OK';
  run: VerifiedRun;
  record: RunRecord;
  session: ExerciseSession;
}

export class HistoryStore {
  private readonly storage: StorageAdapter;
  private readonly now: () => Date;

  constructor(options: HistoryStoreOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Saves a completed run. `trusted` is the scenario the server regenerated
   * or loaded; `submission` is what the browser sent.
   */
  async saveRun(
    user: HistoryUser,
    trusted: TrustedScenario,
    submission: RunSubmission,
  ): Promise<SaveResult> {
    indexKey(user); // invalid user ids are a caller bug: throw
    const checked = checkSubmission(trusted.scenario, submission);
    if ('status' in checked) return checked;
    let key: string;
    try {
      key = runKey(user, submission.sessionId);
    } catch (error) {
      return inputRejection(error);
    }

    const completedAt = this.now().toISOString();
    const { scenario } = trusted;
    const record: RunRecord = {
      kind: 'run',
      schemaVersion: 1,
      engineVersion: ENGINE_VERSION,
      installation: user.installation,
      owner: user.accountId,
      runId: submission.sessionId,
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      scenarioFingerprint: checked.audit.scenarioFingerprint,
      scenario: structuredClone(scenario),
      remediation: trusted.remediation ? structuredClone(trusted.remediation) : null,
      provenance: trusted.provenance ? { ...trusted.provenance } : null,
      audit: checked.audit,
      completedAt,
    };
    const entry: HistoryIndexEntry = {
      id: record.runId,
      kind: 'run',
      completedAt,
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      ...(record.provenance
        ? { changeKey: record.provenance.changeKey, findingId: record.provenance.findingId }
        : {}),
      metCount: checked.audit.evaluation!.metCount,
      totalCount: checked.audit.evaluation!.totalCount,
      digest: contentDigest(record),
    };
    return this.writeRecordAndIndex(user, key, record, entry, (index) =>
      index.entries.some((e) => e.kind === 'run' && e.id === entry.id)
        ? reject('DUPLICATE', `Run ${entry.id} is already saved.`)
        : null,
    );
  }

  /**
   * Saves a retest of a stored run. The original is re-verified; the retest
   * scenario is rebuilt from the stored original with the approved fixes; the
   * comparison is computed here.
   */
  async saveRetest(user: HistoryUser, input: SaveRetestInput): Promise<SaveResult> {
    indexKey(user);
    if (
      !input ||
      typeof input.originalRunId !== 'string' ||
      !Array.isArray(input.remediationIds) ||
      !input.remediationIds.every((id) => typeof id === 'string') ||
      (input.findingId !== undefined && typeof input.findingId !== 'string')
    ) {
      return reject('INVALID_INPUT', 'Retest input is malformed.');
    }
    try {
      const loaded = await this.loadRun(user, input.originalRunId);
      if (loaded.status === 'NOT_FOUND') {
        return reject('ORIGINAL_NOT_FOUND', `Run ${input.originalRunId} is not in your history.`);
      }
      if (loaded.status !== 'OK') {
        return reject('ORIGINAL_NOT_VERIFIED', 'The original run failed verification.');
      }
      const { run, record: original, session: originalSession } = loaded;
      if (!original.remediation) {
        return reject('NO_REMEDIATION_MODEL', 'This rehearsal has no remediation model.');
      }
      if (run.retestIds.length >= MAX_RETESTS_PER_RUN) {
        return reject('RETEST_LIMIT', `A run keeps at most ${MAX_RETESTS_PER_RUN} retests.`);
      }

      let scenario: SimulationScenario;
      try {
        scenario = buildRetest(
          original.scenario,
          originalSession,
          input.remediationIds,
          original.remediation,
        );
      } catch (error) {
        if (error instanceof SimulationError) return reject('INVALID_FIXES', error.message);
        throw error;
      }

      const { submission } = input;
      const checked = checkSubmission(scenario, submission);
      if ('status' in checked) return checked;
      let key: string;
      try {
        key = retestKey(user, submission.sessionId);
      } catch (error) {
        return inputRejection(error);
      }

      const completedAt = this.now().toISOString();
      let comparison: RetestComparison;
      try {
        comparison = compareRetest(
          { scenario: original.scenario, session: originalSession, evaluation: run.evaluation },
          { scenario, session: checked.session, evaluation: checked.audit.evaluation! },
          original.remediation,
          comparisonOptions(submission.sessionId, completedAt, input.findingId),
        );
      } catch (error) {
        if (error instanceof SimulationError) return reject('INVALID_INPUT', error.message);
        throw error;
      }

      const record: RetestRecord = {
        kind: 'retest',
        schemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        installation: user.installation,
        owner: user.accountId,
        retestId: submission.sessionId,
        originalRunId: original.runId,
        originalScenarioFingerprint: original.scenarioFingerprint,
        fixSet: {
          remediationIds: [...input.remediationIds],
          approvedBy: user.accountId,
          approvedAt: completedAt,
        },
        scenarioFingerprint: checked.audit.scenarioFingerprint,
        scenario,
        audit: checked.audit,
        comparison,
        completedAt,
      };
      const entry: HistoryIndexEntry = {
        id: record.retestId,
        kind: 'retest',
        retestOf: original.runId,
        completedAt,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        ...(original.provenance
          ? { changeKey: original.provenance.changeKey, findingId: original.provenance.findingId }
          : {}),
        metCount: checked.audit.evaluation!.metCount,
        totalCount: checked.audit.evaluation!.totalCount,
        outcome: comparison.outcome,
        digest: contentDigest(record),
      };
      return await this.writeRecordAndIndex(user, key, record, entry, (index) => {
        if (index.entries.some((e) => e.kind === 'retest' && e.id === entry.id)) {
          return reject('DUPLICATE', `Retest ${entry.id} is already saved.`);
        }
        const originalEntry = index.entries.find(
          (e) => e.kind === 'run' && e.id === original.runId,
        );
        if (!originalEntry || this.isExpired(originalEntry)) {
          return reject('ORIGINAL_NOT_FOUND', `Run ${original.runId} is no longer in history.`);
        }
        const count = index.entries.filter((e) => e.retestOf === original.runId).length;
        if (count >= MAX_RETESTS_PER_RUN) {
          return reject('RETEST_LIMIT', `A run keeps at most ${MAX_RETESTS_PER_RUN} retests.`);
        }
        return null;
      });
    } catch (error) {
      if (error instanceof StorageUnavailableError) return { status: 'UNAVAILABLE' };
      throw error;
    }
  }

  /**
   * Lists the caller's runs, newest first, each with its retests. Expired and
   * over-limit runs are pruned (and written) first, and reported in `pruned`.
   * Rows are not re-verified here; opening one (getRun/getComparison) is.
   */
  async listRuns(user: HistoryUser): Promise<ListResult> {
    indexKey(user);
    try {
      const outcome = await this.updateIndex(user, (index) => {
        const { next, pruned } = prune(user, index, this.now().getTime());
        return { write: pruned.length > 0 ? next : null, result: { next, pruned } };
      });
      if (outcome === 'CONFLICT') return { status: 'CONFLICT' };
      const { next, pruned } = outcome;
      const runs = next.entries.filter((e) => e.kind === 'run').reverse();
      const items: HistoryListItem[] = runs.map((run) => ({
        run,
        retests: next.entries.filter((e) => e.kind === 'retest' && e.retestOf === run.id),
      }));
      return { status: 'OK', items, pruned };
    } catch (error) {
      if (error instanceof StorageUnavailableError) return { status: 'UNAVAILABLE' };
      throw error;
    }
  }

  /** Reads one of the caller's runs and re-verifies it. */
  async getRun(user: HistoryUser, runId: string): Promise<GetRunResult> {
    indexKey(user);
    try {
      const loaded = await this.loadRun(user, runId);
      return loaded.status === 'OK' ? { status: 'OK', run: loaded.run } : loaded;
    } catch (error) {
      if (error instanceof StorageUnavailableError) return { status: 'UNAVAILABLE' };
      throw error;
    }
  }

  /**
   * Before/after for one retest: re-verifies the original and the retest,
   * rebuilds the retest scenario from the original and the approved fixes,
   * and recomputes the comparison; any difference is TAMPERED.
   */
  async getComparison(user: HistoryUser, retestId: string): Promise<GetComparisonResult> {
    indexKey(user);
    try {
      let key: string;
      try {
        key = retestKey(user, retestId);
      } catch {
        return { status: 'NOT_FOUND' };
      }
      const { index } = await this.readIndex(user);
      const entry = index.entries.find((e) => e.kind === 'retest' && e.id === retestId);
      const originalEntry =
        entry && index.entries.find((e) => e.kind === 'run' && e.id === entry.retestOf);
      if (!entry || !originalEntry || this.isExpired(originalEntry)) return { status: 'NOT_FOUND' };

      const loaded = await this.loadRun(user, originalEntry.id, index);
      if (loaded.status === 'NOT_FOUND') return loaded;
      if (loaded.status !== 'OK') {
        return loaded.status === 'TAMPERED'
          ? { status: 'TAMPERED', problems: loaded.problems.map((p) => `original: ${p}`) }
          : { status: 'UNVERIFIABLE', reason: `original: ${loaded.reason}` };
      }

      const stored = await this.read<unknown>(key);
      if (stored === undefined) {
        return { status: 'UNVERIFIABLE', reason: 'The stored retest record is missing.' };
      }
      const verified = verifyRetestRecord(user, stored.value, entry, loaded);
      if ('status' in verified) return verified;
      return {
        status: 'OK',
        original: loaded.run,
        retest: verified.retest,
        comparison: verified.comparison,
      };
    } catch (error) {
      if (error instanceof StorageUnavailableError) return { status: 'UNAVAILABLE' };
      throw error;
    }
  }

  // ---- internals ---------------------------------------------------------

  private isExpired(entry: HistoryIndexEntry): boolean {
    return isExpired(entry, this.now().getTime());
  }

  /** Index entry lookup plus full verification of a run record. */
  private async loadRun(
    user: HistoryUser,
    runId: string,
    knownIndex?: HistoryIndex,
  ): Promise<LoadedRun | { status: 'NOT_FOUND' } | VerificationFailure> {
    if (typeof runId !== 'string') return { status: 'NOT_FOUND' };
    let key: string;
    try {
      key = runKey(user, runId);
    } catch {
      return { status: 'NOT_FOUND' };
    }
    const index = knownIndex ?? (await this.readIndex(user)).index;
    const entry = index.entries.find((e) => e.kind === 'run' && e.id === runId);
    if (!entry || this.isExpired(entry)) return { status: 'NOT_FOUND' };
    const stored = await this.read<unknown>(key);
    if (stored === undefined) {
      return { status: 'UNVERIFIABLE', reason: 'The stored run record is missing.' };
    }
    const verified = verifyRunRecord(user, stored.value, entry);
    if ('status' in verified) return verified;
    const { record, session } = verified;
    const retestIds = index.entries
      .filter((e) => e.kind === 'retest' && e.retestOf === runId)
      .map((e) => e.id);
    return {
      status: 'OK',
      record,
      session,
      run: {
        runId: record.runId,
        scenario: record.scenario,
        remediation: record.remediation,
        provenance: record.provenance,
        audit: record.audit,
        evaluation: record.audit.evaluation!,
        completedAt: record.completedAt,
        retestIds,
      },
    };
  }

  /**
   * Writes the record create-only, then adds `entry` to the index (pruning
   * first). `precheck` runs against each fresh index read and may refuse.
   * On any failure after the record write, the record is removed again.
   */
  private async writeRecordAndIndex(
    user: HistoryUser,
    key: string,
    record: RunRecord | RetestRecord,
    entry: HistoryIndexEntry,
    precheck: (index: HistoryIndex) => Rejection | null,
  ): Promise<SaveResult> {
    const bytes = storedBytes(record);
    if (bytes > MAX_VALUE_BYTES) return { status: 'TOO_LARGE', bytes, limit: MAX_VALUE_BYTES };
    try {
      const created = await this.write(key, record, null);
      if (!created.ok) return reject('DUPLICATE', `${entry.id} is already saved.`);

      type Outcome = SaveResult;
      let outcome: Outcome | 'CONFLICT';
      try {
        outcome = await this.updateIndex<Outcome>(user, (index) => {
          const refused = precheck(index);
          if (refused) return { write: null, result: refused };
          const { next, pruned } = prune(
            user,
            { ...index, entries: [...index.entries, entry] },
            this.now().getTime(),
            entry.retestOf ?? entry.id,
          );
          const indexBytes = storedBytes(next);
          if (indexBytes > MAX_VALUE_BYTES) {
            return {
              write: null,
              result: { status: 'TOO_LARGE', bytes: indexBytes, limit: MAX_VALUE_BYTES },
            };
          }
          return { write: next, result: { status: 'SAVED', id: entry.id, bytes, pruned } };
        });
      } catch (error) {
        await this.bestEffortDelete(key);
        throw error;
      }
      if (outcome === 'CONFLICT' || outcome.status !== 'SAVED') {
        await this.bestEffortDelete(key);
        return outcome === 'CONFLICT' ? { status: 'CONFLICT' } : outcome;
      }
      return outcome;
    } catch (error) {
      if (error instanceof StorageUnavailableError) return { status: 'UNAVAILABLE' };
      throw error;
    }
  }

  /**
   * Read-modify-write of the index with an optimistic version check, retried
   * on CONFLICT up to MAX_WRITE_ATTEMPTS times. `mutate` returns the index to
   * write (or null for no write) and a result. Before writing, the previous
   * write's pending deletes are carried out; after it, the new ones are tried.
   */
  private async updateIndex<R>(
    user: HistoryUser,
    mutate: (index: HistoryIndex) => { write: HistoryIndex | null; result: R },
  ): Promise<R | 'CONFLICT'> {
    const key = indexKey(user);
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const { index, version } = await this.readIndex(user);
      const { write, result } = mutate(index);
      if (!write) return result;
      const live = new Set(write.entries.map((e) => entryKey(user, e)));
      for (const stale of index.pendingDeletes) {
        if (!live.has(stale)) await this.remove(stale);
      }
      const written = await this.write(key, write, version);
      if (!written.ok) continue;
      for (const pruned of write.pendingDeletes) {
        if (!live.has(pruned)) await this.bestEffortDelete(pruned);
      }
      return result;
    }
    return 'CONFLICT';
  }

  private async readIndex(
    user: HistoryUser,
  ): Promise<{ index: HistoryIndex; version: number | null }> {
    const stored = await this.read<unknown>(indexKey(user));
    if (stored === undefined) {
      return { index: { schemaVersion: 1, entries: [], pendingDeletes: [] }, version: null };
    }
    if (!isIndex(stored.value)) {
      throw new StorageUnavailableError('The history index is malformed.');
    }
    return { index: stored.value, version: stored.version };
  }

  private async read<T>(key: string): Promise<Versioned<T> | undefined> {
    try {
      return await this.storage.get<T>(key);
    } catch (error) {
      throw new StorageUnavailableError(errorText(error));
    }
  }

  private async write<T>(key: string, value: T, expected: number | null): Promise<WriteResult> {
    try {
      return await this.storage.set(key, value, expected);
    } catch (error) {
      throw new StorageUnavailableError(errorText(error));
    }
  }

  private async remove(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      throw new StorageUnavailableError(errorText(error));
    }
  }

  private async bestEffortDelete(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      // Left for the next write's pendingDeletes pass or a later cleanup.
    }
  }
}

// ---- pure helpers ----------------------------------------------------------

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inputRejection(error: unknown): Rejection {
  if (error instanceof HistoryInputError) return reject('INVALID_INPUT', error.message);
  throw error;
}

function comparisonOptions(id: string, comparedAt: string, findingId: string | undefined) {
  return findingId === undefined ? { id, comparedAt } : { id, comparedAt, findingId };
}

function entryKey(user: HistoryUser, entry: HistoryIndexEntry): string {
  return entry.kind === 'run' ? runKey(user, entry.id) : retestKey(user, entry.id);
}

function isExpired(entry: HistoryIndexEntry, nowMs: number): boolean {
  const at = Date.parse(entry.completedAt);
  return Number.isNaN(at) || nowMs - at > MAX_AGE_MS;
}

function byAge(a: HistoryIndexEntry, b: HistoryIndexEntry): number {
  if (a.completedAt !== b.completedAt) return a.completedAt < b.completedAt ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'run' ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Retention, deterministic for a given clock:
 * 1. original runs older than MAX_AGE_DAYS are pruned;
 * 2. while more than MAX_RUNS_PER_USER remain, the oldest is pruned
 *    (ordered by completedAt, then id), never `protectRunId`;
 * 3. retests go with their original (and orphaned retests are dropped).
 * `next.pendingDeletes` lists the storage keys of every pruned record.
 */
function prune(
  user: HistoryUser,
  index: HistoryIndex,
  nowMs: number,
  protectRunId?: string,
): { next: HistoryIndex; pruned: PrunedEntry[] } {
  const entries = [...index.entries].sort(byAge);
  const reasons = new Map<string, PrunedEntry['reason']>();
  const runs = entries.filter((e) => e.kind === 'run');
  for (const run of runs) {
    if (run.id !== protectRunId && isExpired(run, nowMs)) reasons.set(run.id, 'age');
  }
  let remaining = runs.filter((r) => !reasons.has(r.id));
  while (remaining.length > MAX_RUNS_PER_USER) {
    const oldest = remaining.find((r) => r.id !== protectRunId);
    if (!oldest) break;
    reasons.set(oldest.id, 'count');
    remaining = remaining.filter((r) => r !== oldest);
  }
  const kept = new Set(remaining.map((r) => r.id));

  const pruned: PrunedEntry[] = [];
  const pendingDeletes: string[] = [];
  const keep: HistoryIndexEntry[] = [];
  for (const e of entries) {
    const runId = e.kind === 'run' ? e.id : e.retestOf;
    if (runId !== undefined && kept.has(runId)) {
      keep.push(e);
      continue;
    }
    pruned.push({
      id: e.id,
      kind: e.kind,
      ...(e.retestOf !== undefined ? { retestOf: e.retestOf } : {}),
      completedAt: e.completedAt,
      reason: (runId !== undefined && reasons.get(runId)) || 'age',
    });
    pendingDeletes.push(entryKey(user, e));
  }
  return {
    next: {
      schemaVersion: 1,
      entries: keep,
      pendingDeletes,
    },
    pruned,
  };
}

function isIndex(value: unknown): value is HistoryIndex {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<HistoryIndex>;
  return (
    v.schemaVersion === 1 &&
    Array.isArray(v.pendingDeletes) &&
    v.pendingDeletes.every((k) => typeof k === 'string') &&
    Array.isArray(v.entries) &&
    v.entries.every(
      (e) =>
        !!e &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        (e.kind === 'run' || (e.kind === 'retest' && typeof e.retestOf === 'string')) &&
        typeof e.completedAt === 'string' &&
        typeof e.digest === 'string',
    )
  );
}

/** Replays a submission against the trusted scenario and compares every claim. */
function checkSubmission(
  scenario: SimulationScenario,
  submission: RunSubmission,
): CheckedSubmission | Rejection {
  if (
    !submission ||
    typeof submission.sessionId !== 'string' ||
    typeof submission.startedAt !== 'string' ||
    Number.isNaN(Date.parse(submission.startedAt)) ||
    !Array.isArray(submission.decisionIds) ||
    !submission.decisionIds.every((d) => typeof d === 'string') ||
    typeof submission.scenarioFingerprint !== 'string' ||
    !submission.evaluation ||
    typeof submission.evaluation !== 'object' ||
    !submission.flags ||
    typeof submission.flags !== 'object'
  ) {
    return reject('INVALID_INPUT', 'Run submission is malformed.');
  }
  if (submission.scenarioFingerprint !== scenarioFingerprint(scenario)) {
    return reject(
      'SCENARIO_MISMATCH',
      'The change or runbook changed since this rehearsal started.',
    );
  }
  let session: ExerciseSession;
  try {
    session = replaySession(
      scenario,
      submission.decisionIds,
      submission.sessionId,
      submission.startedAt,
    );
  } catch (error) {
    if (error instanceof SimulationError) return reject('REPLAY_FAILED', error.message);
    throw error;
  }
  if (session.status !== 'completed') {
    return reject('NOT_COMPLETED', 'Only completed rehearsals are saved.');
  }
  const audit = createAuditRecord(scenario, session);
  if (canonicalJson(audit.flags) !== canonicalJson(submission.flags)) {
    return reject('FLAGS_MISMATCH', 'Submitted flags do not match the replayed decisions.');
  }
  if (canonicalJson(audit.evaluation) !== canonicalJson(submission.evaluation)) {
    return reject(
      'EVALUATION_MISMATCH',
      'Submitted evaluation does not match the replayed decisions.',
    );
  }
  return { session, audit };
}

/** Shape, digest and version gate shared by run and retest records. */
function precheckRecord(
  user: HistoryUser,
  value: unknown,
  entry: HistoryIndexEntry,
  kind: 'run' | 'retest',
): { problems: string[] } | VerificationFailure {
  const r = value as (Partial<Omit<RunRecord, 'kind'>> & { kind?: unknown }) | null;
  if (
    !r ||
    typeof r !== 'object' ||
    r.kind !== kind ||
    r.schemaVersion !== 1 ||
    !r.scenario ||
    typeof r.scenario !== 'object' ||
    !r.audit ||
    typeof r.audit !== 'object'
  ) {
    return { status: 'UNVERIFIABLE', reason: `The stored ${kind} record has an unknown format.` };
  }
  if (contentDigest(value) !== entry.digest) {
    return { status: 'TAMPERED', problems: ['record does not match its index digest'] };
  }
  if (r.engineVersion !== ENGINE_VERSION) {
    return {
      status: 'UNVERIFIABLE',
      reason: `Recorded under engine version ${String(r.engineVersion)}; this is ${ENGINE_VERSION}.`,
    };
  }
  const problems: string[] = [];
  if (r.owner !== user.accountId || r.installation !== user.installation) {
    problems.push('record belongs to another user or installation');
  }
  return { problems };
}

function verifyAudit(
  scenario: SimulationScenario,
  audit: SessionAuditRecord,
  claimedFingerprint: unknown,
  id: string,
  problems: string[],
): ExerciseSession | null {
  if (audit.sessionId !== id) problems.push('audit session id does not match the record id');
  if (claimedFingerprint !== scenarioFingerprint(scenario)) {
    problems.push('scenario snapshot does not match its fingerprint');
  }
  const verification = verifyAuditRecord(audit, scenario);
  if (!verification.ok) problems.push(...verification.problems);
  if (audit.status !== 'completed' || !audit.evaluation) {
    problems.push('record is not a completed session');
  }
  if (!verification.ok || problems.length > 0) return null;
  return replaySession(
    scenario,
    audit.decisions.map((d) => d.decisionId),
    audit.sessionId,
    audit.startedAt,
  );
}

function verifyRunRecord(
  user: HistoryUser,
  value: unknown,
  entry: HistoryIndexEntry,
): { record: RunRecord; session: ExerciseSession } | VerificationFailure {
  const gate = precheckRecord(user, value, entry, 'run');
  if ('status' in gate) return gate;
  const { problems } = gate;
  const record = value as RunRecord;
  try {
    if (record.runId !== entry.id) problems.push('record id does not match the index');
    const session = verifyAudit(
      record.scenario,
      record.audit,
      record.scenarioFingerprint,
      entry.id,
      problems,
    );
    if (problems.length > 0 || !session) return { status: 'TAMPERED', problems };
    return { record, session };
  } catch (error) {
    return { status: 'TAMPERED', problems: [...problems, `replay failed: ${errorText(error)}`] };
  }
}

function verifyRetestRecord(
  user: HistoryUser,
  value: unknown,
  entry: HistoryIndexEntry,
  original: LoadedRun,
): { retest: VerifiedRetest; comparison: RetestComparison } | VerificationFailure {
  const gate = precheckRecord(user, value, entry, 'retest');
  if ('status' in gate) return gate;
  const { problems } = gate;
  const record = value as RetestRecord;
  try {
    if (record.retestId !== entry.id) problems.push('record id does not match the index');
    if (record.originalRunId !== original.record.runId) {
      problems.push('retest points at a different original run');
    }
    if (record.originalScenarioFingerprint !== original.record.scenarioFingerprint) {
      problems.push('original run changed since the retest was saved');
    }
    if (!original.record.remediation) problems.push('original run has no remediation model');
    const session = verifyAudit(
      record.scenario,
      record.audit,
      record.scenarioFingerprint,
      entry.id,
      problems,
    );
    if (problems.length > 0 || !session || !original.record.remediation) {
      return { status: 'TAMPERED', problems };
    }
    const rebuilt = buildRetest(
      original.record.scenario,
      original.session,
      record.fixSet.remediationIds,
      original.record.remediation,
    );
    if (scenarioFingerprint(rebuilt) !== record.scenarioFingerprint) {
      problems.push('retest scenario does not follow from the original and the approved fixes');
      return { status: 'TAMPERED', problems };
    }
    const comparison = compareRetest(
      {
        scenario: original.record.scenario,
        session: original.session,
        evaluation: original.run.evaluation,
      },
      { scenario: record.scenario, session, evaluation: record.audit.evaluation! },
      original.record.remediation,
      comparisonOptions(
        record.comparison.id,
        record.comparison.comparedAt,
        record.comparison.findingId,
      ),
    );
    if (canonicalJson(comparison) !== canonicalJson(record.comparison)) {
      problems.push('stored comparison does not match the recomputed comparison');
      return { status: 'TAMPERED', problems };
    }
    return {
      comparison,
      retest: {
        retestId: record.retestId,
        originalRunId: record.originalRunId,
        fixSet: record.fixSet,
        scenario: record.scenario,
        audit: record.audit,
        evaluation: record.audit.evaluation!,
        completedAt: record.completedAt,
      },
    };
  } catch (error) {
    return { status: 'TAMPERED', problems: [...problems, `replay failed: ${errorText(error)}`] };
  }
}
