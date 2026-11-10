import type {
  AnalysisCoverage,
  ChangeAnalysis,
  ChangeRecoveryFinding,
  LinkBasis,
} from '../../shared/analysis/types';
import type {
  ActionEvidenceQuote,
  ActionVerdict,
  ChangeRecoveryRiskItem,
  ConfirmationHint,
  ImpactPathEdge,
  M6PayloadLimits,
} from '../../shared/agents/contracts';
import type { DataOrigin, EvidenceReference } from '../../shared/domain/types';
import type { ReadinessGraph } from '../../shared/graph/types';

/**
 * Output builders for the M6 actions (docs/M6_PLAN.md §3, §4.1). Every text
 * here is a fixed template filled with engine values; nothing is generated.
 * Source text is copied verbatim into data fields only, cut at
 * `maxExcerptChars` and marked `truncated`, never rewritten.
 */

export const PAYLOAD_LIMITS: M6PayloadLimits = {
  maxFindings: 10,
  maxEdges: 40,
  maxExcerptChars: 500,
};

/**
 * Fixed note on every M6 result. The governor limits what ScenarioForge's
 * actions add; the user's Rovo chat message is charged by Rovo before the
 * action runs, outside this guard (docs/AI_USAGE_GOVERNANCE.md §1).
 */
export const USAGE_NOTE =
  "ScenarioForge limits and counts its own usage for this action. Rovo charges credits for the user's chat message separately; that charge is outside ScenarioForge's usage limit.";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Cuts at a code point boundary so a cut never splits a character. */
export function capExcerpt(text: string | undefined | null): {
  excerpt: string | null;
  truncated: boolean;
} {
  if (typeof text !== 'string' || text.length === 0) return { excerpt: null, truncated: false };
  const points = Array.from(text);
  if (points.length <= PAYLOAD_LIMITS.maxExcerptChars) return { excerpt: text, truncated: false };
  return { excerpt: points.slice(0, PAYLOAD_LIMITS.maxExcerptChars).join(''), truncated: true };
}

/** Site-relative paths only (`/browse/…`, `/wiki/…`); anything else is dropped. */
export function sitePath(url: string | null | undefined): string | null {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
}

export function toQuote(evidence: EvidenceReference): ActionEvidenceQuote {
  const { excerpt, truncated } = capExcerpt(evidence.excerpt);
  return {
    id: evidence.id,
    kind: evidence.kind,
    title: evidence.title,
    excerpt,
    truncated,
    path: sitePath(evidence.url),
    retrievedAt: evidence.retrievedAt ?? null,
  };
}

/** `demo` when any evidence is demo data; reads through the gateways are live. */
export function originOf(evidence: readonly EvidenceReference[]): DataOrigin {
  return evidence.some((e) => e.origin === 'demo') ? 'demo' : 'live';
}

export function pagePath(webuiPath: string | null): string | null {
  return webuiPath && webuiPath.startsWith('/') && !webuiPath.startsWith('//')
    ? `/wiki${webuiPath}`
    : null;
}

// Verdicts --------------------------------------------------------------------

export function analysisVerdict(analysis: ChangeAnalysis): ActionVerdict {
  if (analysis.status === 'not-assessed') {
    return {
      kind: 'not-assessed',
      statement: `Not assessed: ${analysis.notAssessedReason ?? 'ScenarioForge could not assess this change.'}`,
    };
  }
  if (analysis.status === 'no-findings') {
    return {
      kind: 'no-findings',
      statement: `No findings in the ${plural(analysis.coverage.pagesRead, 'page')} read. This is not a readiness pass.`,
    };
  }
  const confirmed = analysis.findings.filter((f) => f.confidence === 'confirmed').length;
  const suspected = analysis.findings.length - confirmed;
  return {
    kind: 'findings',
    statement: `${plural(analysis.findings.length, 'finding')}: ${confirmed} confirmed, ${suspected} suspected.`,
  };
}

/** Parts of the analysis that were not assessed, as fixed sentences. */
export function analysisUnknowns(analysis: ChangeAnalysis): string[] {
  const unknowns: string[] = [];
  if (analysis.status === 'not-assessed') {
    unknowns.push(
      `Not assessed: ${analysis.notAssessedReason ?? 'ScenarioForge could not assess this change.'}`,
    );
  }
  const { pagesSkipped, pagesWithoutSteps } = analysis.coverage;
  if (pagesSkipped > 0) {
    unknowns.push(`${plural(pagesSkipped, 'recovery page')} found but not read; not assessed.`);
  }
  if (pagesWithoutSteps > 0) {
    unknowns.push(
      `${plural(pagesWithoutSteps, 'page')} read without numbered steps; steps not checked.`,
    );
  }
  return unknowns;
}

