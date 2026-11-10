/**
 * Links into the ScenarioForge global page (`/apps/full-page/<installationId>/
 * scenarioforge/<app-route>?<query>`). A link carries identifiers only: a Jira
 * issue key, an M3 finding id and whole-minute targets. Whatever the link
 * says, the data behind it is read again through the user's own resolvers, so
 * Jira and Confluence permissions decide what the user sees.
 *
 * The same module builds links (M6 actions, in-app navigation) and parses
 * them (the global page), so both sides agree on one canonical form. Parsing
 * is all or nothing: a link with any problem is rejected as a whole and never
 * partially applied.
 */

export const READINESS_PATH = '/readiness-checks';
export const SIMULATIONS_PATH = '/simulations';

/** Same rule as `isIssueKey` in src/validation.ts (test/deepLink.test.ts keeps them equal). */
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const MAX_ISSUE_KEY_LENGTH = 64;

/** M3 engine finding id: `{KEY}:{pageId}:{step}:{term}` (shared/analysis/engine.ts). */
export const FINDING_ID = /^([A-Z][A-Z0-9_]*-\d+):(\d{1,19}):(\d{1,4}):([a-z0-9]{1,40})$/;
export const MAX_FINDING_ID_LENGTH = 160;

export const RESTORE_RANGE = { min: 5, max: 1440 } as const;
export const NOTIFY_RANGE = { min: 1, max: 240 } as const;

/** Longest query string read at all; longer ones are rejected before parsing. */
export const MAX_QUERY_LENGTH = 512;

export interface ReadinessLink {
  route: 'readiness';
  change: string;
  finding?: string;
}

export interface RehearsalLink {
  route: 'simulations';
  change: string;
  finding: string;
  restore: number;
  notify?: number;
}

export type DeepLink = ReadinessLink | RehearsalLink;

export type ParsedLink =
  /** No parameters on a route that takes them, or a route without links. */
  | { kind: 'none' }
  | { kind: 'link'; link: DeepLink }
  /** Nothing from the link is applied; `reason` is fixed text and never echoes the input. */
  | { kind: 'rejected'; route: DeepLink['route']; reason: string };

export function isLinkIssueKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ISSUE_KEY_LENGTH && ISSUE_KEY.test(value);
}

/** True when `findingId` has the engine's shape and names `changeKey` as its change. */
export function isFindingIdFor(findingId: unknown, changeKey: string): findingId is string {
  if (typeof findingId !== 'string' || findingId.length > MAX_FINDING_ID_LENGTH) return false;
  const match = FINDING_ID.exec(findingId);
  return match !== null && match[1] === changeKey;
}

