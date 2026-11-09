/**
 * Proposed contracts for Rovo actions and Atlassian MCP tools (types only).
 *
 * Design: docs/BONUS_FEASIBILITY.md. Nothing here is wired into the manifest
 * yet. Actions return deterministic engine output and cited evidence; the
 * agent only words it. No action applies rehearsal decisions or writes to Jira.
 *
 * Forge `action` inputs are flat primitives (string | integer | number |
 * boolean), so every input type below uses primitives only.
 * https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/
 */

import type {
  DataOrigin,
  EvidenceReference,
  FindingConfidence,
  IsoDateTime,
  ObjectiveResult,
  RemediationAction,
  RiskFinding,
} from '../domain/types';

/** Action keys as they would appear under `modules.action` in manifest.yml. */
export type AgentActionKey =
  | 'find-recovery-risks'
  | 'get-service-readiness'
  | 'prepare-rehearsal'
  | 'explain-outcome'
  | 'propose-remediation'
  | 'list-open-recovery-gaps';

/** Subset exposed through `rovo:mcp`. All are read-only (`actionVerb: GET`). */
export type McpToolKey = Extract<
  AgentActionKey,
  'find-recovery-risks' | 'get-service-readiness' | 'explain-outcome' | 'list-open-recovery-gaps'
>;

export type ActionVerb = 'GET' | 'CREATE' | 'UPDATE' | 'DELETE' | 'TRIGGER';

/**
 * Invocation context as documented on the action module page. The exact shape
 * outside a Jira issue view is unverified, so every field is optional and must
 * be checked. Authorization uses `accountId` from here, never from inputs.
 */
export interface ActionInvocationContext {
  cloudId?: string;
  moduleKey?: string;
  accountId?: string;
  jira?: { issueKey?: string; projectKey?: string };
  confluence?: { contentId?: string; spaceKey?: string };
}

/** Raw payload a handler receives: inputs as top-level keys plus `context`. */
export type ActionPayload<TInput> = TInput & { context?: ActionInvocationContext };

/**
 * Every action output says what could not be assessed. `unknowns` is shown to
 * the user verbatim by the agent; an unknown is never reported as a pass.
 */
export interface ActionOutputBase {
  origin: DataOrigin;
  generatedAt: IsoDateTime;
  unknowns: string[];
}

/** Failure result: returned (not thrown) so the agent can say what went wrong. */
export interface ActionFailure {
  ok: false;
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_ASSESSED' | 'UPSTREAM_ERROR';
  message: string;
}

export type ActionResult<T extends ActionOutputBase> = ({ ok: true } & T) | ActionFailure;

// find-recovery-risks (GET) -------------------------------------------------

export interface FindRecoveryRisksInput {
  /** Jira issue key; defaults to `context.jira.issueKey` when omitted. */
  changeKey?: string;
}

export interface FindRecoveryRisksOutput extends ActionOutputBase {
  changeKey: string;
  /** At most 10, highest severity first. */
  findings: Pick<
    RiskFinding,
    'id' | 'title' | 'severity' | 'confidence' | 'procedureId' | 'evidence' | 'aiAssisted'
  >[];
  /** Deep link to the change in the ScenarioForge global page. */
  appUrl: string;
}

// get-service-readiness (GET) -----------------------------------------------

export type EdgeSource = 'jira' | 'confluence' | 'jsm' | 'teamwork-graph' | 'scenario';

export interface ReadinessEdge {
  from: { kind: 'change' | 'service' | 'procedure' | 'team' | 'user' | 'deployment'; id: string };
  to: { kind: 'change' | 'service' | 'procedure' | 'team' | 'user' | 'deployment'; id: string };
  relation: string;
  /** Every edge cites where it came from; edges without a source are dropped. */
  source: EdgeSource;
  evidence: EvidenceReference[];
}

export interface ServiceReadinessInput {
  serviceId: string;
}

export interface ServiceReadinessOutput extends ActionOutputBase {
  serviceId: string;
  /** `not-assessed` whenever any required source was unavailable. */
  status: 'gaps-found' | 'no-gaps-found' | 'not-assessed';
  edges: ReadinessEdge[];
  openFindingIds: string[];
}

