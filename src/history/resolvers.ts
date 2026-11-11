import type {
  ApiResult,
  GetRehearsalRunResponse,
  GetRetestComparisonResponse,
  HistoryGate,
  ListRehearsalHistoryResponse,
  RehearsalSourceRef,
  RehearsalSubmission,
  SaveRehearsalResponse,
} from '../../shared/api';
import { HISTORY_NOT_ENABLED, rehearsalContentFingerprint } from '../../shared/api';
import type { StorageAdapter } from '../../shared/agents/storage';
import type { ExerciseEvaluation, SimulationScenario } from '../../shared/domain/types';
import { HistoryStore } from '../../shared/history';
import type { HistoryUser, RunSubmission, SaveResult, TrustedScenario } from '../../shared/history';
import { generateRehearsal } from '../../shared/rehearsal/generate';
import { SimulationError } from '../../shared/simulation/engine';
import { replaySession, scenarioFingerprint } from '../../shared/simulation/replay';
import { buildRetest } from '../../shared/simulation/retest';
import { authBackupRetiredScenario } from '../../shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation } from '../../shared/simulation/scenarios/authBackupRetiredRemediation';
import type { AnalysisEngine } from '../analysis/analyzeChange';
import { analyzeChange } from '../analysis/analyzeChange';
import type { ConfluenceGateway } from '../confluence/client';
import type { JiraIssueGateway } from '../jira/client';
import { isIssueKey } from '../validation';

/**
 * Rehearsal history resolvers (docs/M6_PLAN.md §6, D19).
 *
 * Trust model:
 * - The user is `{ installation: context.installContext, accountId:
 *   context.accountId }`. Neither is ever read from the payload; a context
 *   without them gets IDENTITY_UNAVAILABLE and nothing is read or written.
 * - Storage comes from `historyStorage()`. `null` (storage:app not granted)
 *   means every resolver answers UNAVAILABLE with HISTORY_NOT_ENABLED, before
 *   any Jira or Confluence call.
 * - saveRehearsalRun never accepts a scenario. A generated rehearsal is
 *   rebuilt here with analyzeChange + generateRehearsal as the user; the demo
 *   is a fixed authored id. The browser's decisions are replayed by
 *   HistoryStore against that trusted scenario, and any claimed evaluation or
 *   flags that differ are rejected.
 * - Retests are rebuilt from the stored, re-verified original run.
 * - Reads re-check (as the user) that the change is still visible before a
 *   record holding quoted Jira and Confluence text is returned (§6.3).
 *   Tampered or unverifiable records are reported by status only.
 */

export interface HistoryResolverDeps {
  /** Storage for history; null while `storage:app` is not granted. */
  historyStorage: () => StorageAdapter | null;
  /** Jira and Confluence as the calling user (Forge `asUser()`). */
  jira: JiraIssueGateway;
  confluence: ConfluenceGateway;
  engine: AnalysisEngine;
  now?: () => Date;
}

export interface ResolverRequest {
  payload?: unknown;
  context?: unknown;
}

export const HISTORY_MESSAGES = {
  noIdentity: 'Your Atlassian account could not be identified, so history is not available.',
  storageUnreachable: 'History storage could not be reached. Try again shortly.',
  changed: 'The change or runbook changed since this rehearsal started.',
  noLongerVisible: (key: string) =>
    `You can no longer view ${key} in Jira, so this rehearsal cannot be saved.`,
} as const;

/** Demo scenarios the server accepts by id. Nothing else is accepted without regeneration. */
const DEMO_SCENARIOS: Record<string, TrustedScenario> = {
  [authBackupRetiredScenario.id]: {
    scenario: authBackupRetiredScenario,
    remediation: authBackupRetiredRemediation,
    provenance: null,
  },
};

// Input limits ---------------------------------------------------------------

