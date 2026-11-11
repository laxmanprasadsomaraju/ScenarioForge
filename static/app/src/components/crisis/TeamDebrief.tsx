import { useState } from 'react';
import type { CrisisRoomSnapshot } from '@shared/crisis/api';
import { Button } from '../Button';
import { StatusBadge, type StatusTone } from '../Badge';
import { EvidenceList } from '../simulation/Evidence';
import { SAVE_TEXT, outcomeOf, type SaveOutcome } from '../history/save';
import { api } from '../../lib/api';
import type { CrisisRoomHandle } from '../../lib/useCrisisRoom';
import { Communications, ROLE_NAME, Timeline, namer } from './parts';

const ASSESSMENT: Record<string, { label: string; tone: StatusTone }> = {
  effective: { label: 'Effective', tone: 'success' },
  neutral: { label: 'Slow', tone: 'warning' },
  harmful: { label: 'Costly', tone: 'danger' },
};

/** The team debrief: built on the server from the log, never typed in afterwards. */
export function TeamDebrief({
  room,
  handle,
}: {
  room: CrisisRoomSnapshot;
  handle: CrisisRoomHandle;
}) {
  const { view, debrief } = room;
  const name = namer(view);
  const [save, setSave] = useState<SaveOutcome | null>(null);
  if (!debrief) return null;
  const { evaluation } = debrief;

  const saveToHistory = async () => {
    setSave({ kind: 'saving' });
    setSave(outcomeOf(await api.crisisSaveDebrief({ roomId: view.roomId })));
  };

  return (
    <div className="crisis-debrief">
      <section className="region" aria-labelledby="debrief-result">
        <h2 id="debrief-result" className="section-title">
          Result: {evaluation.metCount} of {evaluation.totalCount} objectives met in{' '}
          <span className="num">{evaluation.elapsedMinutes}</span> simulated minutes
        </h2>
        <ul className="objectives" aria-label="Objectives">
          {evaluation.objectives.map((o) => (
            <li key={o.objectiveId} className={`objective objective-${o.status}`}>
              <span className="objective-label">
                {o.label}
                <span className="crisis-objective-why">{o.explanation}</span>
              </span>
              <StatusBadge tone={o.status === 'met' ? 'success' : 'danger'}>
                {o.status === 'met' ? 'Met' : 'Missed'}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </section>

      <section className="region" aria-labelledby="debrief-decisions">
        <h2 id="debrief-decisions" className="section-title">
          Who decided what
        </h2>
        <ol className="crisis-decisions" aria-label="Decisions taken">
          {debrief.decisions.map((d) => {
            const a = ASSESSMENT[d.assessment] ?? { label: d.assessment, tone: 'info' as const };
            return (
              <li key={`${d.stepId}-${d.decisionId}`}>
                <p className="crisis-proposal-head">
                  <span className="num">T+{d.atMinute}</span>
                  <span className="crisis-proposal-label">{d.label}</span>
                  <StatusBadge tone={a.tone}>{a.label}</StatusBadge>
                </p>
                <p className="crisis-proposal-by">
                  Committed by {name(d.actor)}
                  {d.proposalId ? ', adopting a proposal' : ''}
                </p>
                <p>{d.narrative}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="region" aria-labelledby="debrief-roles">
        <h2 id="debrief-roles" className="section-title">
          Contributions by role
        </h2>
        <table className="crisis-contrib">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Roles held</th>
              <th scope="col">Proposals (adopted)</th>
              <th scope="col">Decisions</th>
              <th scope="col">Messages</th>
            </tr>
          </thead>
          <tbody>
            {debrief.contributions.map((c) => (
              <tr key={c.participantId}>
                <th scope="row">{name(c.participantId)}</th>
                <td data-label="Roles held">{c.roles.map((r) => ROLE_NAME[r]).join(', ')}</td>
                <td data-label="Proposals (adopted)" className="num">
                  {c.proposals} ({c.proposalsAdopted})
                </td>
                <td data-label="Decisions" className="num">
                  {c.decisionsCommitted}
                </td>
                <td data-label="Messages" className="num">
                  {c.statusUpdates + c.stakeholderNotices}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {debrief.evidence.length ? (
        <section className="region" aria-labelledby="debrief-evidence">
          <h2 id="debrief-evidence" className="section-title">
            Evidence the decisions relied on
          </h2>
          <EvidenceList items={debrief.evidence} />
        </section>
      ) : null}

      <section className="region" aria-labelledby="debrief-notes">
        <h2 id="debrief-notes" className="section-title">
          Debrief notes
        </h2>
        <Communications
          view={view}
          busy={handle.busy}
          onPost={(kind, text) => handle.run({ type: 'communicate', kind, text })}
        />
      </section>

      <section className="region" aria-labelledby="debrief-timeline">
        <h2 id="debrief-timeline" className="section-title">
          Timeline
        </h2>
        <Timeline entries={room.timeline} view={view} />
      </section>

      {room.isOwner ? (
        <section className="region crisis-save" aria-labelledby="debrief-save">
          <h2 id="debrief-save" className="section-title">
            Keep the record
          </h2>
          <div className="crisis-save-row">
            <Button
              variant="primary"
              isDisabled={save?.kind === 'saving' || save?.kind === 'saved'}
              onClick={() => void saveToHistory()}
            >
              Save to history
            </Button>
            {view.status !== 'closed' ? (
              <Button isDisabled={handle.busy} onClick={() => void handle.run({ type: 'close' })}>
                Close room
              </Button>
            ) : null}
          </div>
          <p className="region-body" role="status">
            {save === null
              ? 'Saves the team run to your rehearsal history, where it is re-verified on read.'
              : save.kind === 'saving'
                ? SAVE_TEXT.saving
                : save.kind === 'saved'
                  ? SAVE_TEXT.saved
                  : save.kind === 'not-enabled'
                    ? SAVE_TEXT.notEnabled
                    : `Not saved: ${save.reason}`}
          </p>
        </section>
      ) : null}
    </div>
  );
}
