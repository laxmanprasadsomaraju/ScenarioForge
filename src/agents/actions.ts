import type { ChangeAnalysis } from '../../shared/analysis/types';
import { FINDING_ID, MAX_FINDING_ID_LENGTH } from '../../shared/links/deepLink';
import type { CallOutcome, ReserveResult, UsageGovernor } from '../../shared/agents/budget';
import type { CacheInputValue, ResponseCache } from '../../shared/agents/cache';
import { evidenceFingerprint } from '../../shared/agents/cache';
import type {
  ActionFailure,
  ActionInvocationContext,
  ChangeRecoveryRisksOutput,
  ImpactPathOutput,
  M6ActionHandler,
  M6ActionKey,
  RehearsalOutcomeOutput,
  RehearsalPreviewOutput,
} from '../../shared/agents/contracts';
import type { ScannedSource } from '../../shared/agents/grounding';
import { detectSourceInstructions } from '../../shared/agents/grounding';
import type { EvidenceReference } from '../../shared/domain/types';
import type { ReadinessGraph } from '../../shared/graph/types';
import { generateRehearsal } from '../../shared/rehearsal/generate';
import { scenarioFingerprint } from '../../shared/simulation/replay';
import type { AnalysisEngine } from '../analysis/analyzeChange';
import { analyzeChange } from '../analysis/analyzeChange';
import type { ConfluenceGateway } from '../confluence/client';
import { getReadinessGraph } from '../graph/getReadinessGraph';
import type { JiraFieldGateway } from '../jira/affectedServices';
import type { JiraIssueGateway } from '../jira/client';
import { isIssueKey } from '../validation';
import type { HistoryReader, StoredRunOutcome } from './history';
import {
  PAYLOAD_LIMITS,
  USAGE_NOTE,
  analysisUnknowns,
  analysisVerdict,
  copyCoverage,
  graphUnknowns,
  graphVerdict,
  originOf,
  readinessAppPath,
  rehearsalAppPath,
  toImpactEdges,
  toQuote,
  toRiskItem,
} from './output';

/**
 * M6 Rovo action handlers (docs/M6_PLAN.md §3). Read-only, deterministic and
 * not registered in the manifest yet. Every dependency is injected so the
 * handlers run against test doubles.
 *
 * Pipeline for every action (§3.1):
 *   1. validate inputs                          → INVALID_INPUT, no spend
 *   2. identity: user accountId from context and a user-scoped (asUser)
 *      client; there is no app-level fallback  → IDENTITY_UNAVAILABLE, no spend
 *   3. permission: a single-issue read as the user (or the stored run's
 *      owner for explain-outcome)               → NOT_FOUND, no spend
 *   4. governor.checkAndReserve                  → USAGE_LIMITED (denied) or
 *                                                  GOVERNANCE_UNAVAILABLE (ledger
 *                                                  unreachable; fail closed)
 *   5. cache lookup; a hit releases the reservation
 *   6. run the engine (user-scoped reads only)
 *   7. settle: succeeded / not-called / failed-unknown; cache only fully
 *      assessed results
 *
 * A budget denial is never NOT_ASSESSED: that would read like an analysis
 * result. Source text is returned verbatim as data, with `sourceWarnings` for
 * text addressed to an AI; it is never followed.
 */

/** Jira and Confluence clients that act as one user (Forge `asUser()`). */
export interface UserScopedGateways {
  jira: JiraIssueGateway & JiraFieldGateway;
  confluence: ConfluenceGateway;
}

export interface UserIdentity {
  /** From the invocation context, never from action inputs. */
  accountId: string;
}

/**
 * Builds user-scoped gateways for `identity`. Returns null (or throws) when no
 * user-scoped client can be made. There is deliberately no app-scoped
 * (`asApp`) variant anywhere in these dependencies.
 */
export type UserGatewayFactory = (identity: UserIdentity) => UserScopedGateways | null;

export type ActionGovernor = Pick<UsageGovernor, 'checkAndReserve' | 'release' | 'settle'>;

export type ActionSuccess =
  | ({ ok: true } & ChangeRecoveryRisksOutput)
  | ({ ok: true } & ImpactPathOutput)
  | ({ ok: true } & RehearsalPreviewOutput)
  | ({ ok: true } & RehearsalOutcomeOutput);

