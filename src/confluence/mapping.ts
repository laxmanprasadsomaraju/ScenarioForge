import type { ApiError, ConfluencePageSummary } from '../../shared/api';
import type { RecoveryStep } from '../../shared/domain/types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const NUMERIC_ID = /^[0-9]{1,19}$/;

/** Only same-site relative paths are kept, so a link can never point elsewhere. */
export function safeRelativePath(value: unknown): string | null {
  const path = asString(value);
  return path && path.startsWith('/') && !path.startsWith('//') && !/[\s\\]/.test(path)
    ? path
    : null;
}

/** Search result containers link to `/spaces/<KEY>`; used when `space` is not expanded. */
function spaceKeyFromContainer(container: unknown): string | null {
  const url = asString(asRecord(container)?.displayUrl);
  const match = url ? /^\/spaces\/(~?[A-Za-z0-9]{1,255})(?:\/|$)/.exec(url) : null;
  return match?.[1] ?? null;
}

/**
 * Maps one result of `GET /wiki/rest/api/search`. Only pages with a numeric id
 * are kept; other content types and results that cannot be linked back to
 * their source are dropped.
 */
export function mapSearchResult(raw: unknown): ConfluencePageSummary | null {
  const result = asRecord(raw);
  const content = asRecord(result?.content);
  const id = asString(content?.id);
  if (!result || !content || !id || !NUMERIC_ID.test(id)) {
    return null;
  }
  if (content.type !== undefined && content.type !== 'page') {
    return null;
  }
  const links = asRecord(content._links);
  return {
    id,
    title: asString(content.title) ?? '(untitled page)',
    spaceKey:
      asString(asRecord(content.space)?.key) ?? spaceKeyFromContainer(result.resultGlobalContainer),
    lastUpdated: asString(result.lastModified),
    webuiPath: safeRelativePath(links?.webui) ?? safeRelativePath(result.url),
  };
}

export interface MappedPageSearch {
  pages: ConfluencePageSummary[];
  truncated: boolean;
}

export function mapPageSearchResponse(body: unknown): MappedPageSearch | null {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.results)) {
    return null;
  }
  const pages = record.results
    .map(mapSearchResult)
    .filter((p): p is ConfluencePageSummary => p !== null);
  const size = typeof record.size === 'number' ? record.size : record.results.length;
  const truncated =
    typeof asRecord(record._links)?.next === 'string' ||
    (typeof record.totalSize === 'number' && record.totalSize > size);
  return { pages, truncated };
}

export interface MappedPage {
  id: string;
  title: string;
  spaceId: string | null;
  lastUpdated: string | null;
  webuiPath: string | null;
  /** Absolute Confluence base from `_links.base`, only when it is https. */
  base: string | null;
  storage: string;
}

/**
 * Maps `GET /wiki/api/v2/pages/{id}?body-format=storage`. A page without a
 * storage body is still returned (with an empty body) so the UI can link to it.
 */
export function mapPage(body: unknown): MappedPage | null {
  const page = asRecord(body);
  const id = asString(page?.id);
  if (!page || !id || !NUMERIC_ID.test(id)) {
    return null;
  }
  const links = asRecord(page._links);
  const base = asString(links?.base);
  const storage = asRecord(asRecord(page.body)?.storage)?.value;
  return {
    id,
    title: asString(page.title) ?? '(untitled page)',
    spaceId: asString(page.spaceId),
    lastUpdated: asString(asRecord(page.version)?.createdAt),
    webuiPath: safeRelativePath(links?.webui),
    base: base && /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(base) ? base.replace(/\/$/, '') : null,
    storage: typeof storage === 'string' ? storage : '',
  };
}

/*
 * Markup handling. Confluence storage format is XHTML with `ac:` macros. We
 * never render or execute it: we only remove tags with regular expressions and
 * keep text. The output is plain text and must be rendered as text by the UI.
 */

