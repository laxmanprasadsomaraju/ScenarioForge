import { QuestionCircleIcon } from '../icons';
import type { Ref } from 'react';
import { StatusBadge } from '../Badge';
import { Button } from '../Button';
import type {
  AnalysisCoverage,
  CheckedPage,
  ChangeAction,
  ChangeAnalysis,
  ChangeRecoveryFinding,
  ChangeSubject,
  LinkBasis,
} from '@shared/analysis/types';
import type { EvidenceReference } from '@shared/domain/types';
import { formatAbsolute } from '../../lib/format';
import { useSite } from '../../lib/site';

const ACTION_LABELS: Record<ChangeAction, string> = {
  retire: 'Retires',
  replace: 'Replaces',
  migrate: 'Migrates',
  rename: 'Renames',
  disable: 'Disables',
  upgrade: 'Upgrades',
};

const CONFIDENCE_LABELS: Record<ChangeRecoveryFinding['confidence'], string> = {
  confirmed: 'Confirmed — explicit link',
  suspected: 'Suspected — text match',
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function basisLabel(basis: LinkBasis, finding: ChangeRecoveryFinding): string {
  switch (basis) {
    case 'term-match':
      return `The step text names “${finding.subject.display}”.`;
    case 'page-mentions-issue':
      return `The runbook page mentions ${finding.changeKey}.`;
    case 'issue-links-page':
      return `${finding.changeKey} has a Jira link to this runbook page.`;
  }
}

/**
 * Turns a runbook link from the analysis into a path on this site. Accepts a
 * Confluence `webuiPath` (relative to /wiki), a /wiki path, or an absolute URL
 * (reduced to its path, so a link never leaves the current Atlassian site).
 */
export function confluencePath(url: string | undefined): string | null {
  if (!url) return null;
  let path = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path === '/wiki' || path.startsWith('/wiki/') ? path : `/wiki${path}`;
}

/** The headline: what was found, or why nothing could be said. Never a pass. */
export function AnalysisStatement({
  analysis,
  headingRef,
}: {
  analysis: ChangeAnalysis;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { status, findings, coverage, changeKey } = analysis;
  if (status === 'findings') {
    const steps = new Set(findings.map((f) => `${f.pageId}#${f.stepOrder}`)).size;
    const confirmed = findings.filter((f) => f.confidence === 'confirmed').length;
    const suspected = findings.length - confirmed;
    return (
      <div className="analysis-status analysis-status-findings">
        <h2
          id="analysis-status-title"
          className="analysis-statement"
          ref={headingRef}
          tabIndex={-1}
        >
          {plural(steps, 'recovery step', 'recovery steps')} may depend on what {changeKey} changes
        </h2>
        <p className="analysis-sub">
          {plural(confirmed, 'finding', 'findings')} confirmed by an explicit link, {suspected}{' '}
          suspected from a text match.
        </p>
      </div>
    );
  }
  if (status === 'no-findings') {
    return (
      <div className="analysis-status analysis-status-none">
        <h2
          id="analysis-status-title"
          className="analysis-statement"
          ref={headingRef}
          tabIndex={-1}
        >
          No conflicts found in {plural(coverage.pagesRead, 'runbook', 'runbooks')} read
        </h2>
        <p className="analysis-sub analysis-caveat">
          This is not a readiness pass. Only the runbooks listed under Pages checked were read;
          pages that were not found or not read can still depend on this change.
        </p>
      </div>
    );
  }
  return (
    <div className="analysis-status analysis-status-unknown">
      <h2
        id="analysis-status-title"
        className="analysis-statement state-unknown"
        ref={headingRef}
        tabIndex={-1}
      >
        <QuestionCircleIcon label="" />
        Not assessed
      </h2>
      <p className="analysis-sub">
        {analysis.notAssessedReason ?? 'The analysis did not say why this change was not assessed.'}
      </p>
    </div>
  );
}

export function SubjectsTable({ subjects }: { subjects: ChangeSubject[] }) {
  if (subjects.length === 0) {
    return (
      <p className="region-body">
        Nothing the change retires, replaces, migrates, renames, disables or upgrades was recognised
        in its text.
      </p>
    );
  }
  return (
    <ul className="subjects">
      {subjects.map((s) => (
        <li key={`${s.term}-${s.action}`} className="subject">
          <p className="subject-head">
            <span className="subject-term">{s.display}</span>
            <span className="subject-action">
              {ACTION_LABELS[s.action]}
              {s.replacement ? `, replaced by ${s.replacement}` : ''}
            </span>
          </p>
          <blockquote className="quote">{s.excerpt}</blockquote>
        </li>
      ))}
    </ul>
  );
}

export function CoverageFacts({
  coverage,
  analyzedAt,
}: {
  coverage: AnalysisCoverage;
  analyzedAt: string;
}) {
  return (
    <>
      <dl className="facts coverage">
        <dt>Runbooks found</dt>
        <dd className="num">{coverage.pagesFound}</dd>
        <dt>Read</dt>
        <dd className="num">{coverage.pagesRead}</dd>
        <dt>Read without numbered steps</dt>
        <dd className="num">{coverage.pagesWithoutSteps}</dd>
        <dt>Not read</dt>
        <dd className="num">{coverage.pagesSkipped}</dd>
        <dt>Checked at</dt>
        <dd>{formatAbsolute(analyzedAt)}</dd>
      </dl>
      <h3 className="section-title pages-checked-title">Pages checked</h3>
      {coverage.pagesChecked.length === 0 ? (
        <p className="region-body">No runbook page was read for this change.</p>
      ) : (
        <ul className="pages-checked">
          {coverage.pagesChecked.map((page) => (
            <CheckedPageItem key={page.pageId} page={page} />
          ))}
        </ul>
      )}
      {coverage.pagesWithoutSteps > 0 || coverage.pagesSkipped > 0 ? (
        <p className="region-body">
          Steps in runbooks without a numbered list, or not read because of limits, errors or
          permissions, were not checked.
        </p>
      ) : null}
    </>
  );
}

function CheckedPageItem({ page }: { page: CheckedPage }) {
  const { openInJira } = useSite();
  const path = confluencePath(page.webuiPath ?? undefined);
  return (
    <li>
      {path ? (
        <button
          type="button"
          className="issue-key page-title"
          onClick={() => openInJira(path)}
          aria-label={`Open ${page.title} in Confluence (new tab)`}
        >
          {page.title}
        </button>
      ) : (
        <span>{page.title}</span>
      )}
      <span className="page-checked-note">
        {page.stepSource === 'ordered-list' ? 'Steps checked' : 'No numbered steps; not checked'}
      </span>
    </li>
  );
}

function SourceQuote({
  label,
  title,
  excerpt,
  missing,
  link,
}: {
  label: string;
  title: string;
  excerpt: string | undefined;
  missing: string;
  link: { label: string; onClick: () => void } | null;
}) {
  return (
    <figure className="source">
      <figcaption className="source-caption">
        <span className="source-label">{label}</span>
        <span className="source-title">{title}</span>
      </figcaption>
      {excerpt ? (
        <blockquote className="quote">{excerpt}</blockquote>
      ) : (
        <p className="region-body">{missing}</p>
      )}
      {link ? (
        <div>
          <Button spacing="compact" onClick={link.onClick}>
            {link.label}
          </Button>
        </div>
      ) : (
        <p className="source-nolink">No link was returned for this source.</p>
      )}
    </figure>
  );
}

function pick(evidence: EvidenceReference[], kinds: EvidenceReference['kind'][]) {
  for (const kind of kinds) {
    const found = evidence.find((e) => e.kind === kind);
    if (found) return found;
  }
  return undefined;
}

/** DOM id of a finding's list item, used to scroll to and focus a linked finding. */
export function findingItemId(findingId: string): string {
  return `finding-item-${findingId}`;
}

export function FindingItem({
  finding,
  change,
  linked = false,
}: {
  finding: ChangeRecoveryFinding;
  change: { key: string; browsePath: string };
  /** True when a link named this finding and the user's own result contains it. */
  linked?: boolean;
}) {
  const { openInJira } = useSite();
  const changeEvidence = pick(finding.evidence, ['jira-issue']);
  const stepEvidence = pick(finding.evidence, ['runbook-step', 'confluence-page']);
  const runbookPath = finding.pageWebuiPath
    ? confluencePath(finding.pageWebuiPath)
    : confluencePath(stepEvidence?.url);
  const titleId = `finding-${finding.id}`;

  return (
    <li
      className="finding"
      aria-labelledby={titleId}
      id={findingItemId(finding.id)}
      {...(linked ? { tabIndex: -1, 'aria-current': true } : {})}
    >
      <div className="finding-head">
        <StatusBadge tone={finding.confidence === 'confirmed' ? 'warning' : 'suspected'}>
          {CONFIDENCE_LABELS[finding.confidence]}
        </StatusBadge>
        <h3 id={titleId} className="finding-title">
          Step {finding.stepOrder} of {finding.pageTitle}
        </h3>
      </div>
      {linked ? <p className="finding-explanation">Opened from a link</p> : null}
      <p className="finding-explanation">{finding.explanation}</p>
      <div className="finding-basis">
        <span className="finding-basis-label">Why it is linked</span>
        <ul>
          {finding.basis.map((b) => (
            <li key={b}>{basisLabel(b, finding)}</li>
          ))}
        </ul>
      </div>
      <div className="finding-sources">
        <SourceQuote
          label="What the change says"
          title={changeEvidence?.title ?? finding.changeKey}
          excerpt={changeEvidence?.excerpt ?? finding.subject.excerpt}
          missing="The change text was not returned with this finding."
          link={{
            label: `Open ${finding.changeKey} in Jira`,
            onClick: () => openInJira(change.browsePath),
          }}
        />
        <SourceQuote
          label="What the runbook says"
          title={stepEvidence?.title ?? `${finding.pageTitle}, step ${finding.stepOrder}`}
          excerpt={stepEvidence?.excerpt}
          missing="The runbook step was not returned with this finding."
          link={
            runbookPath
              ? { label: 'Open runbook in Confluence', onClick: () => openInJira(runbookPath) }
              : null
          }
        />
      </div>
    </li>
  );
}
