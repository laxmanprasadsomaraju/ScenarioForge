import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../Button';
import type { ChangeAnalysis } from '@shared/analysis/types';
import type { RemediationAction } from '@shared/domain/types';
import type { ApiResult, CreateRemediationWorkItemResponse } from '@shared/api';
import {
  approveDraft,
  buildWorkItemDraft,
  checkApproval,
  draftHash,
  FIXED_ISSUE_TYPES,
  templateSummary,
  validateDraft,
  type DraftApproval,
  type DraftRehearsalResult,
  type WorkItemDraft,
} from '@shared/remediation';
import { useSite } from '../../lib/site';
import { StatusBadge, type StatusTone } from '../Badge';

export const CREATE_BLOCKED_REASON =
  'Creating work items needs the write:jira-work permission (not granted)';

export const CREATE_NEEDS_APPROVAL = 'Approve this exact draft first';

export const RETEST_SUGGESTION = 'Retest after the runbook is updated';

/**
 * Sends an approved draft to the backend `createRemediationWorkItem`
 * resolver. No build passes one yet: without it the create button stays
 * disabled with CREATE_BLOCKED_REASON.
 */
export type RemediationCreator = (
  draft: WorkItemDraft,
  approval: DraftApproval,
  context: { fixId: string },
) => Promise<ApiResult<CreateRemediationWorkItemResponse>>;

type CreatePhase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'sending' }
  | { kind: 'done'; result: CreateRemediationWorkItemResponse }
  | { kind: 'failed'; message: string };

/**
 * The exact Jira work item ScenarioForge would create for a fix, reviewed as a
 * high-trust draft: destination, duplicate state, approval and create are each
 * stated on their own,
 * with an in-memory approval bound to its hash. Nothing here calls Jira or
 * the backend; the create button stays disabled until the scope is granted.
 */
