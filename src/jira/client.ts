import type {
  ApiResult,
  ConnectionStatus,
  ListChangesRequest,
  ListChangesResponse,
} from '../../shared/api';
import { buildRecentChangesJql } from '../validation';
import { errorFromStatus, mapSearchResponse } from './mapping';

/** Minimal response surface used from Forge's fetch, so tests can fake it. */
export interface JiraResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface JiraGateway {
  searchIssues(params: URLSearchParams): Promise<JiraResponse>;
  myself(): Promise<JiraResponse>;
}

const SEARCH_FIELDS = 'summary,status,issuetype,updated,project';

export async function listRecentChanges(
  gateway: JiraGateway,
  request: ListChangesRequest,
  now: () => Date = () => new Date(),
): Promise<ApiResult<ListChangesResponse>> {
  const jql = buildRecentChangesJql(request.updatedWithin);
  const params = new URLSearchParams({
    jql,
    maxResults: String(request.maxResults),
    fields: SEARCH_FIELDS,
  });

  const response = await gateway.searchIssues(params);
  if (!response.ok) {
    return { ok: false, error: errorFromStatus(response.status) };
  }
  const mapped = mapSearchResponse(await response.json());
  if (!mapped) {
    return {
      ok: false,
      error: {
        code: 'UNEXPECTED_RESPONSE',
        message: 'Jira returned a response ScenarioForge could not read.',
      },
    };
  }
  return {
    ok: true,
    data: { ...mapped, fetchedAt: now().toISOString(), jql },
  };
}

export async function checkConnection(
  gateway: JiraGateway,
  now: () => Date = () => new Date(),
): Promise<ApiResult<ConnectionStatus>> {
  const response = await gateway.myself();
  if (!response.ok) {
    return { ok: false, error: errorFromStatus(response.status) };
  }
  const body = (await response.json()) as { displayName?: unknown } | null;
  return {
    ok: true,
    data: {
      connected: true,
      userDisplayName: typeof body?.displayName === 'string' ? body.displayName : null,
      checkedAt: now().toISOString(),
    },
  };
}
