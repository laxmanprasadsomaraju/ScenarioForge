import type { EvidenceReference } from '../domain/types';
import { readChange } from './subjects';
import { mentionsIssueKey, mentionsTerm, normaliseTerm } from './text';
import type {
  AnalysisCoverage,
  ChangeAnalysis,
  ChangeEvidence,
  ChangeRecoveryFinding,
  ChangeSubject,
  LinkBasis,
  RunbookEvidence,
} from './types';

/**
 * Change-to-recovery analysis engine (M3).
 *
 * Links a Jira change to the recovery runbook steps it may break. Pure and
 * deterministic: the same change, runbooks and `analyzedAt` always produce the
 * same result. No clock reads, randomness, I/O or AI; inputs are not mutated.
 *
 * Rules:
 * - A step is linked when its text names a subject as a whole word
 *   (`term-match`). Steps are only read from pages whose steps came from an
 *   ordered list; prose is never searched for steps.
 * - A step is not linked when it marks the subject as superseded ("formerly",
 *   "no longer", "do not use", "replaced by", "retired", "history"), and a
 *   step that names only the replacement is never linked.
 * - `confirmed` needs a term match plus an explicit cross-reference: the page
 *   names the issue key (`page-mentions-issue`) or the issue has a remote link
 *   to the page (`issue-links-page`). It is capped at `suspected` when the
 *   change states a partial scope or the step also names the replacement.
 * - "No findings" is reported with coverage and never means "ready".
 */

export const NOT_ASSESSED_NO_SUBJECTS =
  'No retirement, replacement or migration was recognised in this change.';
export const NOT_ASSESSED_NO_RUNBOOKS = 'No recovery runbooks could be read.';
export const NOT_ASSESSED_NO_STEPS =
  'None of the recovery runbooks read has numbered steps, so no step could be checked.';
export const NOT_ASSESSED_CANCELLED =
  'This change says the work is cancelled or will not go ahead, so no runbook step was checked against it.';

/** Counts the caller knows from the search; the engine only sees pages read. */
export interface SearchCoverage {
  /** Recovery pages returned by the search. Defaults to pages read plus skipped. */
  pagesFound?: number;
  /** Pages found but not read. Defaults to 0. */
  pagesSkipped?: number;
}