const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_INSTALLATION_LENGTH = 128;
/** Same opaque run id as the M6 actions: a UUID or `session-…`. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
/** `{changeKey}:{pageId}:{stepOrder}:{term}` as built by shared/analysis/engine.ts. */
const FINDING_ID = /^([A-Z][A-Z0-9_]*-\d+):(\d{1,19}):(\d{1,4}):([a-z0-9]{1,40})$/;
const MAX_FINDING_ID_LENGTH = 160;
const DEMO_ID = /^[a-z0-9-]{1,64}$/;
const DECISION_ID = /^[A-Za-z0-9:._-]{1,80}$/;
const REMEDIATION_ID = /^[A-Za-z0-9:._-]{1,80}$/;
const FLAG_NAME = /^[A-Za-z0-9:._-]{1,64}$/;
const FINGERPRINT = /^[0-9a-f]{16}$/;
export const MAX_DECISIONS = 50;
export const MAX_REMEDIATIONS = 10;
const MAX_FLAGS = 32;
const MAX_OBJECTIVES = 20;
const MAX_TIMESTAMP_LENGTH = 40;
/** Generous bound on the evaluation the browser sends; it is only compared, never stored. */
const MAX_EVALUATION_CHARS = 16 * 1024;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const invalid = <T>(message: string): Parsed<T> => ({ ok: false, message });

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    !Number.isNaN(Date.parse(value))
  );
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

function parseIdList(
  value: unknown,
  pattern: RegExp,
  max: number,
  what: string,
  allowEmpty: boolean,
): Parsed<string[]> {
  if (!Array.isArray(value)) return invalid(`${what} must be a list.`);
  if (value.length > max) return invalid(`${what} may hold at most ${max} entries.`);
  if (!allowEmpty && value.length === 0) return invalid(`${what} must not be empty.`);
  if (!value.every((id) => typeof id === 'string' && pattern.test(id))) {
    return invalid(`${what} contains an invalid id.`);
  }
  if (new Set(value).size !== value.length) return invalid(`${what} contains duplicates.`);
  return { ok: true, value: [...(value as string[])] };
}

function parseSubmission(value: unknown): Parsed<RehearsalSubmission> {
  const record = asRecord(value);
  if (!record) return invalid('submission is required.');
  if (!isSessionId(record.sessionId)) {
    return invalid('submission.sessionId must be 8 to 64 letters, digits, - or _.');
  }
  if (!isTimestamp(record.startedAt)) return invalid('submission.startedAt must be a timestamp.');
  const decisions = parseIdList(
    record.decisionIds,
    DECISION_ID,
    MAX_DECISIONS,
    'submission.decisionIds',
    false,
  );
  if (!decisions.ok) return decisions;
  if (
    typeof record.contentFingerprint !== 'string' ||
    !FINGERPRINT.test(record.contentFingerprint)
  ) {
    return invalid('submission.contentFingerprint must be 16 hex characters.');
  }
  const flags = asRecord(record.flags);
  if (
    !flags ||
    Object.keys(flags).length > MAX_FLAGS ||
    !Object.entries(flags).every(([k, v]) => FLAG_NAME.test(k) && isIntegerIn(v, 0, 100_000))
  ) {
    return invalid('submission.flags must map flag names to minutes.');
  }
  const evaluation = asRecord(record.evaluation);
  if (
    !evaluation ||
    !Array.isArray(evaluation.objectives) ||
    evaluation.objectives.length > MAX_OBJECTIVES ||
    JSON.stringify(evaluation).length > MAX_EVALUATION_CHARS
  ) {
    return invalid('submission.evaluation is malformed.');
  }
  return {
    ok: true,
    value: {
      sessionId: record.sessionId,
      startedAt: record.startedAt,
      decisionIds: decisions.value,
      contentFingerprint: record.contentFingerprint,
      evaluation: evaluation as unknown as ExerciseEvaluation,
      flags: { ...(flags as Record<string, number>) },
    },
  };
}

