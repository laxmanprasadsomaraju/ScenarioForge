/**
 * Proposed contracts for Rovo actions and Atlassian MCP tools (types only).
 *
 * Design: docs/BONUS_FEASIBILITY.md; M6 scope and the action-to-engine
 * mapping: docs/M6_PLAN.md (the "M6" section at the end of this file). Nothing
 * here is wired into the manifest yet. Actions return deterministic engine output and cited evidence; the
 * agent only words it. No action applies rehearsal decisions or writes to Jira.
 *
 * Forge `action` inputs are flat primitives (string | integer | number |
 * boolean), so every input type below uses primitives only.
 * https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/
 */

import type { AnalysisCoverage, AnalysisStatus, ChangeAction, LinkBasis } from '../analysis/types';
import type {
  DataOrigin,
  EvidenceReference,
  FindingConfidence,
  IsoDateTime,
  ObjectiveResult,
  RemediationAction,
  RiskFinding,
} from '../domain/types';
import type { GraphEdgeKind, GraphNodeKind, SourceStatus, UnassessedLink } from '../graph/types';
import type { RetestComparison } from '../simulation/types';

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
  /** Fields as listed on the action module page (re-checked 2026-11-10). */
  jira?: {
    url?: string;
    resourceType?: string;
    issueKey?: string;
    issueId?: string;
    issueType?: string;
    issueTypeId?: string;
    projectKey?: string;
    projectId?: string;
  };
  confluence?: {
    url?: string;
    resourceType?: string;
    contentId?: string;
    spaceKey?: string;
    spaceId?: string;
  };
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
  /**
   * Evidence ids whose source text looks like instructions to an AI (for
   * example "ignore previous instructions"). Detected by fixed patterns, not
   * by a model. The text is still returned as quoted data; the agent says the
   * source contains instructions it will not follow. Optional so earlier
   * outputs stay valid; M6 handlers always set it (possibly empty).
   */
  sourceWarnings?: { evidenceId: string; pattern: string }[];
  /**
   * Fixed text saying what the usage governor covers: ScenarioForge's own
   * work is limited, but Rovo charges the user's chat message separately.
   * Optional so earlier outputs stay valid; M6 handlers always set it.
   */
  usageNote?: string;
}

