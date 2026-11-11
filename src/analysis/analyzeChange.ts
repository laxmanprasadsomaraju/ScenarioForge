import type {
  AnalysisCoverage,
  AnalyzeChangeRequest,
  ChangeAnalysis,
  ChangeEvidence,
  ChangeSubject,
  RunbookEvidence,
} from '../../shared/analysis/types';
import { MAX_RUNBOOKS_READ } from '../../shared/analysis/types';
import type { ApiResult } from '../../shared/api';
import type { ConfluenceGateway } from '../confluence/client';
import { readRunbookEvidence, searchRunbooksForSubjects } from '../confluence/client';
import type { JiraIssueGateway } from '../jira/client';
import { getChangeEvidence } from '../jira/client';
import { parseSubjectTerms } from '../validation';

/**
 * The pure, deterministic analysis engine (shared/analysis, Lane C). Injected
 * so this orchestration can be tested with a fake and so no AI can sneak into
 * the path: the engine only sees evidence read here.
 */
export interface AnalysisEngine {
  /** Subjects (retired, replaced, ... things) named in the change text. */
  extractChangeSubjects(change: ChangeEvidence): ChangeSubject[];
  /** Plain search words for the subjects; at most 5, already restricted. */
  searchTermsForSubjects(subjects: ChangeSubject[]): string[];
  /** Cross-references the change with the runbooks read. */
  analyzeChange(
    change: ChangeEvidence,
    runbooks: RunbookEvidence[],
    analyzedAt: string,
  ): ChangeAnalysis;
}

export interface AnalyzeChangeDeps {
  jira: JiraIssueGateway;
  confluence: ConfluenceGateway;
  engine: AnalysisEngine;
  now?: () => Date;
}

const NO_COVERAGE: AnalysisCoverage = {
  pagesFound: 0,
  pagesRead: 0,
  pagesWithoutSteps: 0,
  pagesSkipped: 0,
  pagesChecked: [],
};

function notAssessed(
  change: ChangeEvidence,
  subjects: ChangeSubject[],
  analyzedAt: string,
  reason: string,
  coverage: AnalysisCoverage = NO_COVERAGE,
): ChangeAnalysis {
  return {
    changeKey: change.key,
    change: { key: change.key, summary: change.summary, browsePath: change.browsePath },
    analyzedAt,
    status: 'not-assessed',
    notAssessedReason: reason,
    subjects,
    findings: [],
    coverage: { ...coverage },
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Change-to-recovery analysis for one Jira issue, read as the signed-in user.
 *
 * 1. Read the change from Jira. A Jira failure is an `ApiResult` error: there
 *    is nothing to analyse without the change.
 * 2. Extract subjects. With none, return the engine's result directly
 *    (`not-assessed`) and do not call Confluence.
 * 3. Search Confluence for recovery pages that mention a subject, then read up
 *    to `MAX_RUNBOOKS_READ` of them. Pages not read (limit, permission or any
 *    error) are counted in `coverage.pagesSkipped`, never dropped silently.
 * 4. Run the engine on the pages read and record what was found and skipped.
 *
 * Why a Confluence failure is `not-assessed` rather than an error: the change
 * was read and its subjects are real findings about the change ("this retires
 * LegacyAuth"). Returning an error would hide them, while claiming
 * `no-findings` would imply the runbooks were checked. `not-assessed` with the
 * reason and the subjects tells the user exactly what is known and what was
 * not checked (for example: Confluence missing on the site, or no access).
 */
export async function analyzeChange(
  deps: AnalyzeChangeDeps,
  request: AnalyzeChangeRequest,
): Promise<ApiResult<ChangeAnalysis>> {
  const now = deps.now ?? (() => new Date());
  const changeResult = await getChangeEvidence(deps.jira, request.issueKey, now);
  if (!changeResult.ok) {
    return changeResult;
  }
  const change = changeResult.data;
  const analyzedAt = now().toISOString();

  const subjects = deps.engine.extractChangeSubjects(change);
  if (subjects.length === 0) {
    const early = deps.engine.analyzeChange(change, [], analyzedAt);
    return {
      ok: true,
      data: { ...early, coverage: { ...early.coverage, pagesFound: 0, pagesSkipped: 0 } },
    };
  }

  const terms = parseSubjectTerms(deps.engine.searchTermsForSubjects(subjects));
  if (!terms.ok) {
    return {
      ok: true,
      data: notAssessed(
        change,
        subjects,
        analyzedAt,
        `Runbooks were not searched: ${terms.message}`,
      ),
    };
  }

  let search: Awaited<ReturnType<typeof searchRunbooksForSubjects>>;
  try {
    search = await searchRunbooksForSubjects(deps.confluence, terms.value);
  } catch (error) {
    console.error('Runbook search failed', error instanceof Error ? error.message : 'unknown');
    return {
      ok: true,
      data: notAssessed(
        change,
        subjects,
        analyzedAt,
        'Runbooks were not checked: ScenarioForge could not reach Confluence.',
      ),
    };
  }
  if (!search.ok) {
    // Status and code only: never the query, page ids or user details.
    console.warn(
      JSON.stringify({
        event: 'runbook-search-refused',
        code: search.error.code,
        upstreamStatus: search.error.upstreamStatus ?? null,
      }),
    );
    return {
      ok: true,
      data: notAssessed(
        change,
        subjects,
        analyzedAt,
        `Runbooks were not checked: ${search.error.message}`,
      ),
    };
  }

  const found = search.data.pages;
  const toRead = found.slice(0, MAX_RUNBOOKS_READ);
  // At most MAX_RUNBOOKS_READ (5) reads, so they run together. Each failure is
  // caught per page and counted as skipped; order follows the search results.
  const reads = await Promise.all(
    toRead.map(async (page) => {
      try {
        const read = await readRunbookEvidence(deps.confluence, page.id, now);
        return read.ok ? read.data : null;
      } catch {
        return null;
      }
    }),
  );
  const runbooks = reads.filter((r): r is RunbookEvidence => r !== null);
  const pagesFound = found.length;
  const pagesSkipped = pagesFound - runbooks.length;

  if (runbooks.length === 0) {
    const reason =
      pagesFound === 0
        ? `No Confluence recovery page you can view mentions ${terms.value.join(', ')}.`
        : `${plural(pagesFound, 'recovery page')} found, but none could be read.`;
    return {
      ok: true,
      data: notAssessed(change, subjects, analyzedAt, `Runbooks were not checked: ${reason}`, {
        ...NO_COVERAGE,
        pagesFound,
        pagesSkipped,
      }),
    };
  }

  const analysis = deps.engine.analyzeChange(change, runbooks, analyzedAt);
  return {
    ok: true,
    data: { ...analysis, coverage: { ...analysis.coverage, pagesFound, pagesSkipped } },
  };
}