export function parseSource(value: unknown): Parsed<RehearsalSourceRef> {
  const record = asRecord(value);
  if (!record) return invalid('source is required.');
  if (record.kind === 'demo') {
    if (typeof record.scenarioId !== 'string' || !DEMO_ID.test(record.scenarioId)) {
      return invalid('source.scenarioId is not a demo scenario.');
    }
    if (!Object.hasOwn(DEMO_SCENARIOS, record.scenarioId)) {
      return invalid('source.scenarioId is not a demo scenario.');
    }
    return { ok: true, value: { kind: 'demo', scenarioId: record.scenarioId } };
  }
  if (record.kind === 'generated') {
    if (!isIssueKey(record.changeKey)) return invalid('source.changeKey must be a Jira issue key.');
    const findingId = record.findingId;
    const match =
      typeof findingId === 'string' && findingId.length <= MAX_FINDING_ID_LENGTH
        ? FINDING_ID.exec(findingId)
        : null;
    if (!match || match[1] !== record.changeKey) {
      return invalid('source.findingId must be a finding of source.changeKey.');
    }
    if (!isIntegerIn(record.restoreTargetMinutes, 5, 1440)) {
      return invalid('source.restoreTargetMinutes must be a whole number from 5 to 1440.');
    }
    if (!isIntegerIn(record.notifyTargetMinutes, 1, 240)) {
      return invalid('source.notifyTargetMinutes must be a whole number from 1 to 240.');
    }
    return {
      ok: true,
      value: {
        kind: 'generated',
        changeKey: record.changeKey,
        findingId: findingId as string,
        restoreTargetMinutes: record.restoreTargetMinutes,
        notifyTargetMinutes: record.notifyTargetMinutes,
      },
    };
  }
  return invalid("source.kind must be 'demo' or 'generated'.");
}

// Identity ---------------------------------------------------------------------

/** The caller, from the Forge invocation context only. */
export function historyUserOf(context: unknown): HistoryUser | null {
  const record = asRecord(context);
  if (!record) return null;
  const { installContext, accountId } = record;
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) return null;
  if (
    typeof installContext !== 'string' ||
    installContext.trim().length === 0 ||
    installContext.length > MAX_INSTALLATION_LENGTH
  ) {
    return null;
  }
  return { installation: installContext, accountId };
}

// Resolvers --------------------------------------------------------------------

type Gated =
  { ok: true; user: HistoryUser; store: HistoryStore } | { ok: false; gate: HistoryGate };

const notEnabled: HistoryGate = { status: 'UNAVAILABLE', detail: HISTORY_NOT_ENABLED };
const unreachable: HistoryGate = {
  status: 'UNAVAILABLE',
  detail: HISTORY_MESSAGES.storageUnreachable,
};

function invalidRequest<T>(message: string): ApiResult<T> {
  return { ok: false, error: { code: 'INVALID_REQUEST', message } };
}

const data = <T>(value: T): ApiResult<T> => ({ ok: true, data: value });

