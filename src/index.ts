import api, { route } from '@forge/api';
import Resolver from '@forge/resolver';
import type { ApiResult } from '../shared/api';
import type { JiraGateway } from './jira/client';
import { checkConnection, listRecentChanges } from './jira/client';
import { parseListChangesRequest } from './validation';

/**
 * All Jira calls run asUser so results are limited to what the signed-in user
 * can already see in Jira. No app-level credentials ever reach the browser.
 */
const forgeJira: JiraGateway = {
  searchIssues: (params) => api.asUser().requestJira(route`/rest/api/3/search/jql?${params}`),
  myself: () => api.asUser().requestJira(route`/rest/api/3/myself`),
};

async function guarded<T>(work: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await work();
  } catch (error) {
    console.error('Resolver failed', error instanceof Error ? error.message : 'unknown error');
    return {
      ok: false,
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'ScenarioForge could not reach Jira. Try again shortly.',
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

export const handler = resolver.getDefinitions();
