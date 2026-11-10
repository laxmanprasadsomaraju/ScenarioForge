import type { ChangeAction, ChangeAnalysis, ChangeRecoveryFinding } from '../analysis/types';
import type { RetestResult } from '../domain/types';
import { canonicalJson } from '../simulation/replay';
import { sha256Hex } from './sha256';
import {
  FIXED_ISSUE_TYPES,
  MAX_DESCRIPTION_LENGTH,
  MAX_SUMMARY_LENGTH,
  REMEDIATION_LABEL,
  type BuildDraftOptions,
  type BuildDraftResult,
  type DraftProblem,
  type DraftRehearsalResult,
  type WorkItemDraft,
} from './types';

/**
 * Deterministic work item drafts. Same inputs give the same draft, character
 * for character: no clock, no randomness, no AI.
 */

/** Jira's default project key rule: a capital letter, then capitals, digits or underscores. */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}$/;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]*$/;
/** Shape of the idempotency label; the JQL builder accepts nothing else. */
export const IDEMPOTENCY_LABEL_PATTERN = /^sf-rem-[0-9a-f]{16}$/;
const SITE_URL_PATTERN = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Used as the fix id when the work item asks to review the step without a named fix. */
export const REVIEW_STEP_FIX_ID = 'review-step';

export const CREATED_BY_FOOTER = 'Created by ScenarioForge after human approval.';
export const MODELLED_NOTE = 'Consequences in the rehearsal were modelled, not observed.';

const PAST: Record<ChangeAction, string> = {
  retire: 'retired',
  replace: 'replaced',
  migrate: 'migrated',
  rename: 'renamed',
  disable: 'disabled',
  upgrade: 'upgraded',
};

const OUTCOME: Record<RetestResult['outcome'], string> = {
  resolved: 'Gap resolved',
  'still-failing': 'Gap still failing',
  inconclusive: 'Inconclusive',
};

const OBJECTIVE_STATUS: Record<string, string> = {
  met: 'Met',
  missed: 'Missed',
  absent: 'Not measured',
};

/**
 * Label that identifies "the work item for this fix of this finding". It does
 * not depend on the draft text, so editing the summary or retrying after a
 * timeout still finds the same work item.
 */
export function idempotencyLabel(changeKey: string, findingId: string, fixId: string): string {
  return `sf-rem-${sha256Hex(canonicalJson({ changeKey, findingId, fixId })).slice(0, 16)}`;
}