/** Words in a step that mark a subject as already superseded or historical. */
const STEP_SUPERSEDED =
  /\b(?:formerly|previously|no longer|do not use|don't use|instead of|(?:was|were|has been|have been) replaced|replaced by|retired|decommissioned|deprecated|historical|history)\b/i;

const ACTION_VERB: Record<ChangeSubject['action'], string> = {
  retire: 'retires',
  replace: 'replaces',
  migrate: 'migrates',
  rename: 'renames',
  disable: 'disables',
  upgrade: 'upgrades',
};

function describeChange(subject: ChangeSubject, partial: boolean): string {
  const { action, display, replacement } = subject;
  const object = partial ? `part of ${display}` : display;
  if (replacement && action === 'replace') return `replaces ${object} with ${replacement}`;
  if (replacement && (action === 'migrate' || action === 'rename' || action === 'upgrade')) {
    return `${ACTION_VERB[action]} ${object} to ${replacement}`;
  }
  return `${ACTION_VERB[action]} ${object}`;
}

interface ExplanationInput {
  changeKey: string;
  pageTitle: string;
  stepOrder: number;
  subject: ChangeSubject;
  partial: boolean;
  stepNamesReplacement: boolean;
  crossReferences: LinkBasis[];
  confirmed: boolean;
}

/** Fixed templates only; never generated text. */
function explain(input: ExplanationInput): string {
  const { changeKey, pageTitle, stepOrder, subject, partial } = input;
  const where = `step ${stepOrder} of ${pageTitle}`;
  const parts: string[] = [];
  const change = `${changeKey} ${describeChange(subject, partial)}`;
  if (subject.action === 'upgrade') {
    parts.push(`${change}; ${where} refers to it and may need review.`);
  } else if (subject.action === 'rename') {
    parts.push(`${change}, but ${where} still uses the old name.`);
  } else {
    parts.push(`${change}, but ${where} still depends on it.`);
  }
  if (subject.replacement && (subject.action === 'retire' || subject.action === 'disable')) {
    parts.push(`The change names ${subject.replacement} as the replacement.`);
  }
  if (partial) {
    parts.push(
      `The change states a partial scope, so ${subject.display} may still be needed; check which part this step covers.`,
    );
  }
  if (input.stepNamesReplacement && subject.replacement) {
    parts.push(
      `The step also names ${subject.replacement}; check whether it already covers the change.`,
    );
  }
  const reasons = input.crossReferences.map((basis) =>
    basis === 'page-mentions-issue'
      ? `the page mentions ${changeKey}`
      : `${changeKey} links to this page`,
  );
  if (input.confirmed) {
    parts.push(`Confirmed: ${reasons.join(' and ')}.`);
  } else if (reasons.length > 0) {
    parts.push(
      `Suspected: ${reasons.join(' and ')}, but ${partial ? 'the change is partial' : 'the step also names the replacement'}.`,
    );
  } else {
    parts.push(
      'Suspected: the step names the same term, but the change and the page do not reference each other.',
    );
  }
  return parts.join(' ');
}

function issueLinksPage(change: ChangeEvidence, runbook: RunbookEvidence): boolean {
  const pagePath = new RegExp(`/pages/${runbook.pageId}(?![0-9])`);
  const pageParam = new RegExp(`[?&]pageId=${runbook.pageId}(?![0-9])`);
  return change.remoteLinks.some(
    (link) =>
      pagePath.test(link.url) ||
      pageParam.test(link.url) ||
      (runbook.webuiPath !== null && link.url.includes(runbook.webuiPath)),
  );
}

/** Relative link to the page: Confluence lives under `<site>/wiki`. */
function pageUrl(webuiPath: string | null): string | undefined {
  return webuiPath && webuiPath.startsWith('/') && !webuiPath.startsWith('//')
    ? `/wiki${webuiPath}`
    : undefined;
}

function hasSteps(runbook: RunbookEvidence): boolean {
  return runbook.stepSource === 'ordered-list' && runbook.steps.length > 0;
}

function uniqueRunbooks(runbooks: readonly RunbookEvidence[]): RunbookEvidence[] {
  const seen = new Set<string>();
  return runbooks.filter((runbook) => {
    if (seen.has(runbook.pageId)) return false;
    seen.add(runbook.pageId);
    return true;
  });
}

function coverageFor(runbooks: RunbookEvidence[], search: SearchCoverage = {}): AnalysisCoverage {
  const pagesRead = runbooks.length;
  const pagesSkipped = Math.max(0, search.pagesSkipped ?? 0);
  return {
    pagesFound: Math.max(search.pagesFound ?? pagesRead + pagesSkipped, pagesRead),
    pagesRead,
    pagesWithoutSteps: runbooks.filter((r) => !hasSteps(r)).length,
    pagesSkipped,
    pagesChecked: runbooks.map((r) => ({
      pageId: r.pageId,
      title: r.title,
      webuiPath: r.webuiPath,
      stepSource: hasSteps(r) ? 'ordered-list' : 'none',
    })),
  };
}

function cancelledReason(names: string[]): string {
  return `This change says the planned work on ${names.join(', ')} is cancelled or will not happen, so no runbook step was checked against it.`;
}

/**
 * Analyses one change against the recovery runbooks that were read.
 *
 * `search` carries the counts only the caller knows (pages found and pages
 * skipped); when omitted, pagesFound equals pagesRead and pagesSkipped is 0.
 * `withCoverage` sets them afterwards instead.
 */
export function analyzeChange(
  change: ChangeEvidence,
  runbooks: readonly RunbookEvidence[],
  analyzedAt: string,
  search?: SearchCoverage,
): ChangeAnalysis {
  const reading = readChange(change);
  const pages = uniqueRunbooks(runbooks);
  const coverage = coverageFor(pages, search);
  const subjects = reading.subjects.map((s) => ({ ...s }));
  const base = {
    changeKey: change.key,
    change: { key: change.key, summary: change.summary, browsePath: change.browsePath },
    analyzedAt,
    subjects,
    coverage,
  };

  if (subjects.length === 0) {
    const reason = reading.changeCancelled
      ? NOT_ASSESSED_CANCELLED
      : reading.cancelledNames.length > 0
        ? cancelledReason(reading.cancelledNames)
        : NOT_ASSESSED_NO_SUBJECTS;
    return { ...base, status: 'not-assessed', notAssessedReason: reason, findings: [] };
  }
  if (pages.length === 0) {
    return {
      ...base,
      status: 'not-assessed',
      notAssessedReason: NOT_ASSESSED_NO_RUNBOOKS,
      findings: [],
    };
  }
  if (!pages.some(hasSteps)) {
    return {
      ...base,
      status: 'not-assessed',
      notAssessedReason: NOT_ASSESSED_NO_STEPS,
      findings: [],
    };
  }

  const partial = new Set(reading.partialTerms);
  const ranked: { finding: ChangeRecoveryFinding; page: number; subject: number }[] = [];

  pages.forEach((runbook, pageIndex) => {
    if (!hasSteps(runbook)) return;
    const crossReferences: LinkBasis[] = [];
    if (mentionsIssueKey(runbook.text, change.key)) crossReferences.push('page-mentions-issue');
    if (issueLinksPage(change, runbook)) crossReferences.push('issue-links-page');

    for (const step of runbook.steps) {
      subjects.forEach((subject, subjectIndex) => {
        if (!mentionsTerm(step.instruction, subject.term, subject.display)) return;
        if (STEP_SUPERSEDED.test(step.instruction)) return;
        const isPartial = partial.has(subject.term);
        const stepNamesReplacement =
          subject.replacement !== undefined &&
          mentionsTerm(step.instruction, normaliseTerm(subject.replacement), subject.replacement);
        const confirmed = crossReferences.length > 0 && !isPartial && !stepNamesReplacement;
        const id = `${change.key}:${runbook.pageId}:${step.order}:${subject.term}`;
        const evidence: EvidenceReference[] = [
          {
            id: `${id}:change`,
            origin: change.origin,
            kind: 'jira-issue',
            title: `${change.key}: ${change.summary}`,
            excerpt: subject.excerpt,
            url: change.browsePath,
            retrievedAt: change.retrievedAt,
          },
          {
            id: `${id}:step`,
            origin: runbook.origin,
            kind: 'confluence-page',
            title: `${runbook.title}, step ${step.order}`,
            excerpt: step.instruction,
            ...(pageUrl(runbook.webuiPath) ? { url: pageUrl(runbook.webuiPath) } : {}),
            retrievedAt: runbook.retrievedAt,
          },
        ];
        ranked.push({
          page: pageIndex,
          subject: subjectIndex,
          finding: {
            id,
            changeKey: change.key,
            pageId: runbook.pageId,
            pageTitle: runbook.title,
            stepOrder: step.order,
            pageWebuiPath: runbook.webuiPath,
            subject: { ...subject },
            confidence: confirmed ? 'confirmed' : 'suspected',
            basis: ['term-match', ...crossReferences],
            explanation: explain({
              changeKey: change.key,
              pageTitle: runbook.title,
              stepOrder: step.order,
              subject,
              partial: isPartial,
              stepNamesReplacement,
              crossReferences,
              confirmed,
            }),
            evidence,
            aiAssisted: false,
          },
        });
      });
    }
  });

  const findings = ranked
    .sort(
      (a, b) =>
        Number(b.finding.confidence === 'confirmed') -
          Number(a.finding.confidence === 'confirmed') ||
        a.page - b.page ||
        a.finding.stepOrder - b.finding.stepOrder ||
        a.subject - b.subject,
    )
    .map((r) => r.finding);

  return { ...base, status: findings.length > 0 ? 'findings' : 'no-findings', findings };
}

/** Returns a copy with the caller's search counts; status and findings are unchanged. */
export function withCoverage(
  analysis: ChangeAnalysis,
  pagesFound: number,
  pagesSkipped: number,
): ChangeAnalysis {
  const skipped = Math.max(0, pagesSkipped);
  return {
    ...analysis,
    coverage: {
      ...analysis.coverage,
      pagesFound: Math.max(pagesFound, analysis.coverage.pagesRead),
      pagesSkipped: skipped,
    },
  };
}

const SAFE_SEARCH_TERM = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;
export const MAX_SEARCH_TERMS = 5;

/**
 * Terms safe to put in a CQL text search (the caller still escapes them):
 * the display name when it is a single safe token, else the normalised term.
 * At most five, case-insensitively deduplicated, in subject order.
 */
export function searchTermsForSubjects(subjects: readonly ChangeSubject[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const subject of subjects) {
    const term = [subject.display, subject.term].find((t) => SAFE_SEARCH_TERM.test(t));
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    if (out.length >= MAX_SEARCH_TERMS) break;
  }
  return out;
}
