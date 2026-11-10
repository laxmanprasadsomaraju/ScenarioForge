import type {
  ChangeAnalysis,
  ChangeRecoveryFinding,
  ChangeSubject,
  LinkBasis,
} from '../analysis/types';
import { normaliseTerm } from '../analysis/text';
import type { DataOrigin, EvidenceReference } from '../domain/types';
import type {
  GraphEdge,
  GraphNode,
  GraphSource,
  ReadinessGraph,
  SourceStatus,
  UnassessedLink,
} from './types';

/**
 * Builds the M4 readiness graph from an M3 change analysis.
 *
 * Pure and deterministic: the same analysis, `builtAt` and extras always give
 * the same graph, with the same ids in the same order. No clock reads, I/O or
 * AI. Nodes and edges only restate what the analysis already holds:
 *
 * - change → subject: the change text names the subject (its M3 excerpt).
 * - subject → replacement: only when the change states a replacement.
 * - step → subject: one edge per M3 finding, with the finding's confidence
 *   and evidence; a suspected finding stays suspected.
 * - step → page: the step was read from that page's numbered list.
 *
 * Services and teams come only from `extras`, i.e. from a connected source.
 * With none connected, every runbook page with a finding gets an unassessed
 * link per missing source instead of an invented service.
 */

/** Later sources (JSM services, Teamwork Graph) add their nodes and edges here. */
export interface GraphExtras {
  /** Origin of the nodes built from the analysis. Defaults to `live`. */
  origin?: DataOrigin;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  unassessed?: UnassessedLink[];
  /** Replace the default status of a source (e.g. JSM once it is connected). */
  sources?: SourceStatus[];
}

export const NO_SERVICE_SOURCE_REASON = 'No service source is connected yet.';

/** Sources that can answer "which service does this runbook recover". */
const SERVICE_SOURCES: readonly GraphSource[] = ['jsm', 'teamwork-graph'];

/* Deterministic ids, shared with the validator. */

export function changeNodeId(changeKey: string): string {
  return `change:${changeKey}`;
}

export function subjectNodeId(term: string): string {
  return `subject:${normaliseTerm(term)}`;
}

export function pageNodeId(pageId: string): string {
  return `page:${pageId}`;
}

export function stepNodeId(pageId: string, stepOrder: number): string {
  return `step:${pageId}:${stepOrder}`;
}

