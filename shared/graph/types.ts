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

export type GraphEdgeKind =
  /** Change names a subject it retires, replaces, migrates… (M3 subject). */
  | 'change-names-subject'
  /** Subject is replaced by another named system (from the change text). */
  | 'subject-replaced-by'
  /** A runbook step depends on the subject (M3 finding). */
  | 'step-depends-on-subject'
  /** The step belongs to a runbook page. */
  | 'step-in-page'
  /** The runbook page recovers a service (explicit reference only). */
  | 'page-recovers-service'
  /** The change impacts a service (source relation only). */
  | 'change-impacts-service'
  /** A team owns the service (source relation only). */
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
  /** Node the missing link would start from (e.g. a runbook page). */
  from: string;
  expected: 'service' | 'team';
  /** Which source would have to answer, and why it did not. */
  source: GraphSource;
  reason: string;
}

export interface SourceStatus {
  source: GraphSource;
  status: 'used' | 'not-connected' | 'not-permitted' | 'error';
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
