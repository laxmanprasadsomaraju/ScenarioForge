/**
 * ScenarioForge domain model.
 *
 * Shared by the Forge backend and the Custom UI frontend. Everything here is
 * plain data with no runtime dependencies so it can be validated, persisted
 * and replayed deterministically.
 *
 * Every entity carries a `origin` so live Atlassian data and synthetic demo
 * fixtures can never be confused in the UI or in reports.
 */

/** Where a record came from. `demo` records are synthetic fixtures. */
export type DataOrigin = 'live' | 'demo';

export type IsoDateTime = string;

/** A pointer to the source material that supports a claim. */
export interface EvidenceReference {
  id: string;
  origin: DataOrigin;
  kind:
    | 'jira-issue'
    | 'confluence-page'
    | 'jsm-service'
    | 'teamwork-graph'
    | 'runbook-step'
    | 'scenario-rule';
  title: string;
  /** Verbatim excerpt from the source; never paraphrased by AI. */
  excerpt?: string;
  /** Link to the source, when it exists in a real Atlassian product. */
  url?: string;
  /** When the source was read, for reproducibility. */
  retrievedAt?: IsoDateTime;
}

export interface OperationalService {
  id: string;
  origin: DataOrigin;
  name: string;
  tier: 'critical' | 'high' | 'standard';
  ownerTeam?: string;
  dependsOn: string[];
  recoveryProcedureIds: string[];
}

export interface SoftwareChange {
  id: string;
  origin: DataOrigin;
  /** Jira issue key for live changes, fixture id for demo ones. */
  key: string;
  summary: string;
  status: string;
  issueType: string;
  updatedAt: IsoDateTime | null;
  url?: string;
  affectedServiceIds: string[];
}

export interface RecoveryStep {
  order: number;
  instruction: string;
  /** Services or providers this step depends on being available. */
  dependsOn: string[];
}

export interface RecoveryProcedure {
  id: string;
  origin: DataOrigin;
  title: string;
  serviceId: string;
  steps: RecoveryStep[];
  lastReviewedAt?: IsoDateTime;
  source?: EvidenceReference;
}

/**
 * Confidence separates facts verified against sources from suggestions.
 * `unknown` is a first-class state: a failed check must never become `pass`.
 */
export type FindingConfidence = 'confirmed' | 'suspected' | 'unknown';

export interface RiskFinding {
  id: string;
  origin: DataOrigin;
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  confidence: FindingConfidence;
  changeId: string;
  procedureId?: string;
  evidence: EvidenceReference[];
  /** True when any part of the description was produced by an AI model. */
  aiAssisted: boolean;
}

export interface RecoveryObjective {
  id: string;
  label: string;
  rule: ObjectiveRule;
}

/**
 * Objectives are evaluated against the flag timeline of a session.
 * Flags record the simulated minute at which they first became true.
 */
export type ObjectiveRule =
  | { kind: 'flagSetWithin'; flag: string; minutes: number }
  | { kind: 'flagSet'; flag: string }
  | { kind: 'flagNeverSet'; flag: string };

export interface Consequence {
  /** Simulated minutes this action consumes. */
  minutes: number;
  /** Flags that become true when this action is taken. */
  setFlags?: string[];
  /** Deterministic, pre-authored explanation of what happened. */
  narrative: string;
  /** Rule-level evidence ids from the scenario that justify the narrative. */
  evidenceIds: string[];
  /** Coarse quality marker used in the debrief. */
  assessment: 'effective' | 'neutral' | 'harmful';
}

export interface Decision {
  id: string;
  label: string;
  detail?: string;
  consequence: Consequence;
  /**
   * Next step id, or null to end the exercise. `nextIfFlag` takes priority
   * when its flag has been set by this or an earlier decision.
   */
  next: string | null;
  nextIfFlag?: { flag: string; next: string | null };
}

export interface ScenarioStep {
  id: string;
  title: string;
  situation: string;
  decisions: Decision[];
}

export interface SimulationScenario {
  id: string;
  origin: DataOrigin;
  version: number;
  title: string;
  summary: string;
  changeContext: SoftwareChange;
  procedure: RecoveryProcedure;
  services: OperationalService[];
  evidence: EvidenceReference[];
  objectives: RecoveryObjective[];
  startStepId: string;
  steps: Record<string, ScenarioStep>;
  /** Pre-authored remediation suggestions surfaced in the debrief. */
  remediation: RemediationAction[];
}

export interface DecisionRecord {
  stepId: string;
  decisionId: string;
  /** Simulated minute when the decision was made. */
  atMinute: number;
}

export interface ExerciseSession {
  id: string;
  scenarioId: string;
  scenarioVersion: number;
  origin: DataOrigin;
  startedAt: IsoDateTime;
  status: 'in-progress' | 'completed';
  currentStepId: string | null;
  elapsedMinutes: number;
  /** flag name -> simulated minute it was first set. */
  flags: Record<string, number>;
  decisions: DecisionRecord[];
}

export interface ObjectiveResult {
  objectiveId: string;
  label: string;
  status: 'met' | 'missed';
  explanation: string;
}

export interface ExerciseEvaluation {
  sessionId: string;
  objectives: ObjectiveResult[];
  metCount: number;
  totalCount: number;
  elapsedMinutes: number;
}

export interface RemediationAction {
  id: string;
  origin: DataOrigin;
  title: string;
  description: string;
  /** Requires explicit human approval before anything is created in Jira. */
  status: 'proposed' | 'approved' | 'created' | 'rejected';
  evidenceIds: string[];
  jiraIssueKey?: string;
}

export interface RetestResult {
  id: string;
  originalSessionId: string;
  retestSessionId: string;
  findingId?: string;
  outcome: 'resolved' | 'still-failing' | 'inconclusive';
  comparedAt: IsoDateTime;
}
