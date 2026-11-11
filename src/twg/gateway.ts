import type { TwgCall, TwgEnrichment, TwgRow } from '../../shared/graph/twg';
import { TWG_NOT_CONNECTED } from '../../shared/graph/twg';
import { MAX_GRAPH_SERVICES } from '../../shared/graph/types';
import type { JiraIssueGateway } from '../jira/client';

/**
 * Teamwork Graph resolver (M9, behind `SF_TWG=enabled`, off by default).
 *
 * Runs the persisted Cypher queries from docs/M4_PERMISSIONS.md §1 as the
 * signed-in user and classifies every response per §4.2. Errors are returned,
 * never thrown. Nothing here needs a manifest change to compile or test; on a
 * live install it needs the `read:graph:*` scopes in docs/M9_TWG_RUNBOOK.md.
 */

/** Fetch-style response, as `api.asUser().requestTeamworkGraph` returns. */
export interface TwgResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface TeamworkGraphGateway {
  request(
    query: string,
    variables: Record<string, unknown>,
    operationName: string,
  ): Promise<TwgResponse>;
}

export interface TwgConfig {
  /** `SF_TWG` environment variable; only the exact value `enabled` turns this on. */
  flag: string | undefined;
  /** Persisted query key of `scenarioforge_changeImpacts`. */
  impactsKey: string | undefined;
  /** Persisted query key of `scenarioforge_componentOwners`. */
  ownersKey: string | undefined;
  /** `context.cloudId` of the invocation (the ARI siteId; equality is unverified). */
  cloudId: string | undefined;
}

export function twgEnabled(flag: string | undefined): boolean {
  return flag === 'enabled';
}

/** Codes that mean "this app or user may not run this", per the persisted-queries page. */
const NOT_PERMITTED_CODES = new Set([
  'NOT_OWNER',
  'FEATURE_UNAVAILABLE',
  'QUERY_NOT_ACTIVE',
  'NOT_FOUND',
  'INSTALLATION_NOT_FOUND',
]);

const QUERY_KEY = /^[0-9a-f-]{36}$/i;
/** Site ids from the invocation context are interpolated into an ARI: restrict them. */
const CLOUD_ID = /^[A-Za-z0-9-]{1,64}$/;
/**
 * An ARI the app is willing to show or reuse as a query parameter. Anything
 * else (spaces, markup, control characters, newlines, over-long text) is
 * dropped as "not a real relationship" rather than rendered.
 */
export const SAFE_ARI = /^ari:[A-Za-z0-9:_./\-]{1,300}$/;

export function customQueryText(operationName: string): string {
  return `query ${operationName}($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges { node { columns { key value { __typename ... on CypherQueryResultNode { id } } } } }
    pageInfo { hasNextPage }
  }
}`;
}

