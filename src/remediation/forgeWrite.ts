import api, { route } from '@forge/api';
import type { WriteTransport } from './writeGateway';

/**
 * Forge transport for the M8 write gateway. `asUser()` only, POST only, three
 * fixed routes. Needs `write:jira-work`, which the manifest does NOT request:
 * until a separately approved `write-test` environment adds it, Jira refuses
 * the call even if the SF_REMEDIATION_WRITE flag is set. The path is already
 * validated by createJiraWriteGateway.
 */
export const forgeWriteTransport: WriteTransport = (path, init) => {
  const user = api.asUser();
  if (path === '/rest/api/3/issue') return user.requestJira(route`/rest/api/3/issue`, init);
  if (path === '/rest/api/3/issueLink') return user.requestJira(route`/rest/api/3/issueLink`, init);
  const key = path.split('/')[5] ?? '';
  return user.requestJira(route`/rest/api/3/issue/${key}/remotelink`, init);
};
