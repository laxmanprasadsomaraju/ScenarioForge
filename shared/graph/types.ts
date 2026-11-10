/**
 * M4 contract: evidence-backed readiness graph for one change.
 *
 * Owned by the lead. Lane A builds it, Lane B renders it.
 *
 * Invariants (checked by `validateGraph` and its tests):
 * - Every edge has at least one EvidenceReference from a real source.
 * - Nodes for services and teams exist only when a connected source returned
 *   them. Nothing is inferred from names, AI or similarity.
 * - What could not be checked is listed in `unassessed`, never drawn as an
 *   edge and never treated as healthy.
 * - Edge confidence follows its source: an M3 suspected finding stays
 *   suspected on the graph.
 */
import type { ChangeAnalysis } from '../analysis/types';
import type { DataOrigin, EvidenceReference } from '../domain/types';

export type GraphSource = 'jira' | 'confluence' | 'jsm' | 'teamwork-graph';

export type GraphNodeKind =
  'change' | 'subject' | 'runbook-page' | 'runbook-step' | 'service' | 'team';

export interface GraphNode {
  /** Stable, deterministic id, e.g. `change:MC-62`, `step:98305:3`. */
  id: string;
  kind: GraphNodeKind;
  label: string;
  origin: DataOrigin;
  source: GraphSource | 'm3-analysis';
  /** Site-relative link to the source (`/browse/…`, `/wiki/…`), when one exists. */
  path?: string;
}

/** Edge direction is fixed per kind and given as `from → to`. */
export type GraphEdgeKind =
  /** change → subject: the change retires, replaces, migrates… it (M3 subject). */
  | 'change-names-subject'
  /** subject → replacement subject, as named in the change text. */
  | 'subject-replaced-by'
  /** step → subject: the runbook step depends on the subject (M3 finding). */
  | 'step-depends-on-subject'
  /** step → page: the step belongs to the runbook page. */
  | 'step-in-page'
  /** page → service: the runbook recovers the service (explicit reference only). */
  | 'page-recovers-service'
  /** change → service: the change impacts the service (source relation only). */
  | 'change-impacts-service'
  /** team → service: the team owns the service (source relation only). */
  | 'team-owns-service';

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  from: string;
  to: string;
  confidence: 'confirmed' | 'suspected';
  /** Deterministic template text saying why the edge exists. */
  basis: string;
  source: GraphSource | 'm3-analysis';
  /** At least one; verbatim excerpts where the source has text. */
  evidence: EvidenceReference[];
}

/** A link that would complete the path but could not be checked. */
export interface UnassessedLink {
  /**
   * Node the missing link would attach to: the runbook page for a missing
   * service, the service (or the page when no service is known) for a team.
   */
  from: string;
  expected: 'service' | 'team';
  /** Which source would have to answer, and why it did not. */
  source: GraphSource;
  reason: string;
}

export interface SourceStatus {
  source: GraphSource;
  /**
   * `not-queried`: the source is available but this change gave nothing to
   * ask it (no subject, or a cancelled change). Not a connection problem.
   */
  status: 'used' | 'not-queried' | 'not-connected' | 'not-permitted' | 'error';
  detail: string;
}

export interface ReadinessGraph {
  changeKey: string;
  builtAt: string;
  /** The M3 analysis the graph was built from (status, coverage, findings). */
  analysis: ChangeAnalysis;
  nodes: GraphNode[];
  edges: GraphEdge[];
  unassessed: UnassessedLink[];
  sources: SourceStatus[];
}

/* Resolver contract: `getReadinessGraph` */

export interface GetReadinessGraphRequest {
  issueKey: string;
}

export type GetReadinessGraphResponse = ReadinessGraph;

/** Bounds for one graph build. */
export const MAX_GRAPH_SERVICES = 20;
export const MAX_GRAPH_TEAMS = 20;
