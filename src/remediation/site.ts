import type { ApiResult } from '../../shared/api';
import { isUrlOnOrigin, SITE_ORIGIN_PATTERN } from '../../shared/remediation';
import type { JiraResponse } from '../jira/client';
import { errorFromStatus } from '../jira/mapping';

/**
 * The site address used for every absolute link in a work item draft.
 *
 * Trust rule: the address comes only from the server, never from the browser.
 * It is `baseUrl` from `GET /rest/api/3/serverInfo` (Jira platform REST v3,
 * getServerInfo: "Returns information about the Jira instance", OAuth scopes
 * `[]`, "Permissions required: None"; `ServerInformation.baseUrl` is "The base
 * URL of the Jira instance"), read through Forge `requestJira`, which only
 * reaches the site the app is installed on. The Forge resolver context has
 * `cloudId` but no site URL (developer.atlassian.com/platform/forge/
 * runtime-reference/custom-ui-resolver/, read 2026-11-10), and the Custom UI
 * `getContext().siteUrl` is reported by the browser, so neither is used.
 *
 * Accepted only when it is `https://<host>` with a dotted host under an
 * Atlassian cloud domain, no user info, port, path (a single trailing `/` is
 * dropped), query or fragment. Every link URL must then be on exactly that
 * origin (`isLinkOnSite`).
 */

/** Atlassian cloud site domains accepted for `baseUrl`. Custom domains are refused. */
export const SITE_HOST_SUFFIXES = ['.atlassian.net'] as const;

export interface ServerInfoGateway {
  /** `GET /rest/api/3/serverInfo` */
  serverInfo(): Promise<JiraResponse>;
}

/** The trusted site origin from a serverInfo body, or null when it is not acceptable. */
export function trustedSiteUrl(body: unknown): string | null {
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const raw = record?.baseUrl;
  if (typeof raw !== 'string') return null;
  const site = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (!SITE_ORIGIN_PATTERN.test(site)) return null;
  const host = site.slice('https://'.length).toLowerCase();
  if (!SITE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)) {
    return null;
  }
  return `https://${host}`;
}

/** True when `url` is an absolute https URL on exactly the trusted `site`. */
export function isLinkOnSite(url: string, site: string): boolean {
  return isUrlOnOrigin(url, site);
}

export async function readTrustedSite(gateway: ServerInfoGateway): Promise<ApiResult<string>> {
  const response = await gateway.serverInfo();
  if (!response.ok) {
    return { ok: false, error: errorFromStatus(response.status) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const site = trustedSiteUrl(body);
  if (!site) {
    return {
      ok: false,
      error: {
        code: 'UNEXPECTED_RESPONSE',
        message: 'Jira did not report a plain https site address, so links cannot be built.',
      },
    };
  }
  return { ok: true, data: site };
}