interface Body {
  data?: { customQuery?: unknown } | null;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

interface Connection {
  edges?: Array<{ node?: { columns?: Array<{ key?: string; value?: { id?: unknown } | null }> } }>;
  pageInfo?: { hasNextPage?: boolean };
}

/** Runs one persisted query and classifies it. Never throws. */
export async function runPersistedQuery(
  gateway: TeamworkGraphGateway,
  operationName: string,
  queryKey: string,
  column: string,
  id: string,
  now: () => Date,
): Promise<TwgCall> {
  const base = { query: operationName, retrievedAt: now().toISOString() };
  let response: TwgResponse;
  try {
    response = await gateway.request(
      customQueryText(operationName),
      { queryKey, queryParams: { id } },
      operationName,
    );
  } catch {
    return { ...base, status: 'error', reason: 'Teamwork Graph call failed.' };
  }
  if (response.status === 401 || response.status === 403) {
    return { ...base, status: 'not-permitted', reason: `HTTP ${response.status}` };
  }
  if (!response.ok) {
    return { ...base, status: 'error', reason: `HTTP ${response.status}` };
  }
  let body: Body;
  try {
    body = (await response.json()) as Body;
  } catch {
    return { ...base, status: 'error', reason: 'Unexpected response shape.' };
  }
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    // HTTP 200 with GraphQL errors is a failure, never an empty success.
    const code = body.errors[0]?.extensions?.code ?? 'UNKNOWN';
    const status = NOT_PERMITTED_CODES.has(code) ? 'not-permitted' : 'error';
    const hint =
      code === 'QUERY_NOT_FOUND' ? ' (new queries take about a minute to propagate)' : '';
    return { ...base, status, reason: `GraphQL error ${code}${hint}.` };
  }
  const conn = body?.data?.customQuery as Connection | null | undefined;
  if (!conn || !Array.isArray(conn.edges)) {
    return { ...base, status: 'error', reason: 'Unexpected response shape.' };
  }
  const rows: TwgRow[] = [];
  for (const edge of conn.edges) {
    const value = edge.node?.columns?.find((c) => c.key === column)?.value;
    if (value && typeof value.id === 'string' && SAFE_ARI.test(value.id)) {
      if (!rows.some((r) => r.ari === value.id)) rows.push({ ari: value.id });
    }
  }
  if (rows.length === 0) return { ...base, status: 'empty' };
  return { ...base, status: 'ok', rows, truncated: conn.pageInfo?.hasNextPage === true };
}

/**
 * Builds the enrichment for one change: resolve the work item ARI with a
 * `fields=none` issue read (existing `read:jira-work`), run
 * `scenarioforge_changeImpacts`, then `scenarioforge_componentOwners` once per
 * returned component (bounded by MAX_GRAPH_SERVICES, sequential for rate limits).
 */
export async function resolveTwgEnrichment(
  deps: { twg: TeamworkGraphGateway; jira: JiraIssueGateway; now?: () => Date },
  config: TwgConfig,
  issueKey: string,
): Promise<TwgEnrichment> {
  if (!twgEnabled(config.flag)) {
    return { kind: 'not-connected', detail: TWG_NOT_CONNECTED };
  }
  if (
    !config.impactsKey ||
    !QUERY_KEY.test(config.impactsKey) ||
    !config.ownersKey ||
    !QUERY_KEY.test(config.ownersKey)
  ) {
    return { kind: 'not-connected', detail: 'Teamwork Graph query keys are not configured.' };
  }
  if (!config.cloudId || !CLOUD_ID.test(config.cloudId)) {
    return { kind: 'error', detail: 'No usable site id in the invocation context.' };
  }
  const now = deps.now ?? (() => new Date());
  let issueId: string | undefined;
  try {
    const r = await deps.jira.getIssue(issueKey, new URLSearchParams({ fields: 'none' }));
    if (r.ok) issueId = ((await r.json()) as { id?: unknown })?.id as string | undefined;
  } catch {
    issueId = undefined;
  }
  if (typeof issueId !== 'string' || !/^[0-9]+$/.test(issueId)) {
    return { kind: 'error', detail: 'Could not read the work item id for Teamwork Graph.' };
  }
  const issueAri = `ari:cloud:jira:${config.cloudId}:issue/${issueId}`;
  const impacts = await runPersistedQuery(
    deps.twg,
    'scenarioforge_changeImpacts',
    config.impactsKey,
    'component',
    issueAri,
    now,
  );
  const owners: Array<{ serviceAri: string; call: TwgCall }> = [];
  if (impacts.status === 'ok') {
    for (const row of impacts.rows.slice(0, MAX_GRAPH_SERVICES)) {
      const call = await runPersistedQuery(
        deps.twg,
        'scenarioforge_componentOwners',
        config.ownersKey,
        'team',
        row.ari,
        now,
      );
      owners.push({ serviceAri: row.ari, call });
    }
  }
  return { kind: 'read', issueKey, issueAri, impacts, owners };
}
