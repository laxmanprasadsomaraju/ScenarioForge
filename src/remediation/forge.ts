import api, { route } from '@forge/api';
import type { RemediationJiraGateway } from './prepare';

/**
 * Forge adapter for remediation preparation. Every call is a GET made as the
 * user (`requestJira` with no options defaults to GET); there is deliberately
 * no method, body or write endpoint here. Scopes: `read:jira-work` (issue,
 * remote links, search); serverInfo needs none.
 */
export const forgeRemediationJira: RemediationJiraGateway = {
  serverInfo: () => api.asUser().requestJira(route`/rest/api/3/serverInfo`),
  searchIssues: (params) => api.asUser().requestJira(route`/rest/api/3/search/jql?${params}`),
  getIssue: (issueKey, params) =>
    api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?${params}`),
  getRemoteLinks: (issueKey) =>
    api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`),
};
