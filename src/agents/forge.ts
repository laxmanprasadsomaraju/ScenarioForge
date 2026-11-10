import api, { route } from '@forge/api';
import type { ActionFailure, M6ActionKey } from '../../shared/agents/contracts';
import type { HistoryStore, HistoryUser, VerifiedRun } from '../../shared/history';
import { decisionTrail } from '../../shared/simulation/engine';
import { ruleEngine } from '../analysis/ruleEngine';
import type { AnalysisEngine } from '../analysis/analyzeChange';
import {
  historyStore as platformHistoryStore,
  rovoTestAiEnabled,
  responseCache as platformResponseCache,
  usageGovernor as platformUsageGovernor,
} from '../platform/storageFactory';
import type {
  ActionCache,
  ActionGovernor,
  ActionSuccess,
  AgentActions,
  UserGatewayFactory,
  UserScopedGateways,
} from './actions';
import { MESSAGES, createAgentActions, denialToFailure } from './actions';
import type { HistoryLookup, HistoryReader, StoredRunOutcome } from './history';
import { USAGE_NOTE } from './output';

/**
 * Forge entry points for the Phase 2 `rovo-test` agents (docs/M6_PLAN.md,
 * docs/M6_ROVO_TEST_RUNBOOK.md §Phase 2). Each manifest `function` maps to one
 * adapter below.
 *
 * Arguments: the Action page says "The `payload` and `context` are passed into
 * the function as arguments", but its payload examples nest `context` inside
 * `payload`. Both are accepted: the second argument's `accountId` wins, then
 * `payload.context`. The accountId is never read from action inputs.
 *
 * Jira and Confluence are only reached with `api.asUser()`. There is no
 * app-identity path in this module.
 */

