import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button } from '../Button';
import type { ApiResult, GetRehearsalRunResponse, GetRetestComparisonResponse } from '@shared/api';
import { api } from '../../lib/api';
import { formatAbsolute } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { OriginBadge } from '../Badge';
import { PageHeader } from '../PageHeader';
import { ErrorPanel, SkeletonRows } from '../States';
import { Debrief } from '../simulation/Debrief';
import { SessionId } from './SessionId';
import { IntegrityStatus, type IntegrityState } from './IntegrityStatus';
import {
  exerciseFromRetest,
  exerciseFromRun,
  STATE_TEXT,
  VERDICT,
  type CheckedStatus,
} from './records';

export type HistoryTarget = { kind: 'run'; id: string } | { kind: 'retest'; id: string };

type Response = GetRehearsalRunResponse | GetRetestComparisonResponse;

/** A non-OK answer as a state heading (word and icon) and one sentence; never any record content. */
function StateMessage({ state, children }: { state: IntegrityState; children: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section
      className={`region history-state history-state-${state}`}
      aria-labelledby="history-state-title"
    >
      <h2 id="history-state-title" className="section-title" ref={heading} tabIndex={-1}>
        <IntegrityStatus state={state} />
      </h2>
      <p className="region-body">{children}</p>
    </section>
  );
}

function checkedOf(data: Response): CheckedStatus | null {
  switch (data.status) {
    case 'OK':
      return 'verified';
    case 'TAMPERED':
      return 'tampered';
    case 'UNVERIFIABLE':
      return 'unverifiable';
    case 'NOT_FOUND':
      return 'not-found';
    default:
      return null;
  }
}

/** One saved run or retest, re-verified by the server when it is opened. */
export function HistoryDetail({
  target,
  onBack,
  onChecked,
}: {
  target: HistoryTarget;
  onBack: () => void;
  /** Reports what opening the record showed, for the list's status column. */
  onChecked: (id: string, status: CheckedStatus) => void;
}) {
  const load = useCallback(
    (): Promise<ApiResult<Response>> =>
      target.kind === 'run'
        ? api.getRehearsalRun({ runId: target.id })
        : api.getRetestComparison({ retestId: target.id }),
    [target.kind, target.id],
  );
  const { state, retry } = useApi<Response>(load);

  useEffect(() => {
    if (state.status !== 'ready') return;
    const checked = checkedOf(state.data);
    if (checked) onChecked(target.id, checked);
  }, [state, target.id, onChecked]);

  const exercise = useMemo(() => {
    if (state.status !== 'ready' || state.data.status !== 'OK') return null;
    const data = state.data;
    return 'run' in data
      ? exerciseFromRun(data.run)
      : exerciseFromRetest(data.original, data.retest, data.comparison);
  }, [state]);

  const isRetest = target.kind === 'retest';
  const title = isRetest ? 'Retest report' : 'After-action report';
  const back = <Button onClick={onBack}>Back to history</Button>;

  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title={title} lead="Checking the saved record…" aside={back} />
        <SkeletonRows label="Loading the saved rehearsal" />
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title={title} lead="Saved rehearsal" aside={back} />
        <ErrorPanel error={state.error} onRetry={retry} />
      </>
    );
  }

  const data = state.data;
  if (data.status !== 'OK' || !exercise) {
    let message: { body: string; state: IntegrityState };
    switch (data.status) {
      case 'TAMPERED':
        message = { body: STATE_TEXT.tampered, state: 'tampered' };
        break;
      case 'UNVERIFIABLE':
        message = {
          body: STATE_TEXT.unverifiable,
          state: 'unverifiable',
        };
        break;
      case 'NOT_FOUND':
        message = {
          body: STATE_TEXT.notFound,
          state: 'not-found',
        };
        break;
      case 'UNAVAILABLE':
      case 'IDENTITY_UNAVAILABLE':
        message = { body: data.detail, state: 'unavailable' };
        break;
      default:
        message = {
          body: 'The record could not be read.',
          state: 'unavailable',
        };
    }
    return (
      <>
        <PageHeader title={title} lead="Saved rehearsal" aside={back} />
        <StateMessage state={message.state}>{message.body}</StateMessage>
      </>
    );
  }

  const run = 'run' in data ? data.run : data.original;
  const provenance = run.provenance;
  const fixes =
    'retest' in data
      ? data.retest.fixSet.remediationIds.map(
          (id) => exercise.scenario.remediation.find((r) => r.id === id)?.title ?? id,
        )
      : [];

  return (
    <>
      <PageHeader
        title={title}
        lead={exercise.scenario.title}
        aside={
          <>
            <OriginBadge origin={provenance ? 'modelled' : 'synthetic'}>
              {provenance ? `Modelled from ${provenance.changeKey}` : 'Synthetic demo'}
            </OriginBadge>
            {back}
          </>
        }
      />
      <dl className="facts history-facts">
        <dt>Completed</dt>
        <dd>{formatAbsolute(exercise.completedAt)}</dd>
        <SessionId id={run.audit?.sessionId} />
        <dt>Integrity</dt>
        <dd className="history-integrity">
          <IntegrityStatus state="verified" />
          <span>Replayed from the saved decisions</span>
        </dd>
        {'retest' in data ? (
          <>
            <dt>Original result</dt>
            <dd className="num">
              {data.original.evaluation.metCount} of {data.original.evaluation.totalCount}{' '}
              objectives met, {data.original.evaluation.elapsedMinutes} simulated minutes
            </dd>
            <dt>Approved fixes</dt>
            <dd>{fixes.join('; ')}</dd>
            <dt>Verdict</dt>
            <dd>{VERDICT[data.comparison.outcome]}</dd>
          </>
        ) : null}
      </dl>
      <Debrief scenario={exercise.scenario} exercise={exercise} />
    </>
  );
}
