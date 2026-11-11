import { parseDeepLink } from './deepLink';

/**
 * Absolute ScenarioForge links for Rovo agents.
 *
 * Format (developer.atlassian.com/platform/forge/manifest-reference/modules/
 * global-full-page/, read 2026-11-11):
 *   {site}/apps/full-page/{installation-id}/{route-prefix}/{app-route}
 * The route prefix is fixed by the manifest. The app route and its query are
 * appended; the page maps them to the in-app route with view.createHistory.
 * The docs do not describe query handling, so that part is not verified live.
 *
 * Only built from a trusted site origin and a UUID installation id; any other
 * input yields null (no link). The path must be a canonical ScenarioForge deep
 * link: parsing it back must succeed, so no other route or redirect is possible.
 */

export const ROUTE_PREFIX = 'scenarioforge';

const SITE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.atlassian\.net$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function buildAppUrl(input: {
  siteUrl: unknown;
  installationId: unknown;
  appPath: unknown;
}): string | null {
  const { siteUrl, installationId, appPath } = input;
  if (typeof siteUrl !== 'string' || !SITE.test(siteUrl)) return null;
  if (typeof installationId !== 'string' || !UUID.test(installationId.toLowerCase())) return null;
  if (typeof appPath !== 'string' || !appPath.startsWith('/') || appPath.startsWith('//')) {
    return null;
  }
  const q = appPath.indexOf('?');
  if (q < 0) return null;
  const pathname = appPath.slice(0, q);
  const parsed = parseDeepLink(pathname, appPath.slice(q));
  if (parsed.kind !== 'link') return null;
  return `${siteUrl}/apps/full-page/${installationId.toLowerCase()}/${ROUTE_PREFIX}${pathname}${appPath.slice(q)}`;
}
