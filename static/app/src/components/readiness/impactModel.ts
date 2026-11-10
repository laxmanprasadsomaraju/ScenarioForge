import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  ReadinessGraph,
  UnassessedLink,
} from '@shared/graph/types';

/**
 * Reads a readiness graph as impact paths: change, subject, recovery step,
 * runbook page, service, owning team. Pure and deterministic. A service or a
 * team appears only when the graph has a node and an edge for it; anything
 * else is reported as `missing` with the reason the graph gave, or as `none`.
 */

/** A node reached through one evidenced edge. */
export interface Hop {
  node: GraphNode;
  edge: GraphEdge;
}

export type Slot =
  | { kind: 'hops'; hops: Hop[] }
  | { kind: 'not-assessed'; links: UnassessedLink[] }
  | { kind: 'none' };

export interface ImpactRow {
  id: string;
  step: Hop;
  page: Hop | null;
  service: Hop | null;
  /** Shown once per row; when a page has several services, each gets a row. */
  serviceSlot: Slot;
  teamSlot: Slot;
}

export interface SubjectGroup {
  subject: Hop | { node: GraphNode; edge: null };
  replacedBy: Hop[];
  rows: ImpactRow[];
}

export interface ImpactModel {
  change: GraphNode | null;
  groups: SubjectGroup[];
  /** Services the change impacts directly (a source relation, not via a runbook). */
  direct: { service: Hop; teamSlot: Slot }[];
  /** Unassessed links not tied to any path shown above. */
  otherUnassessed: UnassessedLink[];
}

export function buildImpactModel(graph: ReadinessGraph): ImpactModel {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const used = new Set<UnassessedLink>();

  const edgesOf = (kind: GraphEdgeKind) => graph.edges.filter((e) => e.kind === kind);
  /** Nodes of `kind` joined to `id` by an edge of `edgeKind`, in either direction. */
  const linked = (id: string, edgeKind: GraphEdgeKind, kind: GraphNode['kind']): Hop[] => {
    const hops: Hop[] = [];
    for (const edge of edgesOf(edgeKind)) {
      const otherId = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
      const node = otherId ? nodes.get(otherId) : undefined;
      if (node && node.kind === kind) hops.push({ node, edge });
    }
    return hops;
  };
  const unassessed = (fromIds: string[], expected: UnassessedLink['expected']) => {
    const found = graph.unassessed.filter(
      (u) => u.expected === expected && fromIds.includes(u.from),
    );
    found.forEach((u) => used.add(u));
    return found;
  };
  const slot = (hops: Hop[], fromIds: string[], expected: UnassessedLink['expected']): Slot => {
    if (hops.length > 0) return { kind: 'hops', hops };
    const links = unassessed(fromIds, expected);
    return links.length > 0 ? { kind: 'not-assessed', links } : { kind: 'none' };
  };
  const teamSlot = (service: Hop | null, chain: string[]): Slot =>
    service
      ? slot(
          linked(service.node.id, 'team-owns-service', 'team'),
          [service.node.id, ...chain],
          'team',
        )
      : slot([], chain, 'team');

  const change = graph.nodes.find((n) => n.kind === 'change') ?? null;
  const changeId = change?.id ?? `change:${graph.changeKey}`;

  const named = linked(changeId, 'change-names-subject', 'subject');
  const replacementIds = new Set(edgesOf('subject-replaced-by').map((e) => e.to));
  const unnamed = graph.nodes
    .filter(
      (n) =>
        n.kind === 'subject' && !replacementIds.has(n.id) && !named.some((h) => h.node.id === n.id),
    )
    .map((node) => ({ node, edge: null }));

  const groups: SubjectGroup[] = [...named, ...unnamed].map((subject) => {
    const subjectId = subject.node.id;
    const replacedBy = edgesOf('subject-replaced-by')
      .filter((e) => e.from === subjectId)
      .flatMap((edge) => {
        const node = nodes.get(edge.to);
        return node ? [{ node, edge }] : [];
      });
    const rows: ImpactRow[] = [];
    for (const step of linked(subjectId, 'step-depends-on-subject', 'runbook-step')) {
      const page = linked(step.node.id, 'step-in-page', 'runbook-page')[0] ?? null;
      const chain = [changeId, subjectId, step.node.id, ...(page ? [page.node.id] : [])];
      const services = page ? linked(page.node.id, 'page-recovers-service', 'service') : [];
      if (services.length === 0) {
        rows.push({
          id: `${subjectId}|${step.node.id}`,
          step,
          page,
          service: null,
          serviceSlot: slot([], chain, 'service'),
          teamSlot: teamSlot(null, chain),
        });
        continue;
      }
      for (const service of services) {
        rows.push({
          id: `${subjectId}|${step.node.id}|${service.node.id}`,
          step,
          page,
          service,
          serviceSlot: { kind: 'hops', hops: [service] },
          teamSlot: teamSlot(service, chain),
        });
      }
    }
    return { subject, replacedBy, rows };
  });

  const direct = linked(changeId, 'change-impacts-service', 'service').map((service) => ({
    service,
    teamSlot: teamSlot(service, [changeId]),
  }));

  return {
    change,
    groups,
    direct,
    otherUnassessed: graph.unassessed.filter((u) => !used.has(u)),
  };
}