export function createHistoryResolvers(deps: HistoryResolverDeps) {
  const now = deps.now ?? (() => new Date());

  /** Identity first (never anonymous), then storage. */
  function gate(request: ResolverRequest): Gated {
    const user = historyUserOf(request.context);
    if (!user)
      return {
        ok: false,
        gate: { status: 'IDENTITY_UNAVAILABLE', detail: HISTORY_MESSAGES.noIdentity },
      };
    let storage: StorageAdapter | null;
    try {
      storage = deps.historyStorage();
    } catch {
      storage = null;
    }
    if (!storage) return { ok: false, gate: notEnabled };
    return { ok: true, user, store: new HistoryStore({ storage, now }) };
  }

  /**
   * §6.3: a record quotes Jira and Confluence text, so it is shown only while
   * the caller can still open the change. 403/404 hide it as NOT_FOUND.
   */
  async function canStillView(changeKey: string): Promise<'yes' | 'no' | ApiResult<never>> {
    const response = await deps.jira.getIssue(
      changeKey,
      new URLSearchParams({ fields: 'summary' }),
    );
    if (response.ok) return 'yes';
    if (response.status === 403 || response.status === 404) return 'no';
    return {
      ok: false,
      error: {
        code: response.status === 401 ? 'UNAUTHENTICATED' : 'UPSTREAM_ERROR',
        message: 'ScenarioForge could not check your access to the change in Jira.',
        upstreamStatus: response.status,
      },
    };
  }

  /** Rebuilds the scenario on the server; the browser's copy is never used. */
  async function trustedScenario(
    source: RehearsalSourceRef,
  ): Promise<
    { ok: true; trusted: TrustedScenario } | { ok: false; result: ApiResult<SaveRehearsalResponse> }
  > {
    if (source.kind === 'demo') return { ok: true, trusted: DEMO_SCENARIOS[source.scenarioId]! };
    const analysis = await analyzeChange(
      { jira: deps.jira, confluence: deps.confluence, engine: deps.engine, now },
      { issueKey: source.changeKey },
    );
    if (!analysis.ok) {
      const { code } = analysis.error;
      if (code === 'NOT_FOUND' || code === 'FORBIDDEN') {
        return {
          ok: false,
          result: data({
            status: 'REJECTED',
            reason: 'SCENARIO_MISMATCH',
            message: HISTORY_MESSAGES.noLongerVisible(source.changeKey),
          }),
        };
      }
      return { ok: false, result: analysis };
    }
    const generated = generateRehearsal({
      analysis: analysis.data,
      findingId: source.findingId,
      restoreTargetMinutes: source.restoreTargetMinutes,
      notifyTargetMinutes: source.notifyTargetMinutes,
    });
    if (!generated.ok) {
      return {
        ok: false,
        result: data({
          status: 'REJECTED',
          reason: 'SCENARIO_MISMATCH',
          message: HISTORY_MESSAGES.changed,
        }),
      };
    }
    const { scenario, remediation, provenance } = generated.rehearsal;
    return { ok: true, trusted: { scenario, remediation, provenance } };
  }

  /**
   * The browser compares content without retrieval times; the store compares
   * the exact fingerprint. Once content matches, the server's own scenario
   * (with its retrieval times) is the one recorded.
   */
  function toRunSubmission(
    scenario: SimulationScenario,
    submission: RehearsalSubmission,
  ): RunSubmission | null {
    if (rehearsalContentFingerprint(scenario) !== submission.contentFingerprint) return null;
    const { sessionId, startedAt, decisionIds, evaluation, flags } = submission;
    return {
      sessionId,
      startedAt,
      decisionIds,
      evaluation,
      flags,
      scenarioFingerprint: scenarioFingerprint(scenario),
    };
  }

  function toResponse(result: SaveResult): SaveRehearsalResponse {
    switch (result.status) {
      case 'SAVED':
        return { status: 'SAVED', id: result.id, pruned: result.pruned };
      case 'UNAVAILABLE':
        return unreachable;
      default:
        return result;
    }
  }

  const mismatch: SaveRehearsalResponse = {
    status: 'REJECTED',
    reason: 'SCENARIO_MISMATCH',
    message: HISTORY_MESSAGES.changed,
  };

  async function listRehearsalHistory(
    request: ResolverRequest,
  ): Promise<ApiResult<ListRehearsalHistoryResponse>> {
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);
    const result = await gated.store.listRuns(gated.user);
    return data(result.status === 'UNAVAILABLE' ? unreachable : result);
  }

  async function getRehearsalRun(
    request: ResolverRequest,
  ): Promise<ApiResult<GetRehearsalRunResponse>> {
    const runId = asRecord(request.payload)?.runId;
    if (!isSessionId(runId)) return invalidRequest('runId must be a rehearsal session id.');
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);
    const result = await gated.store.getRun(gated.user, runId);
    switch (result.status) {
      case 'OK': {
        const changeKey = result.run.provenance?.changeKey;
        if (changeKey) {
          const visible = await canStillView(changeKey);
          if (visible === 'no') return data({ status: 'NOT_FOUND' });
          if (visible !== 'yes') return visible;
        }
        return data({ status: 'OK', run: result.run });
      }
      case 'TAMPERED':
        logVerification('run', result.problems.length);
        return data({ status: 'TAMPERED' });
      case 'UNVERIFIABLE':
        return data({ status: 'UNVERIFIABLE' });
      case 'UNAVAILABLE':
        return data(unreachable);
      default:
        return data(result);
    }
  }

  async function getRetestComparison(
    request: ResolverRequest,
  ): Promise<ApiResult<GetRetestComparisonResponse>> {
    const retestId = asRecord(request.payload)?.retestId;
    if (!isSessionId(retestId)) return invalidRequest('retestId must be a rehearsal session id.');
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);
    const result = await gated.store.getComparison(gated.user, retestId);
    switch (result.status) {
      case 'OK': {
        const changeKey = result.original.provenance?.changeKey;
        if (changeKey) {
          const visible = await canStillView(changeKey);
          if (visible === 'no') return data({ status: 'NOT_FOUND' });
          if (visible !== 'yes') return visible;
        }
        const { original, retest, comparison } = result;
        return data({ status: 'OK', original, retest, comparison });
      }
      case 'TAMPERED':
        logVerification('retest', result.problems.length);
        return data({ status: 'TAMPERED' });
      case 'UNVERIFIABLE':
        return data({ status: 'UNVERIFIABLE' });
      case 'UNAVAILABLE':
        return data(unreachable);
      default:
        return data(result);
    }
  }

  async function saveRehearsalRun(
    request: ResolverRequest,
  ): Promise<ApiResult<SaveRehearsalResponse>> {
    const payload = asRecord(request.payload);
    if (!payload) return invalidRequest('A source and a submission are required.');
    if ('scenario' in payload || 'remediation' in payload) {
      return invalidRequest('A scenario is never accepted from the browser; send its source.');
    }
    const source = parseSource(payload.source);
    if (!source.ok) return invalidRequest(source.message);
    const submission = parseSubmission(payload.submission);
    if (!submission.ok) return invalidRequest(submission.message);
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);

    const rebuilt = await trustedScenario(source.value);
    if (!rebuilt.ok) return rebuilt.result;
    const run = toRunSubmission(rebuilt.trusted.scenario, submission.value);
    if (!run) return data(mismatch);
    return data(toResponse(await gated.store.saveRun(gated.user, rebuilt.trusted, run)));
  }

  async function saveRetest(request: ResolverRequest): Promise<ApiResult<SaveRehearsalResponse>> {
    const payload = asRecord(request.payload);
    if (!payload) return invalidRequest('An original run, fixes and a submission are required.');
    if (!isSessionId(payload.originalRunId)) {
      return invalidRequest('originalRunId must be a rehearsal session id.');
    }
    const fixes = parseIdList(
      payload.remediationIds,
      REMEDIATION_ID,
      MAX_REMEDIATIONS,
      'remediationIds',
      false,
    );
    if (!fixes.ok) return invalidRequest(fixes.message);
    const submission = parseSubmission(payload.submission);
    if (!submission.ok) return invalidRequest(submission.message);
    if (submission.value.sessionId === payload.originalRunId) {
      return invalidRequest('A retest needs its own session id.');
    }
    const gated = gate(request);
    if (!gated.ok) return data(gated.gate);
    const { user, store } = gated;

    // The retest scenario is rebuilt from the stored, verified original.
    const original = await store.getRun(user, payload.originalRunId);
    switch (original.status) {
      case 'OK':
        break;
      case 'NOT_FOUND':
        return data({
          status: 'REJECTED',
          reason: 'ORIGINAL_NOT_FOUND',
          message: 'The original run is not in your history, so this retest cannot be saved.',
        });
      case 'UNAVAILABLE':
        return data(unreachable);
      default:
        return data({
          status: 'REJECTED',
          reason: 'ORIGINAL_NOT_VERIFIED',
          message: 'The original run failed its integrity check, so this retest cannot be saved.',
        });
    }
    const { run } = original;
    if (!run.remediation) {
      return data({
        status: 'REJECTED',
        reason: 'NO_REMEDIATION_MODEL',
        message: 'This rehearsal has no remediation model.',
      });
    }
    let scenario: SimulationScenario;
    try {
      const session = replaySession(
        run.scenario,
        run.audit.decisions.map((d) => d.decisionId),
        run.audit.sessionId,
        run.audit.startedAt,
      );
      scenario = buildRetest(run.scenario, session, fixes.value, run.remediation);
    } catch (error) {
      if (error instanceof SimulationError) {
        return data({ status: 'REJECTED', reason: 'INVALID_FIXES', message: error.message });
      }
      throw error;
    }
    const retestRun = toRunSubmission(scenario, submission.value);
    if (!retestRun) return data(mismatch);
    // No findingId: the comparison covers every gap, as the in-tab retest does.
    return data(
      toResponse(
        await store.saveRetest(user, {
          originalRunId: payload.originalRunId,
          remediationIds: fixes.value,
          submission: retestRun,
        }),
      ),
    );
  }

  return {
    /** Rebuilds a demo or generated scenario as the caller (also used by the Crisis Room). */
    trustedScenario,
    listRehearsalHistory,
    getRehearsalRun,
    getRetestComparison,
    saveRehearsalRun,
    saveRetest,
  };
}

export type HistoryResolvers = ReturnType<typeof createHistoryResolvers>;

function logVerification(kind: 'run' | 'retest', problems: number) {
  // Counts only: problem text can quote stored content.
  console.warn(`History ${kind} failed verification`, { problems });
}