export function RemediationPreview({
  analysis,
  findingId,
  fixes,
  defaultFixId,
  rehearsal,
  creator = null,
}: {
  analysis: ChangeAnalysis;
  findingId: string;
  fixes: RemediationAction[];
  defaultFixId?: string;
  /** Retest verdict to quote, when the debrief follows a retest. */
  rehearsal?: DraftRehearsalResult;
  /** Null in every build until `write:jira-work` is approved. */
  creator?: RemediationCreator | null;
}) {
  const { siteUrl, accountId } = useSite();
  const ids = useId();
  const [projectKey, setProjectKey] = useState('');
  const [issueType, setIssueType] = useState('');
  const [fixId, setFixId] = useState(defaultFixId ?? fixes[0]?.id ?? '');
  const [summaryEdit, setSummaryEdit] = useState<string | null>(null);
  const [reviewedHash, setReviewedHash] = useState<string | null>(null);
  const [approval, setApproval] = useState<DraftApproval | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CreatePhase>({ kind: 'idle' });
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase.kind === 'confirming') confirmRef.current?.focus();
  }, [phase.kind]);

  const finding = analysis.findings.find((f) => f.id === findingId);
  const fix = fixes.find((f) => f.id === fixId);

  const built = useMemo(
    () =>
      finding
        ? buildWorkItemDraft(finding, analysis, rehearsal, {
            projectKey,
            issueType,
            issueTypes: FIXED_ISSUE_TYPES,
            fix: fix ? { id: fix.id, title: fix.title, description: fix.description } : undefined,
            summary: summaryEdit ?? undefined,
            siteUrl,
          })
        : null,
    [finding, analysis, rehearsal, projectKey, issueType, fix, summaryEdit, siteUrl],
  );

  if (!finding || !built) return null;
  if (!built.ok) {
    return (
      <section className="region remediation" aria-labelledby={`${ids}-title`}>
        <h2 id={`${ids}-title`} className="section-title">
          Prepare a Jira work item
        </h2>
        <p className="field-help" role="alert">
          {built.message}
        </p>
      </section>
    );
  }

  const draft = built.draft;
  const hash = draftHash(draft);
  const problems = validateDraft(draft, FIXED_ISSUE_TYPES);
  const problemFor = (field: string) => problems.find((p) => p.field === field)?.message;
  const projectProblem = projectKey === '' ? undefined : problemFor('projectKey');
  const summaryProblem = problemFor('summary');
  const reviewed = reviewedHash === hash;
  const check = accountId ? checkApproval(draft, approval, accountId) : 'missing';
  const approved = check === 'valid';
  const stale = approval !== null && check !== 'valid';
  const canApprove = reviewed && problems.length === 0 && accountId !== null && !approved;

  const review: { label: string; value: string; tone: StatusTone }[] = [
    {
      label: 'Draft',
      value:
        problems.length === 0
          ? 'Complete'
          : `${problems.length} ${problems.length === 1 ? 'item' : 'items'} to fix`,
      tone: problems.length === 0 ? 'success' : 'warning',
    },
    {
      label: 'Destination',
      value:
        draft.projectKey && draft.issueType
          ? `${draft.projectKey}, ${draft.issueType}`
          : 'Not chosen',
      tone: draft.projectKey && draft.issueType ? 'info' : 'unknown',
    },
    {
      label: 'Duplicate check',
      value: 'Not run yet (runs before create)',
      tone: 'unknown',
    },
    {
      label: 'Approval',
      value: approved ? 'Approved, this tab only' : stale ? 'Stale' : 'Not approved',
      tone: approved ? 'success' : stale ? 'warning' : 'unknown',
    },
    {
      label: 'Create in Jira',
      value: creator
        ? approved
          ? 'Ready to confirm'
          : 'Needs approval'
        : 'Disabled: no write permission',
      tone: 'unknown',
    },
  ];

  const createdResult = phase.kind === 'done' && phase.result.issueKey ? phase.result : null;
  const canCreate =
    creator !== null && approved && (phase.kind === 'idle' || phase.kind === 'failed');
  const createReason = !creator
    ? CREATE_BLOCKED_REASON
    : createdResult
      ? `Created as ${createdResult.issueKey}`
      : !approved
        ? CREATE_NEEDS_APPROVAL
        : '';

  const sendCreate = async () => {
    if (!creator || !approval) return;
    setPhase({ kind: 'sending' });
    try {
      const result = await creator(draft, approval, { fixId });
      setPhase(
        result.ok
          ? { kind: 'done', result: result.data }
          : { kind: 'failed', message: result.error.message },
      );
    } catch {
      setPhase({ kind: 'failed', message: 'Could not reach the ScenarioForge backend.' });
    }
  };

  const approve = () => {
    if (!accountId) return;
    try {
      setApproval(approveDraft(draft, accountId, new Date().toISOString(), FIXED_ISSUE_TYPES));
      setApproveError(null);
    } catch (error) {
      setApproveError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="region remediation" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="section-title">
        Prepare a Jira work item
      </h2>
      <p className="region-body">
        Choose where the work item goes, then review exactly what would be sent. Nothing is sent to
        Jira from this screen.
      </p>
      <dl className="review-strip" aria-label="Review state">
        {review.map((r) => (
          <div key={r.label} className="review-item">
            <dt>{r.label}</dt>
            <dd>
              <StatusBadge tone={r.tone}>{r.value}</StatusBadge>
            </dd>
          </div>
        ))}
      </dl>

      <details className="remediation-body">
        <summary>Review and approve the exact draft</summary>
        <div className="toolbar remediation-fields">
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-project`}>
              Project key
            </label>
            <input
              type="text"
              id={`${ids}-project`}
              name="project-key"
              autoComplete="off"
              spellCheck={false}
              placeholder="For example OPS"
              value={projectKey}
              aria-invalid={projectProblem !== undefined}
              aria-describedby={`${ids}-project-help`}
              onChange={(e) => setProjectKey(e.target.value.trim())}
            />
            <span id={`${ids}-project-help`} className="field-help">
              {projectProblem ?? ' '}
            </span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-type`}>
              Issue type (fixed list for now)
            </label>
            <select
              id={`${ids}-type`}
              name="issue-type"
              value={issueType}
              aria-describedby={`${ids}-type-help`}
              onChange={(e) => setIssueType(e.target.value)}
            >
              <option value="">Choose a type</option>
              {FIXED_ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span id={`${ids}-type-help`} className="field-note">
              Task, Bug or Story. Your project’s own types are read once Jira access is set up.
            </span>
          </div>
          {fixes.length > 1 ? (
            <div className="field field-grow">
              <label className="field-label" htmlFor={`${ids}-fix`}>
                Fix
              </label>
              <select
                id={`${ids}-fix`}
                name="fix"
                value={fixId}
                onChange={(e) => setFixId(e.target.value)}
              >
                {fixes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field field-grow">
            <label className="field-label" htmlFor={`${ids}-summary`}>
              Summary
            </label>
            <input
              type="text"
              id={`${ids}-summary`}
              name="summary"
              autoComplete="off"
              value={summaryEdit ?? templateSummary(finding)}
              aria-invalid={summaryProblem !== undefined}
              aria-describedby={`${ids}-summary-help`}
              onChange={(e) => setSummaryEdit(e.target.value)}
            />
            <span id={`${ids}-summary-help`} className="field-help">
              {summaryProblem ?? ' '}
            </span>
          </div>
        </div>

        <h3 className="remediation-subtitle">Exact draft</h3>
        <dl className="draft" aria-label="Exact draft">
          <div className="draft-row">
            <dt>Project</dt>
            <dd className="draft-mono">{draft.projectKey || 'Not chosen'}</dd>
          </div>
          <div className="draft-row">
            <dt>Issue type</dt>
            <dd>{draft.issueType || 'Not chosen'}</dd>
          </div>
          <div className="draft-row">
            <dt>Summary</dt>
            <dd>{draft.summary}</dd>
          </div>
          <div className="draft-row">
            <dt>Description</dt>
            <dd>
              <pre className="draft-text" tabIndex={0} aria-label="Description">
                {draft.description}
              </pre>
            </dd>
          </div>
          <div className="draft-row">
            <dt>Labels</dt>
            <dd>
              <ul className="draft-labels">
                {draft.labels.map((l) => (
                  <li key={l}>
                    <code>{l}</code>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="draft-row">
            <dt>Links</dt>
            <dd>
              <ul className="draft-links">
                <li>
                  Relates to <span className="draft-mono">{draft.links.issueLink.issueKey}</span>:{' '}
                  <code>{draft.links.issueLink.url}</code>
                </li>
                {draft.links.remoteLink ? (
                  <li>
                    Runbook page link “{draft.links.remoteLink.title}”:{' '}
                    <code>{draft.links.remoteLink.url}</code>
                  </li>
                ) : (
                  <li>No runbook page link: the page path was not returned.</li>
                )}
              </ul>
            </dd>
          </div>
          <div className="draft-row">
            <dt>Draft fingerprint</dt>
            <dd className="draft-mono">{hash.slice(0, 16)}</dd>
          </div>
        </dl>

        {problems.length > 0 ? (
          <div className="draft-problems">
            <p className="region-body">Before this draft can be approved:</p>
            <ul>
              {problems.map((p) => (
                <li key={`${p.field}-${p.message}`}>{p.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="approval">
          <label className="fix-approve">
            <input
              type="checkbox"
              name="reviewed-draft"
              checked={reviewed}
              disabled={problems.length > 0 || approved}
              onChange={(e) => setReviewedHash(e.target.checked ? hash : null)}
            />
            <span>I have reviewed this exact draft</span>
          </label>
          <div className="debrief-actions">
            <Button variant="secondary" isDisabled={!canApprove} onClick={approve}>
              Approve this exact draft
            </Button>
            <Button
              variant="primary"
              isDisabled={!canCreate}
              aria-describedby={`${ids}-create-reason`}
              onClick={() => setPhase({ kind: 'confirming' })}
            >
              Create in Jira
            </Button>
            <span id={`${ids}-create-reason`} className="region-body">
              {createReason}
            </span>
          </div>
          {phase.kind === 'confirming' ? (
            <div
              role="alertdialog"
              aria-labelledby={`${ids}-confirm-title`}
              className="create-confirm"
            >
              <h3 id={`${ids}-confirm-title`} className="remediation-subtitle">
                Create 1 work item in {draft.projectKey} as you?
              </h3>
              <ul className="draft-links" aria-label="Will be created">
                <li>
                  Work item: {draft.issueType} in{' '}
                  <span className="draft-mono">{draft.projectKey}</span>, “{draft.summary}”
                </li>
                <li>
                  Labels: <code>{draft.labels.join(', ')}</code>
                </li>
                <li>
                  Issue link: relates to{' '}
                  <span className="draft-mono">{draft.links.issueLink.issueKey}</span>
                </li>
                <li>
                  {draft.links.remoteLink
                    ? `Runbook page link: “${draft.links.remoteLink.title}”`
                    : 'No runbook page link'}
                </li>
              </ul>
              <p className="region-body">
                Nothing else is changed. The runbook page is not edited.
              </p>
              <div className="debrief-actions">
                <Button variant="primary" ref={confirmRef} onClick={() => void sendCreate()}>
                  Create 1 work item
                </Button>
                <Button variant="subtle" onClick={() => setPhase({ kind: 'idle' })}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <CreateOutcome phase={phase} onCheckAgain={() => void sendCreate()} />
          <div role="status" aria-live="polite" className="approval-status">
            {approved && approval ? (
              <p className="approval-note">
                Approved by you for fingerprint{' '}
                <span className="draft-mono">{approval.draftHash.slice(0, 16)}</span>. Held in this
                tab only; nothing has been created.
              </p>
            ) : stale ? (
              <p className="approval-stale">
                Approval is stale: the draft changed after you approved it. Review the new draft and
                approve it again.
              </p>
            ) : accountId === null ? (
              <p className="approval-note">
                Approval needs your Atlassian account, which this view could not read.
              </p>
            ) : (
              <p className="approval-note">Not approved.</p>
            )}
          </div>
          {approveError ? (
            <p className="field-help" role="alert">
              {approveError}
            </p>
          ) : null}
        </div>
      </details>

      <RemediationTracking findingId={findingId} approved={approved} created={createdResult} />
    </section>
  );
}

function CreateOutcome({ phase, onCheckAgain }: { phase: CreatePhase; onCheckAgain: () => void }) {
  if (phase.kind === 'sending') {
    return (
      <p role="status" className="approval-note">
        Creating the work item…
      </p>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <p role="alert" className="approval-stale">
        Not created: {phase.message}
      </p>
    );
  }
  if (phase.kind !== 'done') return null;
  const r = phase.result;
  if (r.outcome === 'unknown') {
    return (
      <div role="status" className="approval-note">
        <p>
          Outcome unknown: checking Jira for a work item labelled <code>{r.idempotencyLabel}</code>.
          Checking again never creates a second one.
        </p>
        <Button variant="secondary" onClick={onCheckAgain}>
          Check again
        </Button>
      </div>
    );
  }
  const followUps = [
    r.issueLink.status === 'failed' ? `Issue link not added: ${r.issueLink.message}` : null,
    r.remoteLink.status === 'failed'
      ? `Runbook page link not added: ${r.remoteLink.message}`
      : null,
  ].filter((x): x is string => x !== null);
  return (
    <div role="status" className="approval-note">
      <p>
        {r.adopted ? 'Existing work item adopted: ' : 'Work item created: '}
        <a href={r.issueUrl} target="_blank" rel="noreferrer">
          {r.issueKey}
        </a>
        {r.outcome === 'created-with-follow-up' ? '. Follow-up needed.' : '.'}
      </p>
      {followUps.length > 0 ? (
        <ul>
          {followUps.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Where the fix stands, one stage at a time. Each stage is stated on its
 * own: an in-tab approval is not a created work item, and a created work item
 * is not an updated runbook or a verified retest.
 */
function RemediationTracking({
  findingId,
  approved,
  created,
}: {
  findingId: string;
  approved: boolean;
  created: CreateRemediationWorkItemResponse | null;
}) {
  const ids = useId();
  const stages: { label: string; value: string; tone: StatusTone }[] = [
    { label: 'Proposed', value: 'Draft ready', tone: 'info' },
    {
      label: 'Approved (simulated)',
      value: approved ? 'Approved in this tab' : 'Not approved',
      tone: approved ? 'info' : 'unknown',
    },
    {
      label: 'Jira work item created',
      value: created ? (created.issueKey ?? 'Created') : 'Not created',
      tone: created ? 'success' : 'unknown',
    },
    { label: 'Runbook updated', value: 'Not tracked yet', tone: 'unknown' },
    { label: 'Verified retest', value: RETEST_SUGGESTION, tone: 'unknown' },
  ];
  return (
    <div className="remediation-tracking" aria-labelledby={`${ids}-title`} role="group">
      <h3 id={`${ids}-title`} className="remediation-subtitle">
        Remediation tracking
      </h3>
      <p className="region-body">
        For finding <span className="draft-mono">{findingId}</span>
        {created?.issueKey ? (
          <>
            {', tracked in '}
            <a href={created.issueUrl} target="_blank" rel="noreferrer">
              {created.issueKey}
            </a>
          </>
        ) : null}
        .
      </p>
      <dl className="review-strip" aria-label="Remediation stages">
        {stages.map((st) => (
          <div key={st.label} className="review-item">
            <dt>{st.label}</dt>
            <dd>
              <StatusBadge tone={st.tone}>{st.value}</StatusBadge>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
