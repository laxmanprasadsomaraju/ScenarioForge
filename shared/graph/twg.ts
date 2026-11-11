import type { ChangeAnalysis } from '../analysis/types';
import type { EvidenceReference } from '../domain/types';
import type { GraphExtras } from './build';
import { changeNodeId } from './build';
import type { GraphEdge, GraphNode, SourceStatus, UnassessedLink } from './types';
import { MAX_GRAPH_SERVICES, MAX_GRAPH_TEAMS } from './types';

/**
 * Teamwork Graph persisted-query results → readiness graph extras (M9, behind
 * `SF_TWG=enabled`). Mapping per docs/M4_PERMISSIONS.md §4.1 and §4.2.
 *
 * Service and team nodes exist only for rows Teamwork Graph returned. An empty
 * result is never "no service": a disabled scope also returns empty.
 */

/** One row from a persisted query: the ARI of the returned object. */
export interface TwgRow {
  ari: string;
}

/** Outcome of one Teamwork Graph call, classified per M4_PERMISSIONS §4.2. */
export type TwgCall =
  | { status: 'ok'; rows: TwgRow[]; truncated: boolean; query: string; retrievedAt: string }
  | { status: 'empty'; query: string; retrievedAt: string }
  | { status: 'not-permitted' | 'error'; reason: string; query: string; retrievedAt: string };

/** What the gateway learned for one change. */
export type TwgEnrichment =
  /** Flag off, or no persisted query keys configured. */
  | { kind: 'not-connected'; detail: string }
  /** The change's work item ARI could not be built (issue read failed). */
  | { kind: 'error'; detail: string }
  | {
      kind: 'read';
      issueKey: string;
      issueAri: string;
      impacts: TwgCall;
      /** One owners call per returned component, in row order. */
      owners: Array<{ serviceAri: string; call: TwgCall }>;
    };

export const TWG_NOT_CONNECTED = 'Teamwork Graph is not connected yet.';
export const TWG_EMPTY_NOTE =
  'A disabled scope also returns empty, so this is not evidence that none exists.';

export function twgServiceNodeId(componentAri: string): string {
  return `service:${componentAri}`;
}

export function twgTeamNodeId(teamAri: string): string {
  return `team:${teamAri}`;
}

function evidence(call: Extract<TwgCall, { status: 'ok' }>, ari: string): EvidenceReference {
  return {
    id: `twg:${call.query}:${ari}`,
    origin: 'live',
    kind: 'teamwork-graph',
    title: `Teamwork Graph ${call.query}`,
    excerpt: ari,
    retrievedAt: call.retrievedAt,
  };
}

function failureReason(call: Exclude<TwgCall, { status: 'ok' }>, subject: string): string {
  if (call.status === 'empty') {
    return `Teamwork Graph returned no ${subject} (${call.query}). ${TWG_EMPTY_NOTE}`;
  }
  return `Teamwork Graph ${call.query}: ${call.reason}`;
}

/**
 * Pure and deterministic.
 *
 * - `not-connected` / `error`: only the source status; the builder lists the
 *   missing service per runbook page.
 * - `read`: the source is `used` when the impacts call answered (ok or empty);
 *   `not-permitted` / `error` otherwise. Rows become `service` nodes with a
 *   confirmed `change-impacts-service` edge; owner rows become `team` nodes
 *   with a confirmed `team-owns-service` edge. Every non-ok call becomes an
 *   `UnassessedLink`, never an edge and never healthy.
 */
export function twgGraphExtras(
  analysis: ChangeAnalysis,
  enrichment: TwgEnrichment,
): Pick<GraphExtras, 'nodes' | 'edges' | 'unassessed' | 'sources'> {
  if (enrichment.kind !== 'read') {
    return {
      sources: [{ source: 'teamwork-graph', status: enrichment.kind, detail: enrichment.detail }],
    };
  }
  const changeId = changeNodeId(analysis.change.key);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const unassessed: UnassessedLink[] = [];
  const { impacts } = enrichment;

  if (impacts.status !== 'ok') {
    unassessed.push({
      from: changeId,
      expected: 'service',
      source: 'teamwork-graph',
      reason: failureReason(impacts, 'impacted service'),
    });
    const status: SourceStatus =
      impacts.status === 'empty'
        ? {
            source: 'teamwork-graph',
            status: 'used',
            detail: `Teamwork Graph returned 0 services for ${enrichment.issueKey}. ${TWG_EMPTY_NOTE}`,
          }
        : { source: 'teamwork-graph', status: impacts.status, detail: impacts.reason };
    return { unassessed, sources: [status] };
  }

  const components = impacts.rows.slice(0, MAX_GRAPH_SERVICES);
  for (const row of components) {
    const serviceId = twgServiceNodeId(row.ari);
    nodes.push({
      id: serviceId,
      kind: 'service',
      label: row.ari,
      origin: 'live',
      source: 'teamwork-graph',
    });
    edges.push({
      id: `edge:impacts:twg:${enrichment.issueKey}:${row.ari}`,
      kind: 'change-impacts-service',
      from: changeId,
      to: serviceId,
      confidence: 'confirmed',
      basis: `Teamwork Graph relates ${enrichment.issueKey} to this component (jira_work_item_impacts_compass_component).`,
      source: 'teamwork-graph',
      evidence: [evidence(impacts, row.ari)],
    });
  }

  let teamCount = 0;
  for (const row of components) {
    const serviceId = twgServiceNodeId(row.ari);
    const owner = enrichment.owners.find((o) => o.serviceAri === row.ari);
    const call = owner?.call;
    if (!call || call.status !== 'ok') {
      unassessed.push({
        from: serviceId,
        expected: 'team',
        source: 'teamwork-graph',
        reason: call ? failureReason(call, 'owning team') : 'Owning team not queried.',
      });
      continue;
    }
    for (const team of call.rows) {
      if (teamCount >= MAX_GRAPH_TEAMS) break;
      const teamId = twgTeamNodeId(team.ari);
      if (!nodes.some((n) => n.id === teamId)) {
        teamCount += 1;
        nodes.push({
          id: teamId,
          kind: 'team',
          label: team.ari,
          origin: 'live',
          source: 'teamwork-graph',
        });
      }
      edges.push({
        id: `edge:owns:twg:${team.ari}:${row.ari}`,
        kind: 'team-owns-service',
        from: teamId,
        to: serviceId,
        confidence: 'confirmed',
        basis:
          'Teamwork Graph says this team owns the component (atlassian_team_owns_compass_component).',
        source: 'teamwork-graph',
        evidence: [evidence(call, team.ari)],
      });
    }
  }

  const parts = [
    `Teamwork Graph returned ${impacts.rows.length} service(s) for ${enrichment.issueKey}.`,
  ];
  if (impacts.rows.length > components.length || impacts.truncated) {
    parts.push(`Showing the first ${components.length}; more were available.`);
  }
  return {
    nodes,
    edges,
    unassessed,
    sources: [{ source: 'teamwork-graph', status: 'used', detail: parts.join(' ') }],
  };
}

/** Merges extras from several sources (JSM, Teamwork Graph) for one build. */
export function mergeGraphExtras(
  ...parts: Array<Pick<GraphExtras, 'nodes' | 'edges' | 'unassessed' | 'sources'>>
): Pick<GraphExtras, 'nodes' | 'edges' | 'unassessed' | 'sources'> {
  return {
    nodes: parts.flatMap((p) => p.nodes ?? []),
    edges: parts.flatMap((p) => p.edges ?? []),
    unassessed: parts.flatMap((p) => p.unassessed ?? []),
    sources: parts.flatMap((p) => p.sources ?? []),
  };
}