export type ActionCache = Pick<ResponseCache<ActionSuccess>, 'get' | 'put'>;

export interface AgentActionDeps {
  /** The only route to Jira and Confluence: user-scoped, keyed by accountId. */
  userGateways: UserGatewayFactory;
  engine: AnalysisEngine;
  governor: ActionGovernor;
  cache: ActionCache;
  history: HistoryReader;
  now: () => Date;
}

export type AgentActions = { [K in M6ActionKey]: M6ActionHandler<K> };

// Messages ---------------------------------------------------------------------

export const MESSAGES = {
  changeKey: 'changeKey must be a Jira issue key such as MC-62.',
  findingId:
    'findingId must be a finding id returned by find-recovery-risks for the same change, such as MC-62:98305:3:legacyauth.',
  restoreTarget:
    'restoreTargetMinutes is required: a whole number of minutes from 5 to 1440. It is never assumed.',
  notifyTarget: 'notifyTargetMinutes must be a whole number of minutes from 1 to 240.',
  sessionId: 'sessionId must be a rehearsal session id (letters, digits, - or _).',
  noIdentity:
    'ScenarioForge could not identify the signed-in user, so it read nothing. It never falls back to app-level access.',
  noUserClient:
    'ScenarioForge could not act as the signed-in user, so it read nothing. It never falls back to app-level access.',
  notFound: (key: string) =>
    `Issue ${key} was not found, or you do not have permission to view it.`,
  sessionNotFound: 'That rehearsal was not found, or you do not have access to it.',
  jiraUnreachable: 'ScenarioForge could not reach Jira. Try again shortly.',
  historyUnreachable: 'ScenarioForge could not read rehearsal history. Try again shortly.',
  auditFailed:
    'Not assessed: the stored rehearsal did not pass its audit check, so its outcome is not reported.',
  trailUngrounded:
    'Not assessed: the stored rehearsal cites evidence that was not stored with it, so its outcome is not reported.',
  usageLimited: (detail: string) =>
    `ScenarioForge's usage limit stopped this action, so nothing was assessed. ${detail}`,
  governanceUnavailable:
    'ScenarioForge could not check its usage limits, so it did not run this action and nothing was assessed. This is not a usage limit; try again later.',
  failedUnknown:
    'Not assessed: ScenarioForge could not complete the check, so no result is reported.',
  unexpected: 'ScenarioForge could not complete this action. Try again shortly.',
} as const;

function fail(
  code: ActionFailure['code'],
  message: string,
  retryAfterSeconds?: number,
): ActionFailure {
  return {
    ok: false,
    code,
    message,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    usageNote: USAGE_NOTE,
  };
}

// Input validation --------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; failure: ActionFailure };

const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
/** `{changeKey}:{pageId}:{stepOrder}:{term}` as built by shared/analysis/engine.ts. */
/** Opaque run id: a UUID or `session-…`; never interpreted. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function contextOf(record: Record<string, unknown>): ActionInvocationContext {
  return asRecord(record.context) as ActionInvocationContext;
}

function invalid<T>(message: string): Parsed<T> {
  return { ok: false, failure: fail('INVALID_INPUT', message) };
}

/** `changeKey` from inputs, else (when allowed) the issue in context. */
function parseChangeKey(record: Record<string, unknown>, useContext: boolean): Parsed<string> {
  const given = record.changeKey;
  const value =
    (given === undefined || given === null || given === '') && useContext
      ? contextOf(record).jira?.issueKey
      : given;
  return isIssueKey(value) ? { ok: true, value } : invalid(MESSAGES.changeKey);
}

function parseInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

interface RehearsalInputs {
  changeKey: string;
  findingId: string;
  restoreTargetMinutes: number;
  notifyTargetMinutes?: number;
}

function parseRehearsalInputs(record: Record<string, unknown>): Parsed<RehearsalInputs> {
  const changeKey = parseChangeKey(record, false);
  if (!changeKey.ok) return changeKey;
  const findingId = record.findingId;
  const match =
    typeof findingId === 'string' && findingId.length <= MAX_FINDING_ID_LENGTH
      ? FINDING_ID.exec(findingId)
      : null;
  if (!match || match[1] !== changeKey.value) return invalid(MESSAGES.findingId);
  const restore = parseInteger(record.restoreTargetMinutes, 5, 1440);
  if (restore === null) return invalid(MESSAGES.restoreTarget);
  let notify: number | undefined;
  if (record.notifyTargetMinutes !== undefined && record.notifyTargetMinutes !== null) {
    const parsed = parseInteger(record.notifyTargetMinutes, 1, 240);
    if (parsed === null) return invalid(MESSAGES.notifyTarget);
    notify = parsed;
  }
  return {
    ok: true,
    value: {
      changeKey: changeKey.value,
      findingId: match[0],
      restoreTargetMinutes: restore,
      ...(notify !== undefined ? { notifyTargetMinutes: notify } : {}),
    },
  };
}

