import type { ExerciseEvaluation, SimulationScenario } from '../domain/types';
import type { GeneratedRehearsal } from '../rehearsal/types';
import type {
  RetestComparison,
  ScenarioRemediationModel,
  SessionAuditRecord,
} from '../simulation/types';

/**
 * Durable rehearsal history (docs/M6_PLAN.md §6): stored records, inputs and
 * results. Everything is plain JSON so it can go through any StorageAdapter.
 *
 * Records keep a full snapshot of the scenario they ran against, so a stored
 * run can be replayed and re-verified even after the generator or the
 * authored scenarios change (see store.ts for the size budget).
 */

/** Who is asking. Both come from the Forge invocation context, never from the browser. */
export interface HistoryUser {
  /** `context.installContext`, treated as an opaque string. */
  installation: string;
  /** `context.accountId` of the caller. */
  accountId: string;
}

/** Provenance of a generated rehearsal; null for authored scenarios. */
export type RunProvenance = GeneratedRehearsal['provenance'];

/** The approved fix set a retest applies. Set by the server from the caller. */
export interface ApprovedFixSet {
  remediationIds: string[];
  /** accountId of the user who approved (the caller). */
  approvedBy: string;
  approvedAt: string;
}

/** One completed rehearsal run. Stored at `<prefix>:run:<runId>`. */
export interface RunRecord {
  kind: 'run';
  schemaVersion: 1;
  /** See ENGINE_VERSION in store.ts. */
  engineVersion: number;
  installation: string;
  owner: string;
  /** Equals the session id. */
  runId: string;
  scenarioId: string;
  scenarioVersion: number;
  scenarioFingerprint: string;
  /** Snapshot of the exact scenario the run used. */
  scenario: SimulationScenario;
  /** Needed for retests; null when the scenario has no remediation model. */
  remediation: ScenarioRemediationModel | null;
  provenance: RunProvenance | null;
  /** Replayable audit record (shared/simulation/replay.ts); holds the evaluation. */
  audit: SessionAuditRecord;
  /** Server clock when the run was saved. */
  completedAt: string;
}

/** A retest of a stored run. Stored at `<prefix>:retest:<retestId>`. */
export interface RetestRecord {
  kind: 'retest';
  schemaVersion: 1;
  engineVersion: number;
  installation: string;
  owner: string;
  /** Equals the retest session id. */
  retestId: string;
  originalRunId: string;
  /** Fingerprint of the original run's scenario, so a replaced original is detected. */
  originalScenarioFingerprint: string;
  fixSet: ApprovedFixSet;
  scenarioFingerprint: string;
  /** Snapshot of the remediated scenario the retest used. */
  scenario: SimulationScenario;
  audit: SessionAuditRecord;
  /** Computed by the server with compareRetest; recomputed on every read. */
  comparison: RetestComparison;
  completedAt: string;
}

/** One row of the per-user index. Small on purpose: the index is one stored value. */
export interface HistoryIndexEntry {
  id: string;
  kind: 'run' | 'retest';
  /** Retests only: the original run id. */
  retestOf?: string;
  completedAt: string;
  scenarioId: string;
  scenarioVersion: number;
  changeKey?: string;
  findingId?: string;
  metCount: number;
  totalCount: number;
  /** Retests only. */
  outcome?: RetestComparison['outcome'];
  /** Content digest of the stored record, checked on every read. */
  digest: string;
}

/** Per-user index. Stored at `<prefix>:index`. */
export interface HistoryIndex {
  schemaVersion: 1;
  entries: HistoryIndexEntry[];
  /**
   * Record keys pruned by the last write. Deleted right after that write and
   * again (idempotently) on the next one, so a failed delete is retried.
   */
  pendingDeletes: string[];
}

/** What the browser submits after finishing a run. Never trusted as-is. */
export interface RunSubmission {
  sessionId: string;
  startedAt: string;
  decisionIds: string[];
  /** Fingerprint of the scenario the browser ran. */
  scenarioFingerprint: string;
  /** The browser's claimed results; the server recomputes and compares. */
  evaluation: ExerciseEvaluation;
  flags: Record<string, number>;
}

