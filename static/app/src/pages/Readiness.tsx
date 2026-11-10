import { useCallback, useEffect, useRef } from 'react';
import { Button } from '../components/Button';
import { MAX_RUNBOOKS_READ } from '@shared/analysis/types';
import { api } from '../lib/api';
import { useChangeSelection, type SelectedChange } from '../lib/changeSelection';
import { formatAbsolute } from '../lib/format';
import { useRouter } from '../lib/router';
import { useSite } from '../lib/site';
import { useApi } from '../lib/useApi';
import { useReadinessCheck } from '../lib/useReadinessCheck';
import { IssueTable } from '../components/IssueTable';
import { OriginTag } from '../components/OriginTag';
import { DataRegion } from '../components/DataRegion';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorPanel, SkeletonRows } from '../components/States';
import { CheckImpactButton } from '../components/readiness/CheckImpactButton';
import {
  AnalysisStatement,
  CoverageFacts,
  FindingItem,
  findingItemId,
  SubjectsTable,
} from '../components/readiness/Analysis';
import { MissingFindingNotice, RejectedLinkNotice } from '../components/readiness/LinkNotice';
import { ImpactPath } from '../components/readiness/ImpactPath';
import { RehearseFinding } from '../components/readiness/RehearseFinding';

export function ReadinessPage() {
  const { selected } = useChangeSelection();
  const { link } = useRouter();
  if (selected) return <AnalysisView change={selected} />;
  return (
    <>
      {link.kind === 'rejected' ? <RejectedLinkNotice link={link} /> : null}
      <ChangePicker />
    </>
  );
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
      <DataRegion
        id="picker-title"
        title="Recent changes"
        intro={
          <p className="region-body">
            A check reads the change and up to {MAX_RUNBOOKS_READ} recovery runbooks, then quotes
            the text behind every finding. Nothing is checked until you ask.
          </p>
        }
        state={state}
        loading={{ label: 'Loading recent Jira changes', rows: 6 }}
        onRetry={retry}
        isEmpty={(data) => data.issues.length === 0}
        empty={
          <EmptyState
            title="No Jira issues updated in the last 30 days"
            action={{ label: 'Browse all changes', onClick: () => navigate('changes') }}
          >
            Issues you can browse in Jira appear here as they change. Older ones are on the Changes
            screen.
          </EmptyState>
        }
      >
        {(data) => (
          <>
            <p className="results-meta">
              {data.issues.length} updated in the last 30 days
              {data.truncated ? ' (Jira has more; find older ones under Changes)' : ''}. Fetched{' '}
              {formatAbsolute(data.fetchedAt)}
            </p>
            <IssueTable
              issues={data.issues}
              caption="Recent Jira changes to check"
              rowAction={(issue) => <CheckImpactButton issue={issue} />}
            />
          </>
        )}
      </DataRegion>
    </>
  );
}

function AnalysisView({ change }: { change: SelectedChange }) {
  const { clear } = useChangeSelection();
  const { openInJira } = useSite();
  // One run: the graph carries the analysis; analyzeChange is only a fallback.
  const { analysis: state, graph, retry, retryGraph } = useReadinessCheck(change.key);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { focusFinding } = change;
  // A linked finding counts only when the user's own result contains it.
  const linkedId =
    state.status === 'ready' && focusFinding
      ? (state.data.findings.find((f) => f.id === focusFinding)?.id ?? null)
      : null;

  useEffect(() => {
    const item = linkedId ? document.getElementById(findingItemId(linkedId)) : null;
    if (item) {
      item.scrollIntoView?.({ block: 'start' });
      item.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [state.status, linkedId]);

  // Once loaded, show the change exactly as the analysis read it from Jira.
  const shown =
    state.status === 'ready'
      ? state.data.change
      : (change.summary ?? {
          key: change.key,
          summary: `Reading ${change.key} from Jira with your access.`,
          browsePath: `/browse/${change.key}`,
        });

  return (
    <>
      <PageHeader
        title="Readiness check"
        lead={shown.summary}
        aside={<OriginTag origin="live" product="Jira and Confluence" />}
      />
      <div className="procedure-actions analysis-actions">
        <Button onClick={clear}>Back to recent changes</Button>
        <Button onClick={() => openInJira(shown.browsePath)}>Open {shown.key} in Jira</Button>
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

      {state.status === 'ready' && focusFinding && !linkedId ? (
        <MissingFindingNotice changeKey={state.data.changeKey} />
      ) : null}

      {state.status === 'ready' && state.data.findings.length > 0 ? (
        <section className="region" aria-labelledby="findings-title">
          <h2 id="findings-title" className="section-title">
            Findings
          </h2>
          <ol className="findings">
            {state.data.findings.map((f) => (
              <FindingItem
                key={f.id}
                finding={f}
                change={state.data.change}
                linked={f.id === linkedId}
              />
            ))}
          </ol>
        </section>
      ) : null}

      {state.status === 'ready' ? (
        <RehearseFinding
          key={linkedId ?? ''}
          analysis={state.data}
          {...(linkedId ? { prefill: { findingId: linkedId } } : {})}
        />
      ) : null}

      {state.status === 'ready' ? (
        <section
          className="region"
          aria-labelledby="impact-title"
          aria-busy={graph.status === 'loading'}
        >
          <h2 id="impact-title" className="section-title">
            Impact path
          </h2>
          <p className="region-body">
            How {state.data.changeKey} reaches recovery steps, runbook pages, services and owning
            teams. Open any link to read the source text behind it.
          </p>
          {graph.status === 'loading' ? (
            <SkeletonRows rows={3} label={`Tracing the impact path of ${change.key}`} />
          ) : null}
          {graph.status === 'error' ? (
            <ErrorPanel error={graph.error} onRetry={retryGraph} product="Jira or Confluence" />
          ) : null}
          {graph.status === 'ready' ? <ImpactPath graph={graph.data} /> : null}
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