/** Bodies above this size are cut before parsing to bound the work done. */
export const MAX_BODY_CHARS = 200_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      const printable = code > 0x1f && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return printable ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Removes elements whose content is never readable text (script, style and
 * friends, including unterminated ones), comments and processing instructions.
 * CDATA (used by code macros) is kept as text.
 */
function removeNonText(markup: string): string {
  return markup
    .slice(0, MAX_BODY_CHARS)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)/g, (_m, text: string) =>
      text.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    )
    .replace(/<\?[\s\S]*?(?:\?>|$)/g, ' ')
    .replace(
      /<(script|style|noscript|template|iframe|object|svg|math)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
      ' ',
    );
}

/** Tags that end a line of readable text. */
const BLOCK_TAG = /^(p|div|br|li|ol|ul|h[1-6]|tr|td|th|table|blockquote|pre|ac:task)$/i;

/** Converts storage-format markup to plain text. Never executes anything. */
export function htmlToText(markup: string): string {
  const text = removeNonText(markup).replace(
    /<\/?([a-zA-Z][\w:-]*)\b[^>]*>|<[^>]*>/g,
    (_tag, name?: string) => (name && BLOCK_TAG.test(name) ? '\n' : ''),
  );
  return decodeEntities(text.replace(/<[^>]*$/, ''))
    .split('\n')
    .map(collapseWhitespace)
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Returns the items of the first top-level ordered list as recovery steps.
 * Text of nested lists stays with its parent item. Returns an empty list when
 * the body has no ordered list: steps are never inferred from prose.
 */
export function extractOrderedSteps(markup: string): RecoveryStep[] {
  const source = removeNonText(markup);
  const tagPattern = /<(\/?)(ol|li)\b[^>]*>/gi;
  const items: string[] = [];
  let olDepth = 0;
  let itemStart = -1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(source)) !== null) {
    const closing = match[1] === '/';
    const name = match[2]!.toLowerCase();
    if (name === 'ol') {
      if (!closing) {
        olDepth += 1;
      } else if (olDepth > 0) {
        olDepth -= 1;
        if (olDepth === 0) {
          if (itemStart >= 0) {
            items.push(source.slice(itemStart, match.index));
          }
          break;
        }
      }
    } else if (olDepth === 1) {
      // Only items of the outermost list start or end a step.
      if (!closing) {
        if (itemStart >= 0) {
          items.push(source.slice(itemStart, match.index));
        }
        itemStart = tagPattern.lastIndex;
      } else if (itemStart >= 0) {
        items.push(source.slice(itemStart, match.index));
        itemStart = -1;
      }
    }
  }

  return items
    .map((item) => collapseWhitespace(htmlToText(item)))
    .filter((instruction) => instruction.length > 0)
    .map((instruction, index) => ({ order: index + 1, instruction, dependsOn: [] }));
}

/** Translates a Confluence HTTP status into a user-safe error. */
export function errorFromStatus(status: number, resource: 'search' | 'page'): ApiError {
  switch (status) {
    case 400:
      return {
        code: 'INVALID_REQUEST',
        message: 'Confluence rejected the request.',
        upstreamStatus: status,
      };
    case 401:
      return {
        code: 'UNAUTHENTICATED',
        message:
          'ScenarioForge is not authorised to read Confluence as you. Grant access and try again.',
        upstreamStatus: status,
      };
    case 403:
      return {
        code: 'FORBIDDEN',
        message: 'You do not have permission to view this Confluence content.',
        upstreamStatus: status,
      };
    case 404:
      return {
        code: 'NOT_FOUND',
        message:
          resource === 'search'
            ? 'Confluence is not available on this site, or search is not reachable.'
            : 'The Confluence page was not found, or Confluence is not available on this site.',
        upstreamStatus: status,
      };
    case 429:
      return {
        code: 'RATE_LIMITED',
        message: 'Confluence is rate limiting requests. Wait a moment and retry.',
        upstreamStatus: status,
      };
    default:
      return {
        code: 'UPSTREAM_ERROR',
        message: `Confluence returned an unexpected error (HTTP ${status}).`,
        upstreamStatus: status,
      };
  }
}
