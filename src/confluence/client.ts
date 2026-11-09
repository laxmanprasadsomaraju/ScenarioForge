import type {
  ApiResult,
  ListRecoveryPagesRequest,
  ListRecoveryPagesResponse,
  RecoveryProcedureExcerpt,
} from '../../shared/api';
import { buildRecoveryPagesCql } from '../validation';
import {
  errorFromStatus,
  extractOrderedSteps,
  htmlToText,
  mapPage,
  mapPageSearchResponse,
} from './mapping';

/** Minimal response surface used from Forge's fetch, so tests can fake it. */
export interface ConfluenceResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ConfluenceGateway {
  /** `GET /wiki/rest/api/search` (CQL search, v1; no v2 equivalent exists). */
  searchContent(params: URLSearchParams): Promise<ConfluenceResponse>;
  /** `GET /wiki/api/v2/pages/{id}`. `pageId` is validated as numeric first. */
  getPage(pageId: string, params: URLSearchParams): Promise<ConfluenceResponse>;
}

/** Excerpts are evidence, not a page mirror: keep them short. */
export const MAX_EXCERPT_CHARS = 2_000;

const UNREADABLE = {
  code: 'UNEXPECTED_RESPONSE',
  message: 'Confluence returned a response ScenarioForge could not read.',
} as const;

async function readJson(response: ConfluenceResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function searchRecoveryPages(
  gateway: ConfluenceGateway,
  request: ListRecoveryPagesRequest,
  now: () => Date = () => new Date(),
): Promise<ApiResult<ListRecoveryPagesResponse>> {
  const cql = buildRecoveryPagesCql(request);
  const params = new URLSearchParams({
    cql,
    limit: String(request.maxResults),
    excerpt: 'none',
    expand: 'content.space',
  });

  const response = await gateway.searchContent(params);
  if (!response.ok) {
    return { ok: false, error: errorFromStatus(response.status, 'search') };
  }
  const mapped = mapPageSearchResponse(await readJson(response));
  if (!mapped) {
    return { ok: false, error: { ...UNREADABLE } };
  }
  return { ok: true, data: { ...mapped, fetchedAt: now().toISOString(), cql } };
}

export async function getRecoveryProcedure(
  gateway: ConfluenceGateway,
  pageId: string,
  now: () => Date = () => new Date(),
): Promise<ApiResult<RecoveryProcedureExcerpt>> {
  const params = new URLSearchParams({ 'body-format': 'storage' });
  const response = await gateway.getPage(pageId, params);
  if (!response.ok) {
    return { ok: false, error: errorFromStatus(response.status, 'page') };
  }
  const page = mapPage(await readJson(response));
  if (!page || page.id !== pageId) {
    return { ok: false, error: { ...UNREADABLE } };
  }

  const text = htmlToText(page.storage);
  const excerptTruncated = text.length > MAX_EXCERPT_CHARS;
  const excerpt = excerptTruncated ? text.slice(0, MAX_EXCERPT_CHARS).trimEnd() : text;
  const steps = extractOrderedSteps(page.storage);
  const retrievedAt = now().toISOString();

  return {
    ok: true,
    data: {
      pageId: page.id,
      title: page.title,
      spaceId: page.spaceId,
      lastUpdated: page.lastUpdated,
      webuiPath: page.webuiPath,
      excerpt,
      excerptTruncated,
      steps,
      stepSource: steps.length > 0 ? 'ordered-list' : 'none',
      evidence: {
        id: `confluence-page:${page.id}`,
        origin: 'live',
        kind: 'confluence-page',
        title: page.title,
        ...(excerpt ? { excerpt } : {}),
        ...(page.base && page.webuiPath ? { url: `${page.base}${page.webuiPath}` } : {}),
        retrievedAt,
      },
    },
  };
}
