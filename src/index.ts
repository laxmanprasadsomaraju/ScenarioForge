import api, { route } from '@forge/api';
import { historyStorage as platformHistoryStorage } from './platform/storageFactory';
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
import { checkRemediationApproval, prepareRemediationRequest } from './remediation/prepare';
import {
  parseCheckRemediationApprovalRequest,
  parsePrepareRemediationRequest,
} from './remediation/validation';

import type { StorageAdapter } from '../shared/agents/storage';
import { createHistoryResolvers } from './history/resolvers';
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
    console.error('Resolver failed', error instanceof Error ? error.message : 'unknown error');
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

resolver.define('getReadinessGraph', ({ payload }) =>
  guarded(async () => {
    const parsed = parseGetReadinessGraphRequest(payload);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: parsed.message } };
    }
    return getReadinessGraph(
      { jira: forgeJira, confluence: forgeConfluence, engine: analysisEngine },
      parsed.value,
    );
  }),
);

// M8 preparation only: read-only (GETs as the user). There is no create resolver.
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

/**
 * Storage for rehearsal history (rovo-test build). The Forge adapter is
 * returned only when SF_ROVO_TEST_STORAGE=enabled on rovo-test; otherwise
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

export const handler = resolver.getDefinitions();

/*
 * TEST-ONLY action handlers for the `identity-probe` agent. Branch
 * `rovo-test/build` only (docs/M6_ROVO_TEST_RUNBOOK.md); never merged into a
 * branch that deploys to development or confluence-test without the owner's
 * approval, and removed in the next rovo-test deploy.
 */
export { storageProbe, whoamiProbe } from './probes/forge';
