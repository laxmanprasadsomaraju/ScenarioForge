import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import type { ConfluencePageSummary } from '@shared/api';
import { RECOVERY_TERMS } from '@shared/api';
import { api } from '../lib/api';
import { formatAbsolute, formatRelative } from '../lib/format';
import { useSite } from '../lib/site';
import { useApi } from '../lib/useApi';
import { OriginTag } from '../components/OriginTag';
import { StatusBadge } from '../components/Badge';
import { DataRegion } from '../components/DataRegion';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorPanel, SkeletonRows } from '../components/States';

// Mirrors the server-side check so the user gets feedback before a round trip;
// the resolver still validates every request.
const SPACE_KEY = /^~?[A-Za-z0-9]{1,255}$/;

export function RecoveryPlansPage() {
  const [spaceInput, setSpaceInput] = useState('');
  const [spaceKey, setSpaceKey] = useState<string | null>(null);
  const [open, setOpen] = useState<ConfluencePageSummary | null>(null);
  const spaceInvalid = spaceInput.trim() !== '' && !SPACE_KEY.test(spaceInput.trim());

  const load = useCallback(
    () => api.listRecoveryPages({ terms: [...RECOVERY_TERMS], spaceKey, maxResults: 25 }),
    [spaceKey],
  );
  const { state, retry } = useApi(load);

  if (open) {
    return <ProcedureView page={open} onBack={() => setOpen(null)} />;
  }

  return (
    <>
      <PageHeader
        title="Recovery plans"
        lead="Runbooks found in Confluence, read with your permissions. Open one to see the steps ScenarioForge extracts."
        aside={<OriginTag origin="live" product="Confluence" />}
      />

      <form
        className="toolbar"
        role="search"
        aria-label="Find recovery pages"
        onSubmit={(e) => {
          e.preventDefault();
          if (!spaceInvalid) setSpaceKey(spaceInput.trim() || null);
        }}
      >
        <label className="field field-grow">
          <span className="field-label">Space key (optional)</span>
          <input
            type="text"
            name="space"
            autoComplete="off"
            placeholder="All spaces you can view"
            value={spaceInput}
            aria-invalid={spaceInvalid}
            aria-describedby="space-help"
            onChange={(e) => setSpaceInput(e.target.value)}
          />
          <span id="space-help" className="field-help">
            {spaceInvalid ? 'Use letters and digits only, for example OPS.' : ' '}
          </span>
        </label>
        <div className="toolbar-action">
          <Button type="submit" isDisabled={spaceInvalid}>
            Search
          </Button>
        </div>
      </form>

      <DataRegion
        id="plans-results"
        title="Recovery pages"
        hideTitle
        state={state}
        loading={{ label: 'Searching Confluence', rows: 5 }}
        onRetry={retry}
        product="Confluence"
        isEmpty={(data) => data.pages.length === 0}
        empty={(data) => (
          <EmptyState title="No recovery pages found">
            Confluence returned no pages you can view.
            <details className="query-details">
              <summary>Show query</summary>
              <code>{data.cql}</code>
            </details>
          </EmptyState>
        )}
      >
        {(data) => (
          <>
            <p className="results-meta">
              {data.pages.length} pages
              {data.truncated ? ' (Confluence has more; narrow by space)' : ''}. Fetched{' '}
              {formatAbsolute(data.fetchedAt)}.
            </p>
            <details className="query-details">
              <summary>Show query</summary>
              <code>{data.cql}</code>
            </details>
            <table className="issues">
              <caption className="visually-hidden">Recovery pages in Confluence</caption>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Space</th>
                  <th scope="col" className="col-updated">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.pages.map((page) => (
                  <tr key={page.id}>
                    <th scope="row" data-label="Page">
                      <button
                        type="button"
                        className="issue-key page-title"
                        onClick={() => setOpen(page)}
                      >
                        {page.title}
                      </button>
                    </th>
                    <td data-label="Space">{page.spaceKey ?? 'Unknown'}</td>
                    <td data-label="Updated" className="col-updated num">
                      <time
                        dateTime={page.lastUpdated ?? undefined}
                        title={formatAbsolute(page.lastUpdated)}
                      >
                        {formatRelative(page.lastUpdated)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </DataRegion>
    </>
  );
}

function ProcedureView({ page, onBack }: { page: ConfluencePageSummary; onBack: () => void }) {
  const { openInJira } = useSite();
  const load = useCallback(() => api.getRecoveryProcedure({ pageId: page.id }), [page.id]);
  const { state, retry } = useApi(load);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const webuiPath = state.status === 'ready' ? state.data.webuiPath : page.webuiPath;

  return (
    <>
      <PageHeader
        title="Recovery plan"
        lead={page.title}
        aside={<OriginTag origin="live" product="Confluence" />}
      />
      <div className="procedure-actions">
        <Button onClick={onBack}>Back to recovery pages</Button>
        {webuiPath ? (
          <Button onClick={() => openInJira(`/wiki${webuiPath}`)}>Open in Confluence</Button>
        ) : null}
      </div>

      <section
        className="region"
        aria-labelledby="procedure-title"
        aria-busy={state.status === 'loading'}
      >
        <h2 id="procedure-title" className="section-title" ref={headingRef} tabIndex={-1}>
          Extracted steps
        </h2>
        {state.status === 'loading' ? <SkeletonRows rows={4} label="Reading the page" /> : null}
        {state.status === 'error' ? (
          <ErrorPanel error={state.error} onRetry={retry} product="Confluence" />
        ) : null}
        {state.status === 'ready' ? (
          <>
            {state.data.stepSource === 'ordered-list' ? (
              <p className="results-meta">
                {state.data.steps.length} numbered{' '}
                {state.data.steps.length === 1 ? 'step' : 'steps'}, in page order
              </p>
            ) : null}
            {state.data.stepSource === 'ordered-list' ? (
              <ol className="runbook-steps procedure-steps">
                {state.data.steps.map((step) => (
                  <li key={step.order}>{step.instruction}</li>
                ))}
              </ol>
            ) : (
              <div className="steps-missing">
                <StatusBadge tone="unknown">No numbered steps</StatusBadge>
                <p className="region-body">
                  This page has no numbered list, so ScenarioForge did not guess any steps.
                  Readiness checks cannot compare a change against it. The text below is the page as
                  written.
                </p>
              </div>
            )}
            <dl className="facts procedure-facts">
              <dt>Source</dt>
              <dd>{state.data.evidence.title}</dd>
              <dt>Page updated</dt>
              <dd>{formatAbsolute(state.data.lastUpdated)}</dd>
              <dt>Read at</dt>
              <dd>{formatAbsolute(state.data.evidence.retrievedAt ?? null)}</dd>
              <dt>Read with</dt>
              <dd>Your Confluence permissions</dd>
              <dt>Dependencies</dt>
              <dd>Shown on the readiness check of a change that touches this page.</dd>
            </dl>
            <h3 className="section-title">Page text, quoted</h3>
            <blockquote className="quote procedure-excerpt">
              {state.data.excerpt}
              {state.data.excerptTruncated ? ' …' : ''}
            </blockquote>
          </>
        ) : null}
      </section>
    </>
  );
}
