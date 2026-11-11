import { randomBytes } from 'node:crypto';
import api, { route } from '@forge/api';
import {
  crisisStorage as platformCrisisStorage,
  historyStorage as platformHistoryStorage,
} from './platform/storageFactory';
import Resolver from '@forge/resolver';
import type { ApiResult } from '../shared/api';
import type { AnalysisEngine } from './analysis/analyzeChange';
import { analyzeChange } from './analysis/analyzeChange';
import { ruleEngine } from './analysis/ruleEngine';
import type { ConfluenceGateway } from './confluence/client';
import { getRecoveryProcedure, searchRecoveryPages } from './confluence/client';
import type { JiraFieldGateway } from './jira/affectedServices';
import type { JiraGateway, JiraIssueGateway } from './jira/client';
import { checkConnection, listRecentChanges } from './jira/client';
import { getReadinessGraph } from './graph/getReadinessGraph';
import { forgeRemediationJira } from './remediation/forge';
import { handleApproveRemediation } from './remediation/approvals';
import { handleCreateRemediationWorkItem } from './remediation/create';
import { remediationCreateWiring } from './remediation/gateways';
import { checkRemediationApproval, prepareRemediationRequest } from './remediation/prepare';
import {
  parseCheckRemediationApprovalRequest,
  parsePrepareRemediationRequest,
} from './remediation/validation';

import type { StorageAdapter } from '../shared/agents/storage';
import { createHistoryResolvers } from './history/resolvers';
import { createCrisisResolvers } from './crisis/resolvers';
import {
  parseAnalyzeChangeRequest,
  parseGetReadinessGraphRequest,
  parseGetRecoveryProcedureRequest,
  parseListChangesRequest,
  parseListRecoveryPagesRequest,
} from './validation';

/**
 * All Jira calls run asUser so results are limited to what the signed-in user
 * can already see in Jira. No app-level credentials ever reach the browser.
 */
const forgeJira: JiraGateway & JiraIssueGateway & JiraFieldGateway = {
  searchIssues: (params) => api.asUser().requestJira(route`/rest/api/3/search/jql?${params}`),
  myself: () => api.asUser().requestJira(route`/rest/api/3/myself`),
  getIssue: (issueKey, params) =>
    api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?${params}`),
  getRemoteLinks: (issueKey) =>
    api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`),
  // Field list for the JSM Affected services probe (read:jira-work, no new scope).
  listFields: () => api.asUser().requestJira(route`/rest/api/3/field`),
};

/**
 * Confluence calls also run asUser: search results and page bodies respect the
 * user's space and page restrictions. CQL search only exists in the v1 API;
 * page bodies use v2.
 */
