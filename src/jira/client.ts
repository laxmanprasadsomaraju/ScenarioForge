import type { ChangeEvidence } from '../../shared/analysis/types';
import type {
  ApiResult,
  ConnectionStatus,
  ListChangesRequest,
  ListChangesResponse,
} from '../../shared/api';
import { buildRecentChangesJql } from '../validation';
import { errorFromStatus, mapIssueDetail, mapRemoteLinks, mapSearchResponse } from './mapping';

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

/** Single-issue reads for change analysis. `issueKey` is validated first. */
export interface JiraIssueGateway {
  /** `GET /rest/api/3/issue/{issueKey}` */
  getIssue(issueKey: string, params: URLSearchParams): Promise<JiraResponse>;
  /** `GET /rest/api/3/issue/{issueKey}/remotelink` */
  getRemoteLinks(issueKey: string): Promise<JiraResponse>;
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

export const ISSUE_DETAIL_FIELDS = 'summary,description,status,issuetype,updated';

const UNREADABLE = {
  code: 'UNEXPECTED_RESPONSE',
  message: 'Jira returned a response ScenarioForge could not read.',
} as const;

async function readJson(response: JiraResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Reads one change for analysis: its fields, then its remote links. Both run
 * as the user, so an issue the user cannot browse is a FORBIDDEN/NOT_FOUND
 * error, never partial data.
 *
 * Remote links only strengthen a finding (they can turn `suspected` into
 * `confirmed`), so a 404 from the remote link endpoint (issue linking switched
 * off on the site) yields no links rather than failing the analysis. Any other
 * remote link failure is reported as an error.
 */
export async function getChangeEvidence(
  gateway: JiraIssueGateway,
  issueKey: string,
  now: () => Date = () => new Date(),
): Promise<ApiResult<ChangeEvidence>> {
  const issueResponse = await gateway.getIssue(
    issueKey,
    new URLSearchParams({ fields: ISSUE_DETAIL_FIELDS }),
  );
  if (!issueResponse.ok) {
    return { ok: false, error: errorFromStatus(issueResponse.status) };
  }
  const detail = mapIssueDetail(await readJson(issueResponse));
  if (!detail) {
    return { ok: false, error: { ...UNREADABLE } };
  }

  const linksResponse = await gateway.getRemoteLinks(detail.key);
  let remoteLinks: ChangeEvidence['remoteLinks'] = [];
  if (linksResponse.ok) {
    const mapped = mapRemoteLinks(await readJson(linksResponse));
    if (!mapped) {
      return { ok: false, error: { ...UNREADABLE } };
    }
    remoteLinks = mapped;
  } else if (linksResponse.status !== 404) {
    return { ok: false, error: errorFromStatus(linksResponse.status) };
  }

  return { ok: true, data: { ...detail, remoteLinks, retrievedAt: now().toISOString() } };
}
