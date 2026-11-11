import { Button } from '../components/Button';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { HistoryListItem, ListRehearsalHistoryResponse } from '@shared/api';
import { api } from '../lib/api';
import { useExercises, type CompletedExercise } from '../lib/exercises';
import { formatAbsolute } from '../lib/format';
import { useRouter } from '../lib/router';
import { useApi } from '../lib/useApi';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorPanel, SkeletonRows } from '../components/States';
import { Debrief } from '../components/simulation/Debrief';
import { HistoryDetail, type HistoryTarget } from '../components/history/HistoryDetail';
import { IntegrityStatus } from '../components/history/IntegrityStatus';
import {
  describeEntry,
  STATE_TEXT,
  VERDICT,
  type CheckedStatus,
} from '../components/history/records';

/**
 * History (route id `reports`): the caller's saved rehearsals and retests.
 * The server picks the user from the Forge context; nothing here sends an
 * account id. When history cannot be loaded, the reports from this tab stay
 * available in a separate "This tab only" section.
 */

type Open = { kind: 'saved'; target: HistoryTarget } | { kind: 'tab'; exercise: CompletedExercise };

const loadHistory = () => api.listRehearsalHistory();

function openKey(open: Open): string {
  return open.kind === 'saved' ? `saved:${open.target.id}` : `tab:${open.exercise.session.id}`;
}

export function ReportsPage() {
  const [open, setOpen] = useState<Open | null>(null);
  const [checked, setChecked] = useState<Record<string, CheckedStatus>>({});
  // After "Back to history", focus returns to the button the record was opened from.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const onChecked = useCallback(
    (id: string, status: CheckedStatus) =>
      setChecked((all) => (all[id] === status ? all : { ...all, [id]: status })),
    [],
  );

  if (open) {
    const back = () => {
      setReturnTo(openKey(open));
      setOpen(null);
    };
    if (open.kind === 'saved') {
      return <HistoryDetail target={open.target} onBack={back} onChecked={onChecked} />;
    }
    return (
      <>
        <PageHeader
          title={open.exercise.retest ? 'Retest report' : 'After-action report'}
          lead={open.exercise.scenario.title}
          aside={<Button onClick={back}>Back to history</Button>}
        />
        <p className="demo-note">This report is from this tab only and was not saved.</p>
        <Debrief scenario={open.exercise.scenario} exercise={open.exercise} />
      </>
    );
  }

  return <HistoryList onOpen={setOpen} checked={checked} returnTo={returnTo} />;
}

function HistoryList({
  onOpen,
  checked,
  returnTo,
}: {
  onOpen: (open: Open) => void;
  checked: Record<string, CheckedStatus>;
  returnTo: string | null;
}) {
  const { state, retry } = useApi<ListRehearsalHistoryResponse>(loadHistory);
  const listReady = state.status !== 'loading';
  const saved = state.status === 'ready' && state.data.status === 'OK' ? state.data : null;

  // Focus the button the record was opened from, once the rows it lives in are back.
  const returnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (listReady && returnTo) returnRef.current?.focus();
  }, [listReady, returnTo]);
  const refFor = (key: string) => (key === returnTo ? returnRef : undefined);

  return (
    <>
      <PageHeader
        title="History"
        lead="Your saved rehearsals and retests. Only you can see them; each record is checked again when you open it."
      />
      <section className="region" aria-labelledby="saved-title">
        <h2 id="saved-title" className="section-title">
          Saved rehearsals
        </h2>
        {state.status === 'loading' ? <SkeletonRows label="Loading your history" /> : null}
        {state.status === 'error' ? (
          <ErrorPanel error={state.error} onRetry={retry} product="Jira" />
        ) : null}
        {state.status === 'ready' && state.data.status !== 'OK' ? (
          <div className="history-unavailable" role="status">
            <IntegrityStatus state="unavailable" />
            <p className="history-unavailable-title">{STATE_TEXT.unavailable}</p>
            <p className="region-body">
              {state.data.status === 'CONFLICT'
                ? 'Your history was being updated at the same time. Try again.'
                : state.data.detail}
            </p>
            {state.data.status === 'CONFLICT' ? <Button onClick={retry}>Try again</Button> : null}
          </div>
        ) : null}
        {saved ? (
          <SavedTable
            items={saved.items}
            checked={checked}
            onOpen={(target) => onOpen({ kind: 'saved', target })}
            refFor={refFor}
          />
        ) : null}
      </section>
      {listReady && !saved ? (
        <InTabReports onOpen={(exercise) => onOpen({ kind: 'tab', exercise })} refFor={refFor} />
      ) : null}
    </>
  );
}

type RefFor = (key: string) => RefObject<HTMLButtonElement> | undefined;