function parseSessionId(record: Record<string, unknown>): Parsed<string> {
  const value = record.sessionId;
  return typeof value === 'string' && SESSION_ID.test(value)
    ? { ok: true, value }
    : invalid(MESSAGES.sessionId);
}

// Identity and permission -------------------------------------------------------

/** accountId comes only from the invocation context, never from inputs. */
function identityOf(record: Record<string, unknown>): Parsed<UserIdentity> {
  const accountId = contextOf(record).accountId;
  return typeof accountId === 'string' && ACCOUNT_ID.test(accountId)
    ? { ok: true, value: { accountId } }
    : { ok: false, failure: fail('IDENTITY_UNAVAILABLE', MESSAGES.noIdentity) };
}

function userGatewaysFor(
  deps: AgentActionDeps,
  identity: UserIdentity,
): Parsed<UserScopedGateways> {
  let gateways: UserScopedGateways | null;
  try {
    gateways = deps.userGateways({ accountId: identity.accountId });
  } catch {
    gateways = null;
  }
  return gateways
    ? { ok: true, value: gateways }
    : { ok: false, failure: fail('IDENTITY_UNAVAILABLE', MESSAGES.noUserClient) };
}

/**
 * One free single-issue read as the user (`read:jira-work`), before any spend.
 * Also returns `updated` for the cache fingerprint.
 */
