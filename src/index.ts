import api, { route } from '@forge/api';
import Resolver from '@forge/resolver';
import type { ApiResult } from '../shared/api';
import type { ConfluenceGateway } from './confluence/client';
import { getRecoveryProcedure, searchRecoveryPages } from './confluence/client';
import type { JiraGateway } from './jira/client';
import { checkConnection, listRecentChanges } from './jira/client';
import {
  parseGetRecoveryProcedureRequest,
  parseListChangesRequest,
  parseListRecoveryPagesRequest,
} from './validation';

/**
 * All Jira calls run asUser so results are limited to what the signed-in user
 * can already see in Jira. No app-level credentials ever reach the browser.
 */
const forgeJira: JiraGateway = {
  searchIssues: (params) => api.asUser().requestJira(route`/rest/api/3/search/jql?${params}`),
  myself: () => api.asUser().requestJira(route`/rest/api/3/myself`),
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

export const handler = resolver.getDefinitions();