function wholeNumberIn(value: string, range: { min: number; max: number }): number | null {
  if (!/^[1-9]\d{0,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= range.min && n <= range.max ? n : null;
}

// Building ------------------------------------------------------------------------

function query(entries: [string, string][]): string {
  return entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/**
 * The canonical app path for a link. Throws on input the parser would reject,
 * so no caller can produce a link that does not open.
 */
export function buildDeepLink(link: DeepLink): string {
  if (!isLinkIssueKey(link.change)) throw new TypeError('change must be a Jira issue key.');
  if (link.finding !== undefined && !isFindingIdFor(link.finding, link.change)) {
    throw new TypeError('finding must be a finding id of the same change.');
  }
  if (link.route === 'readiness') {
    const entries: [string, string][] = [['change', link.change]];
    if (link.finding !== undefined) entries.push(['finding', link.finding]);
    return `${READINESS_PATH}?${query(entries)}`;
  }
  if (wholeNumberIn(String(link.restore), RESTORE_RANGE) === null) {
    throw new TypeError('restore must be whole minutes from 5 to 1440.');
  }
  const entries: [string, string][] = [
    ['change', link.change],
    ['finding', link.finding],
    ['restore', String(link.restore)],
  ];
  if (link.notify !== undefined) {
    if (wholeNumberIn(String(link.notify), NOTIFY_RANGE) === null) {
      throw new TypeError('notify must be whole minutes from 1 to 240.');
    }
    entries.push(['notify', String(link.notify)]);
  }
  return `${SIMULATIONS_PATH}?${query(entries)}`;
}

export function readinessLinkPath(change: string, finding?: string): string {
  return buildDeepLink({
    route: 'readiness',
    change,
    ...(finding !== undefined ? { finding } : {}),
  });
}

export function rehearsalLinkPath(input: {
  change: string;
  finding: string;
  restore: number;
  notify?: number;
}): string {
  return buildDeepLink({ route: 'simulations', ...input });
}

// Parsing -------------------------------------------------------------------------

const PARAMS: Record<DeepLink['route'], readonly string[]> = {
  readiness: ['change', 'finding'],
  simulations: ['change', 'finding', 'restore', 'notify'],
};

/** C0 controls, DEL and C1 controls. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function routeOf(pathname: string): DeepLink['route'] | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === READINESS_PATH) return 'readiness';
  if (clean === SIMULATIONS_PATH) return 'simulations';
  return null;
}

type Fields = { ok: true; fields: Map<string, string> } | { ok: false; reason: string };

function readQuery(search: string, allowed: readonly string[]): Fields {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (raw.length > MAX_QUERY_LENGTH) return { ok: false, reason: 'The link is too long.' };
  const fields = new Map<string, string>();
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (part === '' || eq <= 0) return { ok: false, reason: 'The link is malformed.' };
    let name: string;
    let value: string;
    try {
      name = decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '));
      value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    } catch {
      return { ok: false, reason: 'The link is malformed.' };
    }
    if (hasControl(name) || hasControl(value)) {
      return { ok: false, reason: 'The link contains control characters.' };
    }
    if (!allowed.includes(name)) {
      return { ok: false, reason: 'The link has a parameter ScenarioForge does not use.' };
    }
    if (fields.has(name)) return { ok: false, reason: `The link repeats "${name}".` };
    if (value.length > MAX_FINDING_ID_LENGTH) {
      return { ok: false, reason: `The link's "${name}" is too long.` };
    }
    fields.set(name, value);
  }
  return { ok: true, fields };
}

/**
 * Reads a global page location. Routes other than Readiness checks and
 * Simulations carry no link and return `none`, as does either of those two
 * without a query.
 */
export function parseDeepLink(pathname: string, search: string): ParsedLink {
  const route = routeOf(pathname);
  if (!route || search === '' || search === '?') return { kind: 'none' };
  const reject = (reason: string): ParsedLink => ({ kind: 'rejected', route, reason });

  const read = readQuery(search, PARAMS[route]);
  if (!read.ok) return reject(read.reason);
  const { fields } = read;

  const change = fields.get('change');
  if (change === undefined) return reject('The link does not name a change.');
  if (!isLinkIssueKey(change)) return reject('The link\'s "change" is not a Jira issue key.');

  const finding = fields.get('finding');
  if (finding !== undefined && !isFindingIdFor(finding, change)) {
    return reject(`The link's finding is not a finding of ${change}.`);
  }

  if (route === 'readiness') {
    return {
      kind: 'link',
      link: { route, change, ...(finding !== undefined ? { finding } : {}) },
    };
  }

  if (finding === undefined) return reject('The link does not name a finding to rehearse.');
  const restoreText = fields.get('restore');
  if (restoreText === undefined) return reject('The link does not give a restore target.');
  const restore = wholeNumberIn(restoreText, RESTORE_RANGE);
  if (restore === null) return reject('The restore target must be whole minutes from 5 to 1440.');
  const notifyText = fields.get('notify');
  let notify: number | undefined;
  if (notifyText !== undefined) {
    const parsed = wholeNumberIn(notifyText, NOTIFY_RANGE);
    if (parsed === null) return reject('The notify target must be whole minutes from 1 to 240.');
    notify = parsed;
  }
  return {
    kind: 'link',
    link: { route, change, finding, restore, ...(notify !== undefined ? { notify } : {}) },
  };
}