async function checkIssueAccess(
  gateways: UserScopedGateways,
  changeKey: string,
): Promise<Parsed<{ updated: string }>> {
  try {
    const response = await gateways.jira.getIssue(
      changeKey,
      new URLSearchParams({ fields: 'summary,updated' }),
    );
    if (response.status === 401) {
      return { ok: false, failure: fail('IDENTITY_UNAVAILABLE', MESSAGES.noUserClient) };
    }
    if (response.status === 403 || response.status === 404) {
      return { ok: false, failure: fail('NOT_FOUND', MESSAGES.notFound(changeKey)) };
    }
    if (!response.ok) {
      return { ok: false, failure: fail('UPSTREAM_ERROR', MESSAGES.jiraUnreachable) };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const updated = asRecord(asRecord(body).fields).updated;
    return { ok: true, value: { updated: typeof updated === 'string' ? updated : '' } };
  } catch {
    return { ok: false, failure: fail('UPSTREAM_ERROR', MESSAGES.jiraUnreachable) };
  }
}

// Governed execution --------------------------------------------------------------

type RunResult<T extends ActionSuccess> =
  | { kind: 'output'; output: T; cacheable: boolean }
  | { kind: 'failure'; failure: ActionFailure; outcome: CallOutcome };

interface GovernedCall<T extends ActionSuccess> {
  operation: M6ActionKey;
  accountId: string;
  cacheInputs: Record<string, CacheInputValue>;
  evidenceVersions: { id: string; version?: string | number }[];
  run: () => Promise<RunResult<T>>;
}

/**
 * Maps a governor denial. Only a reliable time from the governor becomes
 * `retryAfterSeconds` (rate-limit window, or the calendar reset of a cap);
 * DISABLED never has one. UNAVAILABLE is a distinct failure (fail closed).
 */
export function denialToFailure(denial: Extract<ReserveResult, { ok: false }>): ActionFailure {
  switch (denial.reason) {
    case 'UNAVAILABLE':
      return fail('GOVERNANCE_UNAVAILABLE', MESSAGES.governanceUnavailable);
    case 'INVALID':
      return fail('INVALID_INPUT', denial.message);
    case 'DISABLED':
      return fail('USAGE_LIMITED', MESSAGES.usageLimited(denial.message));
    case 'BUDGET_EXHAUSTED':
    case 'RATE_LIMITED': {
      const retry = denial.retryAfterSeconds;
      const reliable = typeof retry === 'number' && Number.isInteger(retry) && retry > 0;
      return fail(
        'USAGE_LIMITED',
        MESSAGES.usageLimited(denial.message),
        reliable ? retry : undefined,
      );
    }
  }
}

// Ids and text stay out of logs; an unsettled reservation is charged at its estimate.

async function governed<T extends ActionSuccess>(
  deps: AgentActionDeps,
  call: GovernedCall<T>,
): Promise<T | ActionFailure> {
  let reservation: ReserveResult;
  try {
    reservation = await deps.governor.checkAndReserve({
      operation: call.operation,
      accountId: call.accountId,
    });
  } catch {
    return fail('GOVERNANCE_UNAVAILABLE', MESSAGES.governanceUnavailable);
  }
  if (!reservation.ok) return denialToFailure(reservation);
  const { reservationId } = reservation;

  const settle = async (outcome: CallOutcome) => {
    try {
      const settled = await deps.governor.settle(reservationId, outcome);
      if (!settled.ok) logSettleProblem('settle failed');
    } catch {
      logSettleProblem('settle threw');
    }
  };

  const cacheKey = {
    operation: call.operation,
    scope: call.accountId,
    inputs: call.cacheInputs,
    evidenceFingerprint: evidenceFingerprint(call.evidenceVersions),
  };
  try {
    const cached = await deps.cache.get(cacheKey);
    if (cached.hit) {
      try {
        const released = await deps.governor.release(reservationId);
        if (!released.ok) logSettleProblem('release failed');
      } catch {
        logSettleProblem('release threw');
      }
      return cached.value as T;
    }
  } catch {
    // A cache error is a miss; the reservation stands for the real call.
  }

  let result: RunResult<T>;
  try {
    result = await call.run();
  } catch (error) {
    console.error('Action failed', error instanceof Error ? error.name : 'unknown');
    await settle({ kind: 'failed-unknown' });
    return fail('NOT_ASSESSED', MESSAGES.failedUnknown);
  }

  if (result.kind === 'failure') {
    await settle(result.outcome);
    return result.failure;
  }
  await settle({ kind: 'succeeded' });
  if (result.cacheable) {
    try {
      await deps.cache.put(cacheKey, result.output, [...evidenceIdsOf(result.output)]);
    } catch {
      // Not caching only costs a repeat call later.
    }
  }
  return result.output;
}

function evidenceIdsOf(output: ActionSuccess): Set<string> {
  const ids = new Set<string>();
  if ('findings' in output) {
    output.findings.forEach((f) => f.evidence.forEach((e) => ids.add(e.id)));
  }
  if ('edges' in output) output.edges.forEach((e) => e.evidence.forEach((q) => ids.add(q.id)));
  if ('evidence' in output) output.evidence.forEach((e) => ids.add(e.id));
  return ids;
}

/** Source text that is returned: evidence titles and full excerpts (before any cut). */
function evidenceSources(evidence: readonly EvidenceReference[]): ScannedSource[] {
  return evidence.map((e) => ({ evidenceId: e.id, texts: [e.title, e.excerpt] }));
}

/** Not found, not permitted, or not assessable after the call: never a guess. */
function upstreamToFailure(error: { code: string; message: string }): ActionFailure {
  if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') {
    return fail('NOT_FOUND', error.message);
  }
  if (error.code === 'UNAUTHENTICATED') {
    return fail('IDENTITY_UNAVAILABLE', MESSAGES.noUserClient);
  }
  return fail('NOT_ASSESSED', `Not assessed: ${error.message}`);
}

// Output builders ------------------------------------------------------------------

