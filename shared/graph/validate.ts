import { normaliseTerm } from '../analysis/text';
import { stepNodeId, subjectNodeId } from './build';
import type { GraphSource, ReadinessGraph } from './types';
import { MAX_GRAPH_SERVICES, MAX_GRAPH_TEAMS } from './types';

/** Sources that may introduce a service or team (never the M3 engine). */
const SERVICE_TEAM_SOURCES: readonly (GraphSource | 'm3-analysis')[] = [
  'jsm',
  'teamwork-graph',
  'jira',
];

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

/**
 * Checks the graph invariants from `shared/graph/types.ts`. Pure; returns one
 * plain sentence per problem, or an empty list for a valid graph. The resolver
 * never returns a graph with problems.
 *
 * - No duplicate node or edge ids.
 * - Every edge has at least one evidence reference from a real source, and
 *   both of its endpoints exist.
 * - A service or team node comes from JSM, Teamwork Graph or Jira and is the
 *   endpoint of at least one edge from one of those sources; within bounds.
 * - Step → subject edges match an M3 finding one to one, with the finding's
 *   confidence (a suspected finding never becomes confirmed).
 * - Unassessed links start from a node that exists.
 */
export function validateGraph(graph: ReadinessGraph): string[] {
  const problems: string[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  for (const id of duplicates(graph.nodes.map((n) => n.id))) {
    problems.push(`Duplicate node id ${id}.`);
  }
  for (const id of duplicates(graph.edges.map((e) => e.id))) {
    problems.push(`Duplicate edge id ${id}.`);
  }

  for (const edge of graph.edges) {
    if (edge.evidence.length === 0) {
      problems.push(`Edge ${edge.id} has no evidence.`);
    }
    if (edge.evidence.some((e) => e.kind === 'scenario-rule')) {
      problems.push(`Edge ${edge.id} cites a scenario rule instead of a real source.`);
    }
    if (!nodeIds.has(edge.from)) {
      problems.push(`Edge ${edge.id} starts from missing node ${edge.from}.`);
    }
    if (!nodeIds.has(edge.to)) {
      problems.push(`Edge ${edge.id} points to missing node ${edge.to}.`);
    }
  }

  let services = 0;
  let teams = 0;
  for (const node of graph.nodes) {
    if (node.kind !== 'service' && node.kind !== 'team') continue;
    if (node.kind === 'service') services += 1;
    else teams += 1;
    if (!SERVICE_TEAM_SOURCES.includes(node.source)) {
      problems.push(`${node.kind} node ${node.id} does not come from a connected source.`);
    }
    const sourced = graph.edges.some(
      (edge) =>
        (edge.from === node.id || edge.to === node.id) &&
        SERVICE_TEAM_SOURCES.includes(edge.source) &&
        edge.evidence.length > 0,
    );
    if (!sourced) {
      problems.push(`${node.kind} node ${node.id} has no edge from a connected source.`);
    }
  }
  if (services > MAX_GRAPH_SERVICES) {
    problems.push(`The graph has ${services} services; at most ${MAX_GRAPH_SERVICES} are allowed.`);
  }
  if (teams > MAX_GRAPH_TEAMS) {
    problems.push(`The graph has ${teams} teams; at most ${MAX_GRAPH_TEAMS} are allowed.`);
  }

  const findingEdges = new Map(
    graph.analysis.findings.map((finding) => [
      `${stepNodeId(finding.pageId, finding.stepOrder)}>${subjectNodeId(finding.subject.term)}`,
      finding,
    ]),
  );
  const matched = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'step-depends-on-subject') continue;
    const key = `${edge.from}>${edge.to}`;
    const finding = findingEdges.get(key);
    if (!finding) {
      problems.push(`Edge ${edge.id} has no matching finding in the analysis.`);
      continue;
    }
    matched.add(key);
    if (edge.confidence !== finding.confidence) {
      problems.push(
        `Edge ${edge.id} is ${edge.confidence} but its finding is ${finding.confidence}.`,
      );
    }
  }
  for (const [key, finding] of findingEdges) {
    if (!matched.has(key)) {
      problems.push(
        `Finding ${finding.id} (${normaliseTerm(finding.subject.term)}) has no step edge.`,
      );
    }
  }

  for (const link of graph.unassessed) {
    if (!nodeIds.has(link.from)) {
      problems.push(`Unassessed ${link.expected} link starts from missing node ${link.from}.`);
    }
  }

  return problems;
}