/**
 * Trusted, server-side inputs for saveRun. The resolver regenerates the
 * rehearsal (analyzeChange + generateRehearsal asUser) or loads the authored
 * scenario; the browser's copy is never used.
 */
export interface TrustedScenario {
  scenario: SimulationScenario;
  remediation: ScenarioRemediationModel | null;
  provenance: RunProvenance | null;
}

export interface SaveRetestInput {
  originalRunId: string;
  /** Remediation ids the caller approves and applies. */
  remediationIds: string[];
  /** Limit the comparison to one gap (compareRetest `findingId`). */
  findingId?: string;
  submission: RunSubmission;
}

export type RejectReason =
  | 'INVALID_INPUT'
  | 'SCENARIO_MISMATCH'
  | 'REPLAY_FAILED'
  | 'NOT_COMPLETED'
  | 'EVALUATION_MISMATCH'
  | 'FLAGS_MISMATCH'
  | 'DUPLICATE'
  | 'ORIGINAL_NOT_FOUND'
  | 'ORIGINAL_NOT_VERIFIED'
  | 'NO_REMEDIATION_MODEL'
  | 'INVALID_FIXES'
  | 'RETEST_LIMIT';

/** Why a record was pruned. */
export interface PrunedEntry {
  id: string;
  kind: 'run' | 'retest';
  retestOf?: string;
  completedAt: string;
  reason: 'age' | 'count';
}

/** Storage could not be reached. The UI says "History could not be loaded". */
export interface Unavailable {
  status: 'UNAVAILABLE';
}

export type SaveResult =
  | { status: 'SAVED'; id: string; bytes: number; pruned: PrunedEntry[] }
  | { status: 'REJECTED'; reason: RejectReason; message: string }
  /** "This rehearsal is too large to save"; nothing is truncated. */
  | { status: 'TOO_LARGE'; bytes: number; limit: number }
  /** Concurrent writes kept winning after the bounded retries. */
  | { status: 'CONFLICT' }
  | Unavailable;

/** One row in the history list: an original run and its retests (oldest first). */
export interface HistoryListItem {
  run: HistoryIndexEntry;
  retests: HistoryIndexEntry[];
}

export type ListResult =
  | { status: 'OK'; items: HistoryListItem[]; pruned: PrunedEntry[] }
  | { status: 'CONFLICT' }
  | Unavailable;

/** Read failures that are not "not found" or "unavailable". */
export type VerificationFailure =
  /** Verification ran and the record does not match its own replay or digest. */
  | { status: 'TAMPERED'; problems: string[] }
  /** The record cannot be checked (unknown schema/engine version, malformed). */
  | { status: 'UNVERIFIABLE'; reason: string };

export interface VerifiedRun {
  runId: string;
  scenario: SimulationScenario;
  remediation: ScenarioRemediationModel | null;
  provenance: RunProvenance | null;
  audit: SessionAuditRecord;
  evaluation: ExerciseEvaluation;
  completedAt: string;
  /** Ids of this run's stored retests, oldest first. */
  retestIds: string[];
}

export type GetRunResult =
  { status: 'OK'; run: VerifiedRun } | { status: 'NOT_FOUND' } | VerificationFailure | Unavailable;

export interface VerifiedRetest {
  retestId: string;
  originalRunId: string;
  fixSet: ApprovedFixSet;
  scenario: SimulationScenario;
  audit: SessionAuditRecord;
  evaluation: ExerciseEvaluation;
  completedAt: string;
}

export type GetComparisonResult =
  | {
      status: 'OK';
      original: VerifiedRun;
      retest: VerifiedRetest;
      comparison: RetestComparison;
    }
  | { status: 'NOT_FOUND' }
  | VerificationFailure
  | Unavailable;