function risksOutput(
  analysis: ChangeAnalysis,
  now: Date,
): { ok: true } & ChangeRecoveryRisksOutput {
  const shown = analysis.findings.slice(0, PAYLOAD_LIMITS.maxFindings);
  const evidence = shown.flatMap((f) => f.evidence);
  const unknowns = analysisUnknowns(analysis);
  return {
    ok: true,
    origin: originOf(evidence),
    generatedAt: now.toISOString(),
    unknowns,
    sourceWarnings: detectSourceInstructions([
      { evidenceId: `jira-issue:${analysis.change.key}`, texts: [analysis.change.summary] },
      ...analysis.coverage.pagesChecked.map((p) => ({
        evidenceId: `confluence-page:${p.pageId}`,
        texts: [p.title],
      })),
      ...evidenceSources(evidence),
    ]),
    usageNote: USAGE_NOTE,
    changeKey: analysis.changeKey,
    change: { ...analysis.change },
    analyzedAt: analysis.analyzedAt,
    status: analysis.status,
    verdict: analysisVerdict(analysis),
    notAssessedReason:
      analysis.status === 'not-assessed' ? (analysis.notAssessedReason ?? null) : null,
    findings: shown.map((f) => toRiskItem(f, analysis.change.browsePath)),
    findingsOmitted: analysis.findings.length - shown.length,
    coverage: copyCoverage(analysis.coverage),
    appPath: readinessAppPath(analysis.changeKey),
    appUrl: null,
  };
}

function impactOutput(graph: ReadinessGraph, now: Date): { ok: true } & ImpactPathOutput {
  const all = toImpactEdges(graph);
  const edges = all.slice(0, PAYLOAD_LIMITS.maxEdges);
  const shownIds = new Set(edges.flatMap((e) => e.evidence.map((q) => q.id)));
  const rawEvidence = graph.edges.flatMap((e) => e.evidence).filter((e) => shownIds.has(e.id));
  const labelled = new Map<string, string>();
  edges.forEach((e) => {
    labelled.set(e.from.id, e.from.label);
    labelled.set(e.to.id, e.to.label);
  });
  return {
    ok: true,
    origin: originOf(rawEvidence),
    generatedAt: now.toISOString(),
    unknowns: graphUnknowns(graph),
    sourceWarnings: detectSourceInstructions([
      ...[...labelled].map(([id, label]) => ({ evidenceId: id, texts: [label] })),
      ...evidenceSources(rawEvidence),
    ]),
    usageNote: USAGE_NOTE,
    changeKey: graph.changeKey,
    builtAt: graph.builtAt,
    analysisStatus: graph.analysis.status,
    verdict: graphVerdict(graph),
    edges,
    edgesOmitted: all.length - edges.length,
    unassessed: graph.unassessed.map((u) => ({ ...u })),
    sources: graph.sources.map((s) => ({ ...s })),
    appPath: readinessAppPath(graph.changeKey),
    appUrl: null,
  };
}

function outcomeOutput(run: StoredRunOutcome, now: Date): { ok: true } & RehearsalOutcomeOutput {
  const unknowns =
    run.status === 'in-progress'
      ? ['The rehearsal is still in progress; objectives are not assessed.']
      : [];
  return {
    ok: true,
    origin: originOf(run.evidence),
    generatedAt: now.toISOString(),
    unknowns,
    sourceWarnings: detectSourceInstructions([
      ...run.trail.map((t, index) => ({
        evidenceId: t.evidenceIds[0] ?? `trail:${index}`,
        texts: [t.stepTitle, t.decisionLabel, t.narrative],
      })),
      ...evidenceSources(run.evidence),
    ]),
    usageNote: USAGE_NOTE,
    sessionId: run.sessionId,
    scenarioId: run.scenarioId,
    auditVerified: true,
    status: run.status,
    objectives:
      run.status === 'completed' ? (run.objectives?.map((o) => ({ ...o })) ?? null) : null,
    metCount: run.status === 'completed' ? run.metCount : null,
    totalCount: run.status === 'completed' ? run.totalCount : null,
    elapsedMinutes: run.elapsedMinutes,
    trail: run.trail.map((t) => ({ ...t, evidenceIds: [...t.evidenceIds] })),
    retest: run.retest ? { ...run.retest, gaps: run.retest.gaps.map((g) => ({ ...g })) } : null,
    consequencesModelled: true,
    evidence: run.evidence.map(toQuote),
  };
}

// Handlers ---------------------------------------------------------------------------

type Payload<K extends M6ActionKey> = Parameters<M6ActionHandler<K>>[0];
type Result<K extends M6ActionKey> = Awaited<ReturnType<M6ActionHandler<K>>>;

/** Never throws: an unexpected error becomes a failure result. */
function safely<K extends M6ActionKey>(
  work: (record: Record<string, unknown>) => Promise<Result<K>>,
): M6ActionHandler<K> {
  return async (payload: Payload<K>) => {
    try {
      return await work(asRecord(payload));
    } catch (error) {
      console.error('Action handler failed', error instanceof Error ? error.name : 'unknown');
      return fail('UPSTREAM_ERROR', MESSAGES.unexpected);
    }
  };
}