/** Site-relative link: Confluence lives under `<site>/wiki`. */
function pagePath(webuiPath: string | null): string | undefined {
  return webuiPath && webuiPath.startsWith('/') && !webuiPath.startsWith('//')
    ? `/wiki${webuiPath}`
    : undefined;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Fixed sentences for each M3 link basis; never generated text. */
function basisSentence(basis: LinkBasis, finding: ChangeRecoveryFinding): string {
  switch (basis) {
    case 'term-match':
      return `Step ${finding.stepOrder} of ${finding.pageTitle} names ${finding.subject.display}.`;
    case 'page-mentions-issue':
      return `The page mentions ${finding.changeKey}.`;
    case 'issue-links-page':
      return `${finding.changeKey} links to the page.`;
  }
}

function dependsBasis(finding: ChangeRecoveryFinding): string {
  const reasons = finding.basis.map((basis) => basisSentence(basis, finding));
  const verdict =
    finding.confidence === 'confirmed'
      ? 'Confirmed by the change-to-recovery analysis: the change and the page reference each other.'
      : 'Suspected by the change-to-recovery analysis: not confirmed by an explicit cross-reference.';
  return [...reasons, verdict].join(' ');
}

const ACTION_PAST: Record<ChangeSubject['action'], string> = {
  retire: 'retired',
  replace: 'replaced',
  migrate: 'migrated',
  rename: 'renamed',
  disable: 'disabled',
  upgrade: 'upgraded',
};

function subjectEvidence(
  analysis: ChangeAnalysis,
  subject: ChangeSubject,
  origin: DataOrigin,
  suffix: string,
): EvidenceReference {
  const { change } = analysis;
  return {
    id: `${change.key}:subject:${normaliseTerm(subject.term)}:${suffix}`,
    origin,
    kind: 'jira-issue',
    title: `${change.key}: ${change.summary}`,
    excerpt: subject.excerpt,
    url: change.browsePath,
    retrievedAt: analysis.analyzedAt,
  };
}

/**
 * Confluence status from the analysis. The M3 orchestration only reports
 * Confluence problems as `notAssessedReason` text, so this maps that text:
 *
 * | Analysis                                              | Status          |
 * | ----------------------------------------------------- | --------------- |
 * | at least one page read                                | `used`          |
 * | search ran, no page mentions a subject                | `used`          |
 * | "not authorised" / "do not have permission"           | `not-permitted` |
 * | any other "Runbooks were not checked/searched" reason | `error`         |
 * | Confluence never queried (no subject, cancelled)      | `not-queried`   |
 */
export function confluenceSourceStatus(analysis: ChangeAnalysis): SourceStatus {
  const { coverage } = analysis;
  if (coverage.pagesRead > 0) {
    const skipped = coverage.pagesSkipped > 0 ? `; ${coverage.pagesSkipped} not read` : '';
    return {
      source: 'confluence',
      status: 'used',
      detail: `Read ${coverage.pagesRead} of ${plural(coverage.pagesFound, 'recovery page')} found${skipped}.`,
    };
  }
  const reason = analysis.notAssessedReason ?? '';
  if (/No Confluence recovery page you can view mentions/.test(reason)) {
    return { source: 'confluence', status: 'used', detail: reason };
  }
  if (/not authori[sz]ed|do not have permission/i.test(reason)) {
    return { source: 'confluence', status: 'not-permitted', detail: reason };
  }
  if (/^Runbooks were not (?:checked|searched):/.test(reason)) {
    return { source: 'confluence', status: 'error', detail: reason };
  }
  return {
    source: 'confluence',
    status: 'not-queried',
    detail: `Not queried for this change: ${reason || 'the analysis did not search runbooks.'}`,
  };
}

function defaultSources(analysis: ChangeAnalysis): SourceStatus[] {
  return [
    { source: 'jira', status: 'used', detail: `Read ${analysis.changeKey} as you.` },
    confluenceSourceStatus(analysis),
    { source: 'jsm', status: 'not-connected', detail: NO_SERVICE_SOURCE_REASON },
    {
      source: 'teamwork-graph',
      status: 'not-connected',
      detail: 'Teamwork Graph is not connected yet.',
    },
  ];
}

/** Insertion-ordered collections that keep the first entry per id. */
class Collector<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  add(item: T): T {
    const existing = this.items.get(item.id);
    if (existing) return existing;
    this.items.set(item.id, item);
    return item;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  values(): T[] {
    return [...this.items.values()];
  }
}

/** Adds an edge, or merges new evidence into an edge with the same id. */
function addEdge(edges: Collector<GraphEdge>, edge: GraphEdge): void {
  const kept = edges.add(edge);
  if (kept === edge) return;
  for (const evidence of edge.evidence) {
    if (!kept.evidence.some((e) => e.id === evidence.id)) kept.evidence.push(evidence);
  }
}

export function buildGraphFromAnalysis(
  analysis: ChangeAnalysis,
  builtAt: string,
  extras: GraphExtras = {},
): ReadinessGraph {
  const origin = extras.origin ?? 'live';
  const nodes = new Collector<GraphNode>();
  const edges = new Collector<GraphEdge>();
  const { change } = analysis;
  const changeId = changeNodeId(change.key);

  nodes.add({
    id: changeId,
    kind: 'change',
    label: `${change.key}: ${change.summary}`,
    origin,
    source: 'jira',
    path: change.browsePath,
  });

  const addSubject = (subject: ChangeSubject): string => {
    const id = subjectNodeId(subject.term);
    nodes.add({ id, kind: 'subject', label: subject.display, origin, source: 'm3-analysis' });
    return id;
  };

  for (const subject of analysis.subjects) {
    const subjectId = addSubject(subject);
    addEdge(edges, {
      id: `edge:names:${change.key}:${normaliseTerm(subject.term)}`,
      kind: 'change-names-subject',
      from: changeId,
      to: subjectId,
      confidence: 'confirmed',
      basis: `${change.key} says ${subject.display} is ${ACTION_PAST[subject.action]}.`,
      source: 'm3-analysis',
      evidence: [subjectEvidence(analysis, subject, origin, 'names')],
    });
  }

  for (const subject of analysis.subjects) {
    const replacement = subject.replacement?.trim();
    if (!replacement || normaliseTerm(replacement) === '') continue;
    const replacementId = subjectNodeId(replacement);
    const subjectId = subjectNodeId(subject.term);
    if (replacementId === subjectId) continue;
    nodes.add({
      id: replacementId,
      kind: 'subject',
      label: replacement,
      origin,
      source: 'm3-analysis',
    });
    addEdge(edges, {
      id: `edge:replaced-by:${normaliseTerm(subject.term)}:${normaliseTerm(replacement)}`,
      kind: 'subject-replaced-by',
      from: subjectId,
      to: replacementId,
      confidence: 'confirmed',
      basis: `${change.key} names ${replacement} as the replacement for ${subject.display}.`,
      source: 'm3-analysis',
      evidence: [subjectEvidence(analysis, subject, origin, 'replacement')],
    });
  }

  for (const page of analysis.coverage.pagesChecked) {
    const path = pagePath(page.webuiPath);
    nodes.add({
      id: pageNodeId(page.pageId),
      kind: 'runbook-page',
      label: page.title,
      origin,
      source: 'confluence',
      ...(path ? { path } : {}),
    });
  }

  const pagesWithFindings: string[] = [];
  for (const finding of analysis.findings) {
    const pageId = pageNodeId(finding.pageId);
    const stepId = stepNodeId(finding.pageId, finding.stepOrder);
    const path = pagePath(finding.pageWebuiPath);
    if (!pagesWithFindings.includes(pageId)) pagesWithFindings.push(pageId);

    nodes.add({
      id: pageId,
      kind: 'runbook-page',
      label: finding.pageTitle,
      origin,
      source: 'confluence',
      ...(path ? { path } : {}),
    });
    nodes.add({
      id: stepId,
      kind: 'runbook-step',
      label: `Step ${finding.stepOrder}`,
      origin,
      source: 'confluence',
      ...(path ? { path } : {}),
    });
    const subjectId = addSubject(finding.subject);

    const stepEvidence = finding.evidence.filter((e) => e.kind === 'confluence-page');
    addEdge(edges, {
      id: `edge:in-page:${finding.pageId}:${finding.stepOrder}`,
      kind: 'step-in-page',
      from: stepId,
      to: pageId,
      confidence: 'confirmed',
      basis: `Step ${finding.stepOrder} is item ${finding.stepOrder} of the numbered list on ${finding.pageTitle}.`,
      source: 'confluence',
      evidence: stepEvidence.map((e) => ({ ...e })),
    });
    addEdge(edges, {
      id: `edge:depends:${finding.pageId}:${finding.stepOrder}:${normaliseTerm(finding.subject.term)}`,
      kind: 'step-depends-on-subject',
      from: stepId,
      to: subjectId,
      confidence: finding.confidence,
      basis: dependsBasis(finding),
      source: 'm3-analysis',
      evidence: finding.evidence.map((e) => ({ ...e })),
    });
  }

  for (const node of extras.nodes ?? []) nodes.add({ ...node });
  for (const edge of extras.edges ?? []) {
    addEdge(edges, { ...edge, evidence: edge.evidence.map((e) => ({ ...e })) });
  }

  const sources = defaultSources(analysis).map(
    (status) => extras.sources?.find((s) => s.source === status.source) ?? status,
  );
  // A service source that is not `used` leaves every page with a finding
  // without its service: say so per page and source, never guess one.
  const unanswered = sources.filter(
    (s) => SERVICE_SOURCES.includes(s.source) && s.status !== 'used',
  );
  const unassessed: UnassessedLink[] = [];
  for (const from of pagesWithFindings) {
    for (const status of unanswered) {
      unassessed.push({
        from,
        expected: 'service',
        source: status.source,
        reason: status.status === 'not-connected' ? NO_SERVICE_SOURCE_REASON : status.detail,
      });
    }
  }
  unassessed.push(...(extras.unassessed ?? []).map((link) => ({ ...link })));

  return {
    changeKey: analysis.changeKey,
    builtAt,
    analysis,
    nodes: nodes.values(),
    edges: edges.values(),
    unassessed,
    sources: sources.map((s) => ({ ...s })),
  };
}