/** Failure result: returned (not thrown) so the agent can say what went wrong. */
export interface ActionFailure {
  ok: false;
  /**
   * `USAGE_LIMITED`: the usage governor denied the call (AI disabled for the
   * site, cap reached, rate limited, or the ledger was unreachable). Nothing
   * was assessed; the agent repeats `message` and does not guess an answer.
   * `SOURCE_FLAGGED` is never used as a code: flagged source text is reported
   * in `ActionOutputBase.sourceWarnings` instead, so findings still return.
   * `IDENTITY_UNAVAILABLE`: no user accountId in the invocation context, or no
   * user-scoped (asUser) client could be made. Actions never fall back to
   * app-level access, so nothing was read.
   * `GOVERNANCE_UNAVAILABLE`: the usage ledger could not be checked, so the
   * action did not run (fail closed). Distinct from `USAGE_LIMITED`: no limit
   * was reached, and no retry time is known.
   */
  code:
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'NOT_ASSESSED'
    | 'UPSTREAM_ERROR'
    | 'USAGE_LIMITED'
    | 'IDENTITY_UNAVAILABLE'
    | 'GOVERNANCE_UNAVAILABLE';
  message: string;
  /** Present with `USAGE_LIMITED` when the governor knows when to retry. */
  retryAfterSeconds?: number;
  /** Same fixed text as `ActionOutputBase.usageNote`; M6 handlers always set it. */
  usageNote?: string;
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

// ---------------------------------------------------------------------------
// M6: actions backed by the existing engines (docs/M6_PLAN.md)
// ---------------------------------------------------------------------------
//
// M6 ships four GET actions. They reuse existing `AgentActionKey` values so the
// usage governor's operation list (shared/agents/budget.ts) is unchanged, but
// their payloads follow the M3/M4/M5 contracts (shared/analysis, shared/graph,
// shared/rehearsal, shared/simulation) instead of the earlier sketches above:
//
//   find-recovery-risks   -> analyzeChange      (ChangeAnalysis)
//   get-service-readiness -> getReadinessGraph  (ReadinessGraph, keyed by change)
//   prepare-rehearsal     -> generateRehearsal  (preview only, nothing stored)
//   explain-outcome       -> stored audit record, verifyAuditRecord,
//                            decisionTrail, compareRetest (needs storage:app)
//
// `propose-remediation` and `list-open-recovery-gaps` are not part of M6.
// The earlier input/output types above stay exported for compatibility; for
// these four keys the M6 types below supersede them.

/** Actions in M6. Every one is `actionVerb: GET`. */
export type M6ActionKey = Extract<
  AgentActionKey,
  'find-recovery-risks' | 'get-service-readiness' | 'prepare-rehearsal' | 'explain-outcome'
>;

/** M6 actions also listed as `rovo:mcp` tools (read-only; no rehearsal preview). */
export type M6McpToolKey = Extract<
  M6ActionKey,
  'find-recovery-risks' | 'get-service-readiness' | 'explain-outcome'
>;

/** Upper bounds that keep action payloads small for Rovo chat. */
export interface M6PayloadLimits {
  /** Findings returned by `find-recovery-risks` (the rest are counted). */
  maxFindings: 10;
  /** Impact-path edges returned by `get-service-readiness`. */
  maxEdges: 40;
  /** Characters per excerpt; longer excerpts are cut, never rewritten. */
  maxExcerptChars: 500;
}

/**
 * Evidence as the agent sees it: a verbatim quote and where it came from. The
 * agent prompt allows claims only when they cite one of these by `id`.
 */
export interface ActionEvidenceQuote {
  id: string;
  kind: EvidenceReference['kind'];
  title: string;
  /** Verbatim excerpt, cut at `maxExcerptChars`; null when the source has no text. */
  excerpt: string | null;
  /** True when `excerpt` was cut. The cut is marked; the text is not changed. */
  truncated: boolean;
  /** Site-relative link (`/browse/…`, `/wiki/…`), or null. */
  path: string | null;
  retrievedAt: IsoDateTime | null;
}

/**
 * Deterministic sentence for the overall result, chosen from fixed templates
 * by the handler (never generated). The prompt tells the agent to quote it
 * first, so "not assessed" can never be worded as a pass.
 */
export interface ActionVerdict {
  kind: 'findings' | 'no-findings' | 'not-assessed';
  statement: string;
}

/**
 * What would raise a `suspected` finding to `confirmed`, derived from the
 * engine's `LinkBasis` rules (shared/analysis/types.ts), not from a model:
 * `confirmed` needs an explicit cross-reference (the runbook page mentions the
 * issue key, or the issue has a remote link to the page) plus a term match.
 */
export interface ConfirmationHint {
  /** Which cross-reference is missing. */
  missing: Extract<LinkBasis, 'page-mentions-issue' | 'issue-links-page'>[];
  /** Where a person would add or check it. */
  checkPaths: string[];
  /** Fixed template text, e.g. "Add a link from MC-62 to page … to confirm." */
  statement: string;
}

// find-recovery-risks (GET) -> analyzeChange --------------------------------

export interface ChangeRecoveryRisksInput {
  /** Jira issue key, e.g. MC-62. Defaults to `context.jira.issueKey`. */
  changeKey?: string;
}

export interface ChangeRecoveryRiskItem {
  findingId: string;
  confidence: 'confirmed' | 'suspected';
  pageTitle: string;
  pagePath: string | null;
  stepOrder: number;
  subject: { display: string; action: ChangeAction; replacement: string | null };
  basis: LinkBasis[];
  /** Deterministic template text from the engine. */
  explanation: string;
  /** Present for `suspected` findings only. */
  toConfirm: ConfirmationHint | null;
  /** At least the change excerpt and the runbook step. */
  evidence: ActionEvidenceQuote[];
}

export interface ChangeRecoveryRisksOutput extends ActionOutputBase {
  changeKey: string;
  change: { key: string; summary: string; browsePath: string };
  analyzedAt: IsoDateTime;
  status: AnalysisStatus;
  verdict: ActionVerdict;
  /** Set when `status` is `not-assessed`. */
  notAssessedReason: string | null;
  findings: ChangeRecoveryRiskItem[];
  /** Findings not returned because of `maxFindings`. */
  findingsOmitted: number;
  /** Exactly what was searched and read; "no findings" means only this coverage. */
  coverage: AnalysisCoverage;
  /** In-app path to the readiness check for this change. */
  appPath: string;
  /** Absolute link to the same page; null when the site or install is not verified. */
  appUrl: string | null;
}

// get-service-readiness (GET) -> getReadinessGraph ----------------------------

export interface ImpactPathInput {
  /** Jira issue key. Defaults to `context.jira.issueKey`. */
  changeKey?: string;
}

export interface ImpactPathEdge {
  kind: GraphEdgeKind;
  from: { id: string; kind: GraphNodeKind; label: string };
  to: { id: string; kind: GraphNodeKind; label: string };
  confidence: 'confirmed' | 'suspected';
  basis: string;
  source: SourceStatus['source'] | 'm3-analysis';
  evidence: ActionEvidenceQuote[];
}

export interface ImpactPathOutput extends ActionOutputBase {
  changeKey: string;
  builtAt: IsoDateTime;
  analysisStatus: AnalysisStatus;
  verdict: ActionVerdict;
  edges: ImpactPathEdge[];
  edgesOmitted: number;
  /** Links that could not be checked; reported as "not assessed", never healthy. */
  unassessed: UnassessedLink[];
  sources: SourceStatus[];
  appPath: string;
  /** Absolute link to the same page; null when the site or install is not verified. */
  appUrl: string | null;
}

// prepare-rehearsal (GET in M6) -> generateRehearsal, preview only ------------

export interface RehearsalPreviewInput {
  changeKey: string;
  findingId: string;
  /** Integer minutes; required, never defaulted (shared/rehearsal/types.ts). */
  restoreTargetMinutes: number;
  /** Integer minutes; the generator's default applies when omitted. */
  notifyTargetMinutes?: number;
}

export interface RehearsalPreviewOutput extends ActionOutputBase {
  changeKey: string;
  findingId: string;
  findingConfidence: 'confirmed' | 'suspected';
  scenarioId: string;
  scenarioVersion: number;
  /** `scenarioFingerprint` of the generated scenario, for later audit checks. */
  scenarioFingerprint: string;
  title: string;
  /** The scenario summary as generated (deterministic text). */
  briefing: string;
  objectives: { id: string; label: string }[];
  /** Always true: outcomes are rule-based models, not observations. */
  consequencesModelled: true;
  /** Always true: the agent cannot take rehearsal decisions; people do, in the app. */
  decisionsInAppOnly: true;
  evidence: ActionEvidenceQuote[];
  /** In-app path that regenerates the same rehearsal for participants. */
  rehearsalPath: string;
  /** Absolute link to the same rehearsal; null when the site or install is not verified. */
  appUrl: string | null;
}

// explain-outcome (GET) -> stored audit record ------------------------------

export interface RehearsalOutcomeInput {
  /** Opaque id of a stored run owned by, or shared with, the caller. */
  sessionId: string;
}

export interface RehearsalRetestSummary {
  originalSessionId: RetestComparison['originalSessionId'];
  findingId: RetestComparison['findingId'];
  outcome: RetestComparison['outcome'];
  /** Per-gap deterministic reasons from `compareRetest`. */
  gaps: { findingId: string; outcome: RetestComparison['outcome']; reason: string }[];
}

export interface RehearsalOutcomeOutput extends ActionOutputBase {
  sessionId: string;
  scenarioId: string;
  /** Always true on success: `verifyAuditRecord` passed. A failed check is NOT_ASSESSED. */
  auditVerified: true;
  status: 'completed' | 'in-progress';
  /** Present only for completed sessions; produced by `evaluateSession`. */
  objectives: ObjectiveResult[] | null;
  metCount: number | null;
  totalCount: number | null;
  elapsedMinutes: number;
  /** From `decisionTrail`, in order; narratives are authored, not generated. */
  trail: {
    stepTitle: string;
    decisionLabel: string;
    atMinute: number;
    assessment: 'effective' | 'neutral' | 'harmful';
    narrative: string;
    evidenceIds: string[];
  }[];
  /** Present when the run is a targeted retest. */
  retest: RehearsalRetestSummary | null;
  consequencesModelled: true;
  evidence: ActionEvidenceQuote[];
}

/** Input/output pairs for the M6 dispatcher. */
export interface M6ActionContracts {
  'find-recovery-risks': { input: ChangeRecoveryRisksInput; output: ChangeRecoveryRisksOutput };
  'get-service-readiness': { input: ImpactPathInput; output: ImpactPathOutput };
  'prepare-rehearsal': { input: RehearsalPreviewInput; output: RehearsalPreviewOutput };
  'explain-outcome': { input: RehearsalOutcomeInput; output: RehearsalOutcomeOutput };
}

export type M6ActionHandler<K extends M6ActionKey> = (
  payload: ActionPayload<M6ActionContracts[K]['input']>,
) => Promise<ActionResult<M6ActionContracts[K]['output']>>;