const forgeConfluence: ConfluenceGateway = {
  searchContent: (params) => api.asUser().requestConfluence(route`/wiki/rest/api/search?${params}`),
  getPage: (pageId, params) =>
    api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}?${params}`),
};

/**
 * Deterministic change-to-recovery engine (no AI). Replaced by the
 * shared/analysis engine at integration; until then analysis reports
 * `not-assessed`.
 */
const analysisEngine: AnalysisEngine = ruleEngine;

async function guarded<T>(
  work: () => Promise<ApiResult<T>>,
  product: 'Jira' | 'Confluence' = 'Jira',
): Promise<ApiResult<T>> {
  try {
    return await work();
  } catch (error) {
    console.error('Resolver failed', error instanceof Error ? error.name : 'unknown error');
    return {
      ok: false,
      error: {
        code: 'UPSTREAM_ERROR',
        message: `ScenarioForge could not reach ${product}. Try again shortly.`,
      },
    };
  }
}

const resolver = new Resolver();

resolver.define('getConnectionStatus', () => guarded(() => checkConnection(forgeJira)));

resolver.define('listRecentChanges', ({ payload }) =>
  guarded(async () => {
    const parsed = parseListChangesRequest(payload);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.message } };
    }
    return listRecentChanges(forgeJira, parsed.value);
  }),
);

resolver.define('listRecoveryPages', ({ payload }) =>
  guarded(async () => {
    const parsed = parseListRecoveryPagesRequest(payload);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.message } };
    }
    return searchRecoveryPages(forgeConfluence, parsed.value);
  }, 'Confluence'),
);

resolver.define('getRecoveryProcedure', ({ payload }) =>
  guarded(async () => {
    const parsed = parseGetRecoveryProcedureRequest(payload);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.message } };
    }
    return getRecoveryProcedure(forgeConfluence, parsed.value.pageId);
  }, 'Confluence'),
);

resolver.define('analyzeChange', ({ payload }) =>
  guarded(async () => {
    const parsed = parseAnalyzeChangeRequest(payload);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.message } };
    }
    return analyzeChange(
      { jira: forgeJira, confluence: forgeConfluence, engine: analysisEngine },
      parsed.value,
    );
  }),
);

/** Teamwork Graph (M9): off unless `SF_TWG=enabled`; needs the graph-test scopes. */
const forgeTwg = {
  request: (query: string, variables: Record<string, unknown>, operationName: string) =>
    api.asUser().requestTeamworkGraph(query, variables, operationName),
};

resolver.define('getReadinessGraph', ({ payload, context }) =>
  guarded(async () => {
    const parsed = parseGetReadinessGraphRequest(payload);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.message } };
    }
    return getReadinessGraph(
      {
        jira: forgeJira,
        confluence: forgeConfluence,
        engine: analysisEngine,
        twg: forgeTwg,
        twgConfig: {
          flag: process.env.SF_TWG,
          impactsKey: process.env.TWG_QK_IMPACTS,
          ownersKey: process.env.TWG_QK_OWNERS,
          cloudId: (context as { cloudId?: string } | undefined)?.cloudId,
        },
      },
      parsed.value,
    );
  }),
);

// M8: preparation is read-only (GETs as the user). The create resolver is
// compiled in but hard-disabled: unless SF_REMEDIATION_WRITE and SF_STORAGE are
// both exactly 'enabled' the writer is null and it answers WRITE_NOT_PERMITTED
// before reading anything (src/remediation/gateways.ts). No write scope either.
const remediationDeps = {
  jira: forgeRemediationJira,
  confluence: forgeConfluence,
  engine: analysisEngine,
};

resolver.define('prepareRemediationRequest', ({ payload }) =>
  guarded(async () => {
    const parsed = parsePrepareRemediationRequest(payload);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.message } };
    }
    return prepareRemediationRequest(remediationDeps, parsed.value);
  }),
);

resolver.define('checkRemediationApproval', ({ payload, context }) =>
  guarded(async () => {
    const parsed = parseCheckRemediationApprovalRequest(payload);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.message } };
    }
    const accountId: unknown = context?.accountId;
    if (typeof accountId !== 'string' || accountId === '') {
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Sign in to Jira to check an approval.' },
      };
    }
    return checkRemediationApproval(remediationDeps, parsed.value, accountId);
  }),
);

// Approvals are issued by the server: the approver comes from the invocation
// context, the time from the server clock; the payload cannot set either.
resolver.define('approveRemediationRequest', ({ payload, context }) =>
  guarded(() =>
    handleApproveRemediation(
      {
        ...remediationDeps,
        ...remediationCreateWiring(),
      },
      payload,
      context?.accountId,
    ),
  ),
);

resolver.define('createRemediationWorkItem', ({ payload, context }) =>
  guarded(() =>
    handleCreateRemediationWorkItem(
      {
        ...remediationDeps,
        ...remediationCreateWiring(),
      },
      payload,
      context?.accountId,
    ),
  ),
);

/**
 * Storage for rehearsal history. The Forge adapter is
 * returned only when SF_STORAGE=enabled; otherwise
 * null and every history resolver answers UNAVAILABLE.
 */
const historyStorage = (): StorageAdapter | null => platformHistoryStorage();

const history = createHistoryResolvers({
  historyStorage,
  jira: forgeJira,
  confluence: forgeConfluence,
  engine: analysisEngine,
});

// The user comes from `context` (accountId, installContext), never the payload.
resolver.define('listRehearsalHistory', (request) =>
  guarded(() => history.listRehearsalHistory(request)),
);
resolver.define('getRehearsalRun', (request) => guarded(() => history.getRehearsalRun(request)));
resolver.define('getRetestComparison', (request) =>
  guarded(() => history.getRetestComparison(request)),
);
resolver.define('saveRehearsalRun', (request) => guarded(() => history.saveRehearsalRun(request)));
resolver.define('saveRetest', (request) => guarded(() => history.saveRetest(request)));

/**
 * Crisis Room (M7). Storage comes from the factory and is null unless both
 * SF_STORAGE=enabled and SF_CRISIS=enabled; while null every crisis resolver
 * answers UNAVAILABLE. There is no realtime channel; the UI polls crisisView.
 */
const crisisStorage = (): StorageAdapter | null => platformCrisisStorage();

const crisis = createCrisisResolvers({
  crisisStorage,
  historyStorage,
  trustedScenario: history.trustedScenario,
  random: (bytes) => randomBytes(bytes).toString('base64url'),
});

resolver.define('crisisStatus', (request) => guarded(() => crisis.crisisStatus(request)));

resolver.define('crisisOpenRoom', (request) => guarded(() => crisis.crisisOpenRoom(request)));
resolver.define('crisisView', (request) => guarded(() => crisis.crisisView(request)));
resolver.define('crisisCommand', (request) => guarded(() => crisis.crisisCommand(request)));
resolver.define('crisisInviteToken', (request) => guarded(() => crisis.crisisInviteToken(request)));
resolver.define('crisisSaveDebrief', (request) => guarded(() => crisis.crisisSaveDebrief(request)));

export const handler = resolver.getDefinitions();

/*
 * Rovo agents and MCP tools: handlers for the four read-only agent actions
 * (manifest functions `action-*`). The Phase 1 probe handlers in
 * src/probes/forge.ts are kept with their tests but no longer exported or
 * registered in the manifest.
 */
export {
  explainOutcome,
  findRecoveryRisks,
  getServiceReadiness,
  prepareRehearsal,
} from './agents/forge';