/** The deterministic summary before any user edit, cut to Jira's limit. */
export function templateSummary(finding: ChangeRecoveryFinding): string {
  const text = `Update ${finding.pageTitle} step ${finding.stepOrder}: ${finding.subject.display} ${PAST[finding.subject.action]} by ${finding.changeKey}`;
  return text.length <= MAX_SUMMARY_LENGTH ? text : `${text.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}

export function buildWorkItemDraft(
  finding: ChangeRecoveryFinding,
  analysis: ChangeAnalysis,
  rehearsalResult: DraftRehearsalResult | undefined,
  options: BuildDraftOptions,
): BuildDraftResult {
  if (!analysis.findings.some((f) => f.id === finding.id)) {
    return {
      ok: false,
      error: 'FINDING_NOT_FOUND',
      message: `Analysis of ${analysis.changeKey} has no finding ${finding.id}.`,
    };
  }
  const changeQuote = finding.evidence.find((e) => e.kind === 'jira-issue' && e.excerpt?.trim());
  const stepQuote = finding.evidence.find(
    (e) => (e.kind === 'confluence-page' || e.kind === 'runbook-step') && e.excerpt?.trim(),
  );
  const browsePath = analysis.change.browsePath;
  if (
    finding.changeKey !== analysis.changeKey ||
    !changeQuote?.excerpt ||
    !stepQuote?.excerpt ||
    !browsePath.startsWith('/browse/')
  ) {
    return {
      ok: false,
      error: 'ANALYSIS_NOT_USABLE',
      message: `Finding ${finding.id} lacks the verbatim change and runbook step quotes a work item needs.`,
    };
  }
  const site = (options.siteUrl ?? '').replace(/\/+$/, '');
  if (site !== '' && !SITE_URL_PATTERN.test(site)) {
    return {
      ok: false,
      error: 'ANALYSIS_NOT_USABLE',
      message: 'The site address is not a plain https address, so links cannot be built.',
    };
  }

  const changeKey = analysis.change.key;
  const fixId = options.fix?.id ?? REVIEW_STEP_FIX_ID;
  const changeUrl = `${site}${browsePath}`;
  const pagePath =
    finding.pageWebuiPath &&
    finding.pageWebuiPath.startsWith('/') &&
    !finding.pageWebuiPath.startsWith('//')
      ? `/wiki${finding.pageWebuiPath}`
      : null;
  const pageUrl = pagePath ? `${site}${pagePath}` : null;
  const n = finding.stepOrder;

  const blocks: string[] = [
    'ScenarioForge found a recovery runbook step that depends on something a change affects.',
    `Change: ${changeKey} ${analysis.change.summary}\nLink: ${changeUrl}`,
    `Runbook: ${finding.pageTitle}, step ${n}\nLink: ${pageUrl ?? 'not available (the page path was not returned)'}`,
    `Finding (${finding.confidence}): ${finding.explanation}`,
    `Quoted exactly from ${changeKey}:\n${changeQuote.excerpt}`,
    `Quoted exactly from ${finding.pageTitle}, step ${n}:\n${stepQuote.excerpt}`,
    options.fix
      ? `Requested fix: ${options.fix.title}\n${options.fix.description}`
      : `Requested fix: review step ${n} against ${changeKey} and correct it.`,
    rehearsalBlock(finding.id, rehearsalResult),
    CREATED_BY_FOOTER,
  ];

  const draft: WorkItemDraft = {
    schemaVersion: 1,
    projectKey: options.projectKey.trim(),
    issueType: options.issueType,
    summary: (options.summary ?? templateSummary(finding)).trim(),
    description: blocks.join('\n\n'),
    labels: [REMEDIATION_LABEL, idempotencyLabel(changeKey, finding.id, fixId)],
    links: {
      issueLink: { type: 'Relates', issueKey: changeKey, url: changeUrl },
      remoteLink: pageUrl
        ? {
            globalId: `scenarioforge:finding:${finding.id}`,
            url: pageUrl,
            title: `${finding.pageTitle}, step ${n}`,
          }
        : null,
    },
    source: { changeKey, findingId: finding.id, fixId, pageId: finding.pageId, stepOrder: n },
  };
  return { ok: true, draft };
}

function rehearsalBlock(findingId: string, result: DraftRehearsalResult | undefined): string {
  const gaps = result?.comparison.gaps.filter((g) => g.findingId === findingId) ?? [];
  if (!result || gaps.length === 0) {
    return 'Rehearsal: no retest result for this finding is attached.';
  }
  const lines = ['Rehearsal before and after the fix:'];
  for (const gap of gaps) {
    lines.push(`Retest verdict: ${OUTCOME[gap.outcome]}. ${gap.reason}`);
    for (const o of gap.objectives) {
      const label = result.objectiveLabels[o.objectiveId] ?? o.objectiveId;
      lines.push(
        `- ${label}: first run ${OBJECTIVE_STATUS[o.original]}, retest ${OBJECTIVE_STATUS[o.retest]}`,
      );
    }
  }
  lines.push(MODELLED_NOTE);
  return lines.join('\n');
}

/** Every reason the draft cannot be approved or sent. Empty means valid. */
export function validateDraft(
  draft: WorkItemDraft,
  issueTypes: readonly string[] = FIXED_ISSUE_TYPES,
): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!PROJECT_KEY_PATTERN.test(draft.projectKey)) {
    problems.push({
      field: 'projectKey',
      message:
        draft.projectKey === ''
          ? 'Enter the key of the project to create the work item in.'
          : 'A project key is 2 to 10 capital letters, digits or underscores, starting with a letter.',
    });
  }
  if (!issueTypes.includes(draft.issueType)) {
    problems.push({ field: 'issueType', message: 'Choose an issue type from the list.' });
  }
  if (draft.summary.trim() === '') {
    problems.push({ field: 'summary', message: 'The summary cannot be empty.' });
  } else if (draft.summary.length > MAX_SUMMARY_LENGTH) {
    problems.push({
      field: 'summary',
      message: `The summary is ${draft.summary.length} characters; Jira allows ${MAX_SUMMARY_LENGTH}.`,
    });
  } else if (/[\r\n]/.test(draft.summary)) {
    problems.push({ field: 'summary', message: 'The summary must be a single line.' });
  }
  if (draft.description.trim() === '') {
    problems.push({ field: 'description', message: 'The description cannot be empty.' });
  } else if (draft.description.length > MAX_DESCRIPTION_LENGTH) {
    problems.push({
      field: 'description',
      message: `The description is ${draft.description.length} characters; the limit is ${MAX_DESCRIPTION_LENGTH}.`,
    });
  }
  const expectedLabel = idempotencyLabel(
    draft.source.changeKey,
    draft.source.findingId,
    draft.source.fixId,
  );
  if (
    draft.labels.length !== 2 ||
    draft.labels[0] !== REMEDIATION_LABEL ||
    draft.labels[1] !== expectedLabel
  ) {
    problems.push({
      field: 'labels',
      message: `Labels must be ${REMEDIATION_LABEL} and ${expectedLabel}.`,
    });
  }
  const { issueLink, remoteLink } = draft.links;
  if (
    issueLink.type !== 'Relates' ||
    issueLink.issueKey !== draft.source.changeKey ||
    !ISSUE_KEY_PATTERN.test(issueLink.issueKey) ||
    !isLinkUrl(issueLink.url)
  ) {
    problems.push({ field: 'links', message: 'The link to the change is not valid.' });
  }
  if (
    remoteLink &&
    (!isLinkUrl(remoteLink.url) ||
      remoteLink.globalId !== `scenarioforge:finding:${draft.source.findingId}`)
  ) {
    problems.push({ field: 'links', message: 'The link to the runbook page is not valid.' });
  }
  return problems;
}

function isLinkUrl(url: string): boolean {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  const origin = url.match(/^https:\/\/[^/]+/)?.[0];
  return origin !== undefined && SITE_URL_PATTERN.test(origin);
}