export function copyCoverage(coverage: AnalysisCoverage): AnalysisCoverage {
  return { ...coverage, pagesChecked: coverage.pagesChecked.map((p) => ({ ...p })) };
}

// Findings --------------------------------------------------------------------

const CROSS_REFERENCES: Extract<LinkBasis, 'page-mentions-issue' | 'issue-links-page'>[] = [
  'issue-links-page',
  'page-mentions-issue',
];

/**
 * What would raise a suspected finding, from the engine's rule: `confirmed`
 * needs an explicit cross-reference plus a term match. When a cross-reference
 * already exists the engine kept the finding suspected for another reason
 * (stated in `explanation`), so no cross-reference is suggested.
 */
export function confirmationHint(
  finding: ChangeRecoveryFinding,
  browsePath: string,
): ConfirmationHint | null {
  if (finding.confidence !== 'suspected') return null;
  const page = pagePath(finding.pageWebuiPath);
  const checkPaths = [browsePath, ...(page ? [page] : [])];
  const missing = CROSS_REFERENCES.filter((basis) => !finding.basis.includes(basis));
  if (missing.length < CROSS_REFERENCES.length) {
    return {
      missing: [],
      checkPaths,
      statement: `A cross-reference between ${finding.changeKey} and "${finding.pageTitle}" already exists; this finding stays suspected for the reason in its explanation.`,
    };
  }
  return {
    missing,
    checkPaths,
    statement: `To confirm, add a link from ${finding.changeKey} to the page "${finding.pageTitle}", or mention ${finding.changeKey} on that page.`,
  };
}

export function toRiskItem(
  finding: ChangeRecoveryFinding,
  browsePath: string,
): ChangeRecoveryRiskItem {
  return {
    findingId: finding.id,
    confidence: finding.confidence,
    pageTitle: finding.pageTitle,
    pagePath: pagePath(finding.pageWebuiPath),
    stepOrder: finding.stepOrder,
    subject: {
      display: finding.subject.display,
      action: finding.subject.action,
      replacement: finding.subject.replacement ?? null,
    },
    basis: [...finding.basis],
    explanation: finding.explanation,
    toConfirm: confirmationHint(finding, browsePath),
    evidence: finding.evidence.map(toQuote),
  };
}

// Graph -------------------------------------------------------------------------

export function graphVerdict(graph: ReadinessGraph): ActionVerdict {
  const base = analysisVerdict(graph.analysis);
  if (base.kind !== 'findings') return base;
  return {
    kind: 'findings',
    statement: `${base.statement} ${plural(graph.edges.length, 'impact path edge')}; ${plural(graph.unassessed.length, 'link')} not assessed.`,
  };
}

/** Edges whose endpoints are both nodes of the graph; validateGraph guarantees this. */
export function toImpactEdges(graph: ReadinessGraph): ImpactPathEdge[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges.flatMap((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) return [];
    return [
      {
        kind: edge.kind,
        from: { id: from.id, kind: from.kind, label: from.label },
        to: { id: to.id, kind: to.kind, label: to.label },
        confidence: edge.confidence,
        basis: edge.basis,
        source: edge.source,
        evidence: edge.evidence.map(toQuote),
      },
    ];
  });
}

export function graphUnknowns(graph: ReadinessGraph): string[] {
  return [
    ...analysisUnknowns(graph.analysis),
    ...graph.unassessed.map((u) => `Not assessed (${u.expected}, ${u.source}): ${u.reason}`),
  ];
}

// In-app paths --------------------------------------------------------------------

/** Readiness check for one change in the ScenarioForge global page. */
export function readinessAppPath(changeKey: string): string {
  return `/readiness-checks?${new URLSearchParams({ change: changeKey })}`;
}

/** Simulations screen with the inputs that regenerate the same rehearsal. */
export function rehearsalAppPath(input: {
  changeKey: string;
  findingId: string;
  restoreTargetMinutes: number;
  notifyTargetMinutes?: number;
}): string {
  const params = new URLSearchParams({
    change: input.changeKey,
    finding: input.findingId,
    restore: String(input.restoreTargetMinutes),
  });
  if (input.notifyTargetMinutes !== undefined) {
    params.set('notify', String(input.notifyTargetMinutes));
  }
  return `/simulations?${params}`;
}
