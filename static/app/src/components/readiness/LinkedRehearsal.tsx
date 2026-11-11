import { useEffect, useRef } from 'react';
import { Button } from '../Button';
import type { RehearsalLink } from '@shared/links/deepLink';
import { useRouter } from '../../lib/router';
import { useReadinessCheck } from '../../lib/useReadinessCheck';
import { OriginTag } from '../OriginTag';
import { PageHeader } from '../PageHeader';
import { ErrorPanel, SkeletonRows } from '../States';
import { AnalysisStatement, FindingItem, findingItemId } from './Analysis';
import { MissingFindingNotice } from './LinkNotice';
import { RehearseFinding } from './RehearseFinding';

/**
 * A rehearsal link (`/simulations?change=…&finding=…&restore=…`). The change
 * is checked again with the user's own access; only when that result contains
 * the finding is the Rehearse form filled in, and the user still presses
 * "Rehearse this finding" to build it. Nothing starts or spends on arrival.
 */
export function LinkedRehearsal({ link }: { link: RehearsalLink }) {
  const { navigate } = useRouter();
  const { analysis: state, retry } = useReadinessCheck(link.change);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const linked =
    state.status === 'ready'
      ? (state.data.findings.find((f) => f.id === link.finding) ?? null)
      : null;

  const linkedId = linked?.id ?? null;

  useEffect(() => {
    const item = linkedId ? document.getElementById(findingItemId(linkedId)) : null;
    if (item) {
      item.scrollIntoView?.({ block: 'start' });
      item.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [state.status, linkedId]);

  return (
    <>
      <PageHeader
        title="Rehearse from a link"
        lead={`ScenarioForge checks ${link.change} again with your access before it fills anything in.`}
        aside={<OriginTag origin="live" product="Jira and Confluence" />}
      />
      <div className="procedure-actions analysis-actions">
        <Button onClick={() => navigate('simulations')}>Close link</Button>
      </div>

      <section
        className="region"
        aria-labelledby="analysis-status-title"
        aria-busy={state.status === 'loading'}
      >
        {state.status !== 'ready' ? (
          <h2 id="analysis-status-title" className="section-title" ref={headingRef} tabIndex={-1}>
            {state.status === 'loading'
              ? `Checking ${link.change}`
              : `${link.change} was not checked`}
          </h2>
        ) : null}
        {state.status === 'loading' ? (
          <SkeletonRows rows={4} label={`Reading ${link.change} and recovery runbooks`} />
        ) : null}
        {state.status === 'error' ? (
          <ErrorPanel error={state.error} onRetry={retry} product="Jira or Confluence" />
        ) : null}
        {state.status === 'ready' ? (
          <AnalysisStatement analysis={state.data} headingRef={headingRef} />
        ) : null}
      </section>

      {state.status === 'ready' && !linked ? (
        <MissingFindingNotice changeKey={state.data.changeKey} />
      ) : null}

      {state.status === 'ready' && state.data.findings.length > 0 ? (
        <section className="region" aria-labelledby="findings-title">
          <h2 id="findings-title" className="section-title">
            {linked ? 'Linked finding' : 'Findings'}
          </h2>
          <ol className="findings">
            {(linked ? [linked] : state.data.findings).map((f) => (
              <FindingItem
                key={f.id}
                finding={f}
                change={state.data.change}
                linked={f === linked}
              />
            ))}
          </ol>
        </section>
      ) : null}

      {state.status === 'ready' ? (
        <RehearseFinding
          analysis={state.data}
          {...(linked
            ? {
                prefill: {
                  findingId: linked.id,
                  restore: link.restore,
                  ...(link.notify !== undefined ? { notify: link.notify } : {}),
                },
              }
            : {})}
        />
      ) : null}
    </>
  );
}