/** User-scoped gateways. `asUser()` acts as the user who invoked the action. */
export const forgeUserGateways: UserGatewayFactory = () => {
  const jira: UserScopedGateways['jira'] = {
    getIssue: (issueKey, params) =>
      api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?${params}`),
    getRemoteLinks: (issueKey) =>
      api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`),
    listFields: () => api.asUser().requestJira(route`/rest/api/3/field`),
  };
  const confluence: UserScopedGateways['confluence'] = {
    searchContent: (params) =>
      api.asUser().requestConfluence(route`/wiki/rest/api/search?${params}`),
    getPage: (pageId, params) =>
      api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}?${params}`),
  };
  return { jira, confluence };
};

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Bag) : undefined;

/**
 * The invocation context: payload.context fields, overlaid by the second
 * argument's fields (accountId, installContext). Inputs never contribute.
 */
export function invocationContext(payload: unknown, context: unknown): Bag {
  return { ...(bag(bag(payload)?.context) ?? {}), ...(bag(context) ?? {}) };
}

/** Maps a verified stored run to what `explain-outcome` reports. */
export function toStoredOutcome(user: HistoryUser, run: VerifiedRun): StoredRunOutcome {
  const { audit, scenario, evaluation } = run;
  const trail = decisionTrail(scenario, {
    id: audit.sessionId,
    scenarioId: audit.scenarioId,
    scenarioVersion: audit.scenarioVersion,
    origin: audit.origin,
    startedAt: audit.startedAt,
    status: audit.status,
    currentStepId: null,
    elapsedMinutes: audit.elapsedMinutes,
    flags: audit.flags,
    decisions: audit.decisions,
  }).map(({ record, step, decision }) => ({
    stepTitle: step.title,
    decisionLabel: decision.label,
    atMinute: record.atMinute,
    assessment: decision.consequence.assessment,
    narrative: decision.consequence.narrative,
    evidenceIds: [...decision.consequence.evidenceIds],
  }));
  return {
    sessionId: run.runId,
    // The store reads only under the caller's own prefix and verifies owner.
    ownerAccountId: user.accountId,
    scenarioId: scenario.id,
    // HistoryStore.getRun returns OK only after replay + fingerprint checks.
    auditVerified: true,
    status: audit.status,
    objectives: evaluation.objectives,
    metCount: evaluation.metCount,
    totalCount: evaluation.totalCount,
    elapsedMinutes: evaluation.elapsedMinutes,
    trail,
    retest: null,
    evidence: scenario.evidence,
    version: `${run.runId}:${run.completedAt}`,
  };
}

/**
 * HistoryReader over the durable history store. `installation` comes from the
 * invocation context; without it (or without storage) history is unavailable.
 */
export function historyReaderFor(
  store: Pick<HistoryStore, 'getRun'> | null,
  installation: unknown,
): HistoryReader {
  return {
    async getRun(accountId, sessionId): Promise<HistoryLookup> {
      if (!store || typeof installation !== 'string' || installation.trim() === '') {
        return { status: 'unavailable' };
      }
      const user: HistoryUser = { installation, accountId };
      const result = await store.getRun(user, sessionId);
      switch (result.status) {
        case 'OK':
          return { status: 'found', run: toStoredOutcome(user, result.run) };
        case 'NOT_FOUND':
          return { status: 'not-found' };
        case 'TAMPERED':
        case 'UNVERIFIABLE':
          // Reported as an audit failure (NOT_ASSESSED), never explained.
          return {
            status: 'found',
            run: {
              sessionId,
              ownerAccountId: accountId,
              scenarioId: '',
              auditVerified: false,
              status: 'completed',
              objectives: null,
              metCount: null,
              totalCount: null,
              elapsedMinutes: 0,
              trail: [],
              retest: null,
              evidence: [],
              version: 'unverified',
            },
          };
        default:
          return { status: 'unavailable' };
      }
    },
  };
}

export interface ForgeActionDeps {
  userGateways: UserGatewayFactory;
  engine: AnalysisEngine;
  governor: () => ActionGovernor | null;
  cache: () => ActionCache | null;
  historyStore: () => Pick<HistoryStore, 'getRun'> | null;
  now: () => Date;
  /** Site AI opt-in (SF_ROVO_TEST_AI=enabled). Off: every action is USAGE_LIMITED. */
  aiEnabled: () => boolean;
}

const defaultDeps: ForgeActionDeps = {
  userGateways: forgeUserGateways,
  engine: ruleEngine,
  governor: () => platformUsageGovernor(),
  cache: () => platformResponseCache<ActionSuccess>(),
  historyStore: () => platformHistoryStore(),
  now: () => new Date(),
  aiEnabled: () => rovoTestAiEnabled(),
};

const governanceUnavailable = (): ActionFailure => ({
  ok: false,
  code: 'GOVERNANCE_UNAVAILABLE',
  message: MESSAGES.governanceUnavailable,
  usageNote: USAGE_NOTE,
});

export const AI_OFF_MESSAGE =
  'AI features are switched off for this site. A site admin has not enabled ScenarioForge agents yet.';

export type ForgeActionHandler = (payload: unknown, context?: unknown) => Promise<unknown>;

/**
 * Builds the four Forge handlers. Order: identity, AI opt-in, then governor or cache missing (storage not
 * enabled) fails closed with GOVERNANCE_UNAVAILABLE before anything is read.
 */
export function createForgeActionHandlers(
  deps: ForgeActionDeps = defaultDeps,
): Record<M6ActionKey, ForgeActionHandler> {
  const make =
    (key: M6ActionKey): ForgeActionHandler =>
    async (payload, context) => {
      const ctx = invocationContext(payload, context);
      // Inputs only (minus any `context` key), then the trusted context.
      const inputs = { ...(bag(payload) ?? {}) };
      delete inputs.context;
      const request = { ...inputs, context: ctx };
      // Identity first: nothing (not even the usage ledger) is touched without a user.
      if (typeof ctx.accountId !== 'string' || ctx.accountId === '') {
        return {
          ok: false,
          code: 'IDENTITY_UNAVAILABLE',
          message: MESSAGES.noIdentity,
          usageNote: USAGE_NOTE,
        } satisfies ActionFailure;
      }
      // AI off: answer before any Jira, Confluence or storage access, so nothing
      // is read and nothing is spent. Same failure as a governor DISABLED denial.
      let aiOn: boolean;
      try {
        aiOn = deps.aiEnabled();
      } catch {
        aiOn = false;
      }
      if (!aiOn) {
        return denialToFailure({
          ok: false,
          reason: 'DISABLED',
          message: AI_OFF_MESSAGE,
        });
      }
      let governor: ActionGovernor | null;
      let cache: ActionCache | null;
      try {
        governor = deps.governor();
        cache = deps.cache();
      } catch {
        return governanceUnavailable();
      }
      if (!governor || !cache) return governanceUnavailable();
      let store: Pick<HistoryStore, 'getRun'> | null;
      try {
        store = deps.historyStore();
      } catch {
        store = null;
      }
      const actions: AgentActions = createAgentActions({
        userGateways: deps.userGateways,
        engine: deps.engine,
        governor,
        cache,
        history: historyReaderFor(store, ctx.installContext),
        now: deps.now,
      });
      return (actions[key] as (p: unknown) => Promise<unknown>)(request);
    };
  return {
    'find-recovery-risks': make('find-recovery-risks'),
    'get-service-readiness': make('get-service-readiness'),
    'prepare-rehearsal': make('prepare-rehearsal'),
    'explain-outcome': make('explain-outcome'),
  };
}

const handlers = createForgeActionHandlers();

export const findRecoveryRisks = handlers['find-recovery-risks'];
export const getServiceReadiness = handlers['get-service-readiness'];
export const prepareRehearsal = handlers['prepare-rehearsal'];
export const explainOutcome = handlers['explain-outcome'];
