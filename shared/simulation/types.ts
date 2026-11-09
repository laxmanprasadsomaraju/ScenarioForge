import type {
  Decision,
  DecisionRecord,
  EvidenceReference,
  ExerciseEvaluation,
  ExerciseSession,
  ObjectiveResult,
  ObjectiveRule,
  RecoveryStep,
  RetestResult,
  ScenarioStep,
  SimulationScenario,
} from '../domain/types';

/**
 * Simulation-layer types for remediation, retest, replay and scoring.
 *
 * These live beside the engine rather than in `shared/domain/types.ts` because
 * they describe how authored scenario data is transformed and checked, not new
 * domain entities. Everything is plain, JSON-serializable data.
 */

/**
 * One authored, deterministic change a remediation makes to a scenario.
 * Targets are matched by id (or `order` for procedure steps); a missing target
 * is an authoring error and fails loudly instead of being skipped.
 */
export type RemediationEffect =
  /** Replace the procedure step with the same `order`. */
  | { kind: 'replaceProcedureStep'; step: RecoveryStep }
  /** Replace the evidence item with the same `id`. */
  | { kind: 'replaceEvidence'; evidence: EvidenceReference }
  /** Add a new evidence item; its `id` must not exist yet. */
  | { kind: 'addEvidence'; evidence: EvidenceReference }
  /** Replace the decision with the same `id` at `stepId`. */
  | { kind: 'replaceDecision'; stepId: string; decision: Decision }
  /** Add a new step; its `id` must not exist yet. */
  | { kind: 'addStep'; step: ScenarioStep }
  /** Rewrite the situation text of an existing step. */
  | { kind: 'replaceSituation'; stepId: string; situation: string };

/** A decision, identified by the step that offers it. */
export interface DecisionRef {
  stepId: string;
  decisionId: string;
}

/**
 * A recovery gap the rehearsal is designed to expose, and how a retest proves
 * it closed. Authored per scenario alongside the remediation effects.
 */
export interface RecoveryGap {
  /** Id of the RiskFinding this gap corresponds to. */
  findingId: string;
  title: string;
  /** Remediations expected to close the gap. */
  remediationIds: string[];
  /** Objectives that must be met in the retest for the gap to count as closed. */
  objectiveIds: string[];
  /**
   * Decisions that rely on the gapped procedure. A retest only exercises the
   * gap if the participant takes at least one of them.
   */
  exerciseDecisions: DecisionRef[];
}

/** Remediation data authored for one scenario version. */
export interface ScenarioRemediationModel {
  scenarioId: string;
  /** The scenario version the effects were authored against. */
  baseVersion: number;
  /** remediation id -> effects. Every scenario remediation needs an entry (may be empty). */
  effects: Record<string, RemediationEffect[]>;
  gaps: RecoveryGap[];
}

/** A completed rehearsal: the scenario version, its session and its evaluation. */
export interface EvaluatedRun {
  scenario: SimulationScenario;
  session: ExerciseSession;
  evaluation: ExerciseEvaluation;
}

export interface ObjectiveComparison {
  objectiveId: string;
  original: ObjectiveResult['status'] | 'absent';
  retest: ObjectiveResult['status'] | 'absent';
}

/** Per-gap reasoning behind a retest outcome, for the debrief and audit. */
export interface GapAssessment {
  findingId: string;
  outcome: RetestResult['outcome'];
  /** The retest took at least one of the gap's exercise decisions. */
  exercised: boolean;
  /** Every exercise decision taken in the retest was assessed `effective`. */
  decisionsEffective: boolean;
  /** Every objective tied to the gap was met in the retest. */
  objectivesMet: boolean;
  objectives: ObjectiveComparison[];
  /** Deterministic, pre-written explanation of the outcome. */
  reason: string;
}

/** A RetestResult plus the per-gap reasoning that produced it. */
export interface RetestComparison extends RetestResult {
  gaps: GapAssessment[];
}

/**
 * Serializable record of one exercise session, sufficient to reproduce it.
 * `verifyAuditRecord` replays `decisions` against the scenario and checks that
 * every derived field matches.
 */
export interface SessionAuditRecord {
  schemaVersion: 1;
  sessionId: string;
  scenarioId: string;
  scenarioVersion: number;
  /** Content fingerprint of the exact scenario the session ran against. */
  scenarioFingerprint: string;
  origin: SimulationScenario['origin'];
  startedAt: string;
  status: ExerciseSession['status'];
  elapsedMinutes: number;
  decisions: DecisionRecord[];
  flags: Record<string, number>;
  /** Present only for completed sessions. */
  evaluation: ExerciseEvaluation | null;
}

export type AuditVerification = { ok: true } | { ok: false; problems: string[] };

/** Objective result with timing detail derived from the session's flag timeline. */
export interface ObjectiveScore {
  objectiveId: string;
  label: string;
  status: ObjectiveResult['status'];
  ruleKind: ObjectiveRule['kind'];
  flag: string;
  /** Simulated minute the flag was first set, or null if never set. */
  flagSetAt: number | null;
  /** Deadline for `flagSetWithin` objectives, otherwise null. */
  targetMinutes: number | null;
  /**
   * `flagSetWithin` only: minutes past the deadline when achieved late, 0 when
   * on time, null when never achieved (lateness is unknown, not zero).
   */
  minutesOverTarget: number | null;
  /** `flagSetWithin` only: minutes left before the deadline when met, otherwise null. */
  minutesToSpare: number | null;
}

export interface SessionScore {
  sessionId: string;
  objectives: ObjectiveScore[];
  metCount: number;
  totalCount: number;
  elapsedMinutes: number;
  /** Sum of `minutesOverTarget` over objectives achieved late. */
  totalMinutesOverTarget: number;
  /** Deadline objectives whose flag was never set. */
  deadlinesNeverReached: number;
  decisionAssessments: Record<'effective' | 'neutral' | 'harmful', number>;
}