/** Steps 2–3 for actions that read Jira and Confluence. */
async function userAccess(
  deps: AgentActionDeps,
  record: Record<string, unknown>,
  changeKey: string,
): Promise<Parsed<{ accountId: string; gateways: UserScopedGateways; updated: string }>> {
  const identity = identityOf(record);
  if (!identity.ok) return identity;
  const gateways = userGatewaysFor(deps, identity.value);
  if (!gateways.ok) return gateways;
  const access = await checkIssueAccess(gateways.value, changeKey);
  if (!access.ok) return access;
  return {
    ok: true,
    value: {
      accountId: identity.value.accountId,
      gateways: gateways.value,
      updated: access.value.updated,
    },
  };
}

export function createAgentActions(deps: AgentActionDeps): AgentActions {
  const engineDeps = (gateways: UserScopedGateways) => ({
    jira: gateways.jira,
    confluence: gateways.confluence,
    engine: deps.engine,
    now: deps.now,
  });

  const findRecoveryRisks = safely<'find-recovery-risks'>(async (record) => {
    const changeKey = parseChangeKey(record, true);
    if (!changeKey.ok) return changeKey.failure;
    const access = await userAccess(deps, record, changeKey.value);
    if (!access.ok) return access.failure;
    const { accountId, gateways, updated } = access.value;

    return governed(deps, {
      operation: 'find-recovery-risks',
      accountId,
      cacheInputs: { changeKey: changeKey.value },
      evidenceVersions: [{ id: changeKey.value, version: updated }],
      run: async () => {
        const analysis = await analyzeChange(engineDeps(gateways), {
          issueKey: changeKey.value,
        });
        if (!analysis.ok) {
          return {
            kind: 'failure',
            failure: upstreamToFailure(analysis.error),
            outcome: { kind: 'failed-unknown' },
          };
        }
        const output = risksOutput(analysis.data, deps.now());
        return {
          kind: 'output',
          output,
          cacheable: output.status !== 'not-assessed' && output.unknowns.length === 0,
        };
      },
    });
  });

  const getServiceReadiness = safely<'get-service-readiness'>(async (record) => {
    const changeKey = parseChangeKey(record, true);
    if (!changeKey.ok) return changeKey.failure;
    const access = await userAccess(deps, record, changeKey.value);
    if (!access.ok) return access.failure;
    const { accountId, gateways, updated } = access.value;

    return governed(deps, {
      operation: 'get-service-readiness',
      accountId,
      cacheInputs: { changeKey: changeKey.value },
      evidenceVersions: [{ id: changeKey.value, version: updated }],
      run: async () => {
        const graph = await getReadinessGraph(engineDeps(gateways), {
          issueKey: changeKey.value,
        });
        if (!graph.ok) {
          return {
            kind: 'failure',
            failure: upstreamToFailure(graph.error),
            outcome: { kind: 'failed-unknown' },
          };
        }
        const output = impactOutput(graph.data, deps.now());
        return {
          kind: 'output',
          output,
          cacheable: output.analysisStatus !== 'not-assessed' && output.unknowns.length === 0,
        };
      },
    });
  });

  /** Preview only: nothing is stored, and the same inputs give the same scenario. */
  const prepareRehearsal = safely<'prepare-rehearsal'>(async (record) => {
    const inputs = parseRehearsalInputs(record);
    if (!inputs.ok) return inputs.failure;
    const { changeKey, findingId, restoreTargetMinutes, notifyTargetMinutes } = inputs.value;
    const access = await userAccess(deps, record, changeKey);
    if (!access.ok) return access.failure;
    const { accountId, gateways, updated } = access.value;

    return governed(deps, {
      operation: 'prepare-rehearsal',
      accountId,
      cacheInputs: { changeKey, findingId, restoreTargetMinutes, notifyTargetMinutes },
      evidenceVersions: [{ id: changeKey, version: updated }],
      run: async () => {
        const analysis = await analyzeChange(engineDeps(gateways), { issueKey: changeKey });
        if (!analysis.ok) {
          return {
            kind: 'failure',
            failure: upstreamToFailure(analysis.error),
            outcome: { kind: 'failed-unknown' },
          };
        }
        // The analysis completed; any outcome from here is definite, so it is charged.
        const done: CallOutcome = { kind: 'succeeded' };
        if (analysis.data.status === 'not-assessed') {
          return {
            kind: 'failure',
            failure: fail(
              'NOT_ASSESSED',
              `Not assessed: ${analysis.data.notAssessedReason ?? 'the change could not be assessed.'}`,
            ),
            outcome: done,
          };
        }
        const generated = generateRehearsal({
          analysis: analysis.data,
          findingId,
          restoreTargetMinutes,
          ...(notifyTargetMinutes !== undefined ? { notifyTargetMinutes } : {}),
        });
        if (!generated.ok) {
          const code =
            generated.error === 'FINDING_NOT_FOUND'
              ? 'NOT_FOUND'
              : generated.error === 'INVALID_TARGET'
                ? 'INVALID_INPUT'
                : 'NOT_ASSESSED';
          const message =
            code === 'NOT_ASSESSED' ? `Not assessed: ${generated.message}` : generated.message;
          return { kind: 'failure', failure: fail(code, message), outcome: done };
        }
        const { scenario, provenance } = generated.rehearsal;
        const unknowns = analysisUnknowns(analysis.data);
        const output: { ok: true } & RehearsalPreviewOutput = {
          ok: true,
          origin: scenario.origin,
          generatedAt: deps.now().toISOString(),
          unknowns,
          sourceWarnings: detectSourceInstructions([
            { evidenceId: scenario.id, texts: [scenario.title, scenario.summary] },
            ...evidenceSources(scenario.evidence),
          ]),
          usageNote: USAGE_NOTE,
          changeKey: provenance.changeKey,
          findingId: provenance.findingId,
          findingConfidence: provenance.confidence,
          scenarioId: scenario.id,
          scenarioVersion: scenario.version,
          scenarioFingerprint: scenarioFingerprint(scenario),
          title: scenario.title,
          briefing: scenario.summary,
          objectives: scenario.objectives.map((o) => ({ id: o.id, label: o.label })),
          consequencesModelled: true,
          decisionsInAppOnly: true,
          evidence: scenario.evidence.map(toQuote),
          rehearsalPath: rehearsalAppPath(inputs.value),
          appUrl: null,
        };
        return { kind: 'output', output, cacheable: unknowns.length === 0 };
      },
    });
  });

  const explainOutcome = safely<'explain-outcome'>(async (record) => {
    const sessionId = parseSessionId(record);
    if (!sessionId.ok) return sessionId.failure;
    const identity = identityOf(record);
    if (!identity.ok) return identity.failure;
    const { accountId } = identity.value;

    let lookup: Awaited<ReturnType<HistoryReader['getRun']>>;
    try {
      lookup = await deps.history.getRun(accountId, sessionId.value);
    } catch {
      lookup = { status: 'unavailable' };
    }
    if (lookup.status === 'unavailable') return fail('UPSTREAM_ERROR', MESSAGES.historyUnreachable);
    // Someone else's run looks exactly like a missing one: no existence leak.
    if (
      lookup.status === 'not-found' ||
      lookup.run.ownerAccountId !== accountId ||
      lookup.run.sessionId !== sessionId.value
    ) {
      return fail('NOT_FOUND', MESSAGES.sessionNotFound);
    }
    const run = lookup.run;
    if (run.auditVerified !== true) return fail('NOT_ASSESSED', MESSAGES.auditFailed);
    const stored = new Set(run.evidence.map((e) => e.id));
    if (!run.trail.every((t) => t.evidenceIds.every((id) => stored.has(id)))) {
      return fail('NOT_ASSESSED', MESSAGES.trailUngrounded);
    }

    return governed(deps, {
      operation: 'explain-outcome',
      accountId,
      cacheInputs: { sessionId: sessionId.value },
      evidenceVersions: [{ id: `run:${run.sessionId}`, version: run.version }],
      run: async () => {
        const output = outcomeOutput(run, deps.now());
        return { kind: 'output', output, cacheable: output.unknowns.length === 0 };
      },
    });
  });

  return {
    'find-recovery-risks': findRecoveryRisks,
    'get-service-readiness': getServiceReadiness,
    'prepare-rehearsal': prepareRehearsal,
    'explain-outcome': explainOutcome,
  };
}