function SavedTable({
  items,
  checked,
  onOpen,
  refFor,
}: {
  items: HistoryListItem[];
  checked: Record<string, CheckedStatus>;
  onOpen: (target: HistoryTarget) => void;
  refFor: RefFor;
}) {
  const { navigate } = useRouter();
  if (items.length === 0) {
    return (
      <EmptyState
        title={STATE_TEXT.empty}
        action={{ label: 'Run the demo rehearsal', onClick: () => navigate('simulations') }}
      >
        Finish a rehearsal and it is saved here for 90 days, with any retests of it.
      </EmptyState>
    );
  }
  return (
    <table className="plain-table history-table">
      <caption className="visually-hidden">Saved rehearsals, newest first</caption>
      <thead>
        <tr>
          <th scope="col">Scenario</th>
          <th scope="col">Completed</th>
          <th scope="col">Original result</th>
          <th scope="col">Retests</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map(({ run, retests }) => {
          const { title, source } = describeEntry(run);
          return (
            <tr key={run.id}>
              <th scope="row">
                <span className="history-scenario">{title}</span>
                <span className="history-source">{source}</span>
              </th>
              <td data-label="Completed">{formatAbsolute(run.completedAt)}</td>
              <td className="num" data-label="Original result">
                {run.metCount} of {run.totalCount} objectives met
              </td>
              <td data-label="Retests">
                {retests.length === 0 ? (
                  'None'
                ) : (
                  <ol className="history-retests">
                    {retests.map((r, i) => (
                      <li key={r.id}>
                        <span>
                          Retest {i + 1}: {r.outcome ? VERDICT[r.outcome] : 'No verdict'},{' '}
                          <span className="num">
                            {r.metCount} of {r.totalCount}
                          </span>{' '}
                          met
                        </span>
                        {checked[r.id] ? <IntegrityStatus state={checked[r.id]!} /> : null}
                        <Button
                          ref={refFor(`saved:${r.id}`)}
                          aria-label={`Open retest ${i + 1} of ${title}`}
                          onClick={() => onOpen({ kind: 'retest', id: r.id })}
                        >
                          Open retest
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
              </td>
              <td data-label="Status">
                <span className="history-status">
                  <IntegrityStatus state={checked[run.id] ?? 'unchecked'} />
                </span>
                <Button
                  ref={refFor(`saved:${run.id}`)}
                  aria-label={`Open report: ${title}, ${formatAbsolute(run.completedAt)}`}
                  onClick={() => onOpen({ kind: 'run', id: run.id })}
                >
                  Open report
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Reports from this browser tab, shown when saved history is not available. */
function InTabReports({
  onOpen,
  refFor,
}: {
  onOpen: (exercise: CompletedExercise) => void;
  refFor: RefFor;
}) {
  const { completed } = useExercises();
  const { navigate } = useRouter();
  return (
    <section className="region" aria-labelledby="tab-title">
      <h2 id="tab-title" className="section-title">
        This tab only
      </h2>
      <p className="region-body">
        Rehearsals finished in this browser tab. They are not saved and are gone when the tab
        closes.
      </p>
      {completed.length === 0 ? (
        <EmptyState
          title="No rehearsals in this tab yet"
          action={{ label: 'Run the demo rehearsal', onClick: () => navigate('simulations') }}
        >
          Finish a rehearsal and its report appears here.
        </EmptyState>
      ) : (
        <table className="plain-table">
          <caption className="visually-hidden">Rehearsals in this tab, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Completed</th>
              <th scope="col" className="num">
                Objectives met
              </th>
              <th scope="col" className="num">
                Simulated time
              </th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {completed.map((ex) => (
              <tr key={ex.session.id}>
                <th scope="row">
                  <span className="history-scenario">
                    {ex.scenario.title}
                    {ex.retest ? ` (retest: ${VERDICT[ex.retest.comparison.outcome]})` : ''}
                  </span>
                  <span className="history-source">
                    {ex.scenario.id.startsWith('rehearsal:')
                      ? `Modelled from ${ex.scenario.changeContext.key}`
                      : 'Synthetic demo'}
                  </span>
                </th>
                <td data-label="Completed">{formatAbsolute(ex.completedAt)}</td>
                <td className="num" data-label="Objectives met">
                  {ex.evaluation.metCount} of {ex.evaluation.totalCount}
                </td>
                <td className="num" data-label="Simulated time">
                  {ex.evaluation.elapsedMinutes} min
                </td>
                <td>
                  <Button
                    ref={refFor(`tab:${ex.session.id}`)}
                    aria-label={`Open report from ${formatAbsolute(ex.completedAt)}`}
                    onClick={() => onOpen(ex)}
                  >
                    Open report
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