// prepare-rehearsal (CREATE: persists a new session, decisions stay in the UI)

export interface PrepareRehearsalInput {
  changeKey: string;
  findingId?: string;
}

export interface PrepareRehearsalOutput extends ActionOutputBase {
  sessionId: string;
  scenarioId: string;
  scenarioVersion: number;
  briefing: string;
  objectives: { id: string; label: string }[];
  /** Participants make decisions here; the agent cannot. */
  rehearsalUrl: string;
}

// explain-outcome (GET) -----------------------------------------------------

export interface ExplainOutcomeInput {
  sessionId: string;
}

export interface ExplainOutcomeOutput extends ActionOutputBase {
  sessionId: string;
  status: 'completed' | 'in-progress';
  /** Present only for completed sessions; produced by `evaluateSession`. */
  objectives?: ObjectiveResult[];
  metCount?: number;
  totalCount?: number;
  elapsedMinutes: number;
  /** Authored consequence narratives from `decisionTrail`, in order. */
  trail: {
    stepTitle: string;
    decisionLabel: string;
    atMinute: number;
    assessment: 'effective' | 'neutral' | 'harmful';
    narrative: string;
    evidenceIds: string[];
  }[];
  evidence: EvidenceReference[];
}

// propose-remediation (CREATE: stores proposals only, never Jira issues) ----

export interface ProposeRemediationInput {
  sessionId: string;
  findingId?: string;
}

export interface ProposeRemediationOutput extends ActionOutputBase {
  /** Always `proposed`; approval and Jira creation happen in the app UI (M8). */
  proposals: (Pick<RemediationAction, 'id' | 'title' | 'description' | 'evidenceIds'> & {
    status: 'proposed';
  })[];
  approvalUrl: string;
}

// list-open-recovery-gaps (GET, MCP) ----------------------------------------

export interface ListOpenRecoveryGapsInput {
  projectKey?: string;
  /** 1..25. */
  limit?: number;
}

export interface ListOpenRecoveryGapsOutput extends ActionOutputBase {
  gaps: {
    findingId: string;
    title: string;
    severity: RiskFinding['severity'];
    confidence: FindingConfidence;
    changeKey: string;
    lastRetest: 'resolved' | 'still-failing' | 'inconclusive' | 'never';
  }[];
  truncated: boolean;
}

/** Input/output pairs per action, for typing a dispatcher. */
export interface AgentActionContracts {
  'find-recovery-risks': { input: FindRecoveryRisksInput; output: FindRecoveryRisksOutput };
  'get-service-readiness': { input: ServiceReadinessInput; output: ServiceReadinessOutput };
  'prepare-rehearsal': { input: PrepareRehearsalInput; output: PrepareRehearsalOutput };
  'explain-outcome': { input: ExplainOutcomeInput; output: ExplainOutcomeOutput };
  'propose-remediation': { input: ProposeRemediationInput; output: ProposeRemediationOutput };
  'list-open-recovery-gaps': {
    input: ListOpenRecoveryGapsInput;
    output: ListOpenRecoveryGapsOutput;
  };
}

export type AgentActionHandler<K extends AgentActionKey> = (
  payload: ActionPayload<AgentActionContracts[K]['input']>,
) => Promise<ActionResult<AgentActionContracts[K]['output']>>;

// Teamwork Graph enrichment (M4) --------------------------------------------

/**
 * Result of one Teamwork Graph lookup. `empty` means nothing visible to this
 * user (missing scopes silently omit data), not "no dependency". `unavailable`
 * covers GraphQL errors returned with HTTP 200, rate limits and timeouts; the
 * UI shows it as "Not assessed".
 */
export type TeamworkGraphLookup<T> =
  | { status: 'ok'; items: T[]; truncated: boolean; retrievedAt: IsoDateTime; query: string }
  | { status: 'empty'; retrievedAt: IsoDateTime; query: string }
  | { status: 'unavailable'; reason: string; retrievedAt: IsoDateTime; query: string };
