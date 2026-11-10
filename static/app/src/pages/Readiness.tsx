import { useCallback, useEffect, useRef } from 'react';
import Button from '@atlaskit/button/new';
import type { JiraIssueSummary } from '@shared/api';
import { MAX_RUNBOOKS_READ } from '@shared/analysis/types';
import { api } from '../lib/api';
import { useChangeSelection } from '../lib/changeSelection';
import { formatAbsolute } from '../lib/format';
import { useRouter } from '../lib/router';
import { useSite } from '../lib/site';
import { useApi } from '../lib/useApi';
import { IssueTable } from '../components/IssueTable';
import { OriginTag } from '../components/OriginTag';
import { PageHeader } from '../components/Shell';
import { EmptyState, ErrorPanel, SkeletonRows } from '../components/States';
import { CheckImpactButton } from '../components/readiness/CheckImpactButton';
import {
  AnalysisStatement,
  CoverageFacts,
  FindingItem,
  SubjectsTable,
} from '../components/readiness/Analysis';

export function ReadinessPage() {
  const { selected } = useChangeSelection();
  return selected ? <AnalysisView change={selected} /> : <ChangePicker />;
}

function ChangePicker() {
  const { navigate } = useRouter();
  const load = useCallback(
    () => api.listRecentChanges({ updatedWithin: '30d', maxResults: 25 }),
    [],
  );
  const { state, retry } = useApi(load);

  return (
    <>
      <PageHeader
        title="Readiness checks"
        lead="Pick a Jira change to see which recovery steps in Confluence may depend on what it changes."
        aside={<OriginTag origin="live" product="Jira and Confluence" />}
      />
      <section
        className="region"
        aria-labelledby="picker-title"
        aria-busy={state.status === 'loading'}
      >
        <div className="region-head">
          <h2 id="picker-title" className="section-title">
            Recent changes
          </h2>
        </div>
        <p className="region-body">
          A check reads the change and up to {MAX_RUNBOOKS_READ} recovery runbooks, then quotes the
          text behind every finding. Nothing is checked until you ask.
        </p>
        {state.status === 'loading' ? (
          <SkeletonRows rows={6} label="Loading recent Jira changes" />
        ) : null}
        {state.status === 'error' ? <ErrorPanel error={state.error} onRetry={retry} /> : null}
        {state.status === 'ready' && state.data.issues.length === 0 ? (
          <EmptyState
            title="No Jira issues updated in the last 30 days"
            action={{ label: 'Browse all changes', onClick: () => navigate('changes') }}
          >
            Issues you can browse in Jira appear here as they change. Older ones are on the Changes
            screen.
          </EmptyState>
        ) : null}
        {state.status === 'ready' && state.data.issues.length > 0 ? (
          <>
            <p className="results-meta">
              {state.data.issues.length} updated in the last 30 days
              {state.data.truncated ? ' (Jira has more; find older ones under Changes)' : ''}.
              Fetched {formatAbsolute(state.data.fetchedAt)}
            </p>
            <IssueTable
              issues={state.data.issues}
              caption="Recent Jira changes to check"
              rowAction={(issue) => <CheckImpactButton issue={issue} />}
            />
          </>
        ) : null}
      </section>
    </>
  );
}

function AnalysisView({ change }: { change: JiraIssueSummary }) {
  const { clear } = useChangeSelection();
  const { openInJira } = useSite();
  const load = useCallback(() => api.analyzeChange({ issueKey: change.key }), [change.key]);
  const { state, retry } = useApi(load);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.status]);

  return (
    <>
      <PageHeader
        title="Readiness check"
        lead={change.summary}
        aside={<OriginTag origin="live" product="Jira and Confluence" />}
      />
      <div className="procedure-actions analysis-actions">
        <Button onClick={clear}>Back to recent changes</Button>
        <Button appearance="subtle" onClick={() => openInJira(change.browsePath)}>
          Open {change.key} in Jira
        </Button>
        <div className="rehearse">
          <Button isDisabled aria-describedby="rehearse-note">
            Rehearse this change
          </Button>
          <span id="rehearse-note" className="rehearse-note">
            Change-specific rehearsals arrive in M5
          </span>
        </div>
      </div>

      <section
        className="region"
        aria-labelledby="analysis-status-title"
        aria-busy={state.status === 'loading'}
      >
        {state.status !== 'ready' ? (
          <h2 id="analysis-status-title" className="section-title" ref={headingRef} tabIndex={-1}>
            {state.status === 'loading'
              ? `Checking ${change.key}`
              : `${change.key} was not checked`}
          </h2>
        ) : null}
        {state.status === 'loading' ? (
          <SkeletonRows rows={4} label={`Reading ${change.key} and recovery runbooks`} />
        ) : null}
        {state.status === 'error' ? (
          <ErrorPanel error={state.error} onRetry={retry} product="Jira or Confluence" />
        ) : null}
        {state.status === 'ready' ? (
          <AnalysisStatement analysis={state.data} headingRef={headingRef} />
        ) : null}
      </section>

      {state.status === 'ready' && state.data.findings.length > 0 ? (
        <section className="region" aria-labelledby="findings-title">
          <h2 id="findings-title" className="section-title">
            Findings
          </h2>
          <ol className="findings">
            {state.data.findings.map((f) => (
              <FindingItem key={f.id} finding={f} change={change} />
            ))}
          </ol>
        </section>
      ) : null}

      {state.status === 'ready' ? (
        <div className="analysis-grid">
          <section className="region" aria-labelledby="subjects-title">
            <h2 id="subjects-title" className="section-title">
              Subjects detected
            </h2>
            <SubjectsTable subjects={state.data.subjects} />
          </section>
          <section className="region" aria-labelledby="coverage-title">
            <h2 id="coverage-title" className="section-title">
              Coverage
            </h2>
            <CoverageFacts coverage={state.data.coverage} analyzedAt={state.data.analyzedAt} />
          </section>
        </div>
      ) : null}
    </>
  );
}
