import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CrisisRoomSnapshot } from '@shared/crisis/api';
import type { ObjectiveProgress } from '@shared/simulation/engine';
import { Button } from '../Button';
import { StatusBadge, type StatusTone } from '../Badge';
import { EvidenceList } from '../simulation/Evidence';
import { OBJECTIVE_LABEL } from '../simulation/Objectives';
import type { CrisisRoomHandle } from '../../lib/useCrisisRoom';
import { Communications, ParticipantList, ROLE_NAME, Timeline, namer } from './parts';

const TONE: Record<ObjectiveProgress, StatusTone> = {
  pending: 'unknown',
  met: 'success',
  missed: 'danger',
};

export function Running({ room, handle }: { room: CrisisRoomSnapshot; handle: CrisisRoomHandle }) {
  const { view } = room;
  const name = namer(view);
  const label = new Map(view.options.map((o) => [o.id, o.label]));
  const situationRef = useRef<HTMLHeadingElement>(null);
  const stepId = view.step?.id;
  const first = useRef(true);

  // Focus the new situation when the step moves on, as the solo rehearsal does.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    situationRef.current?.focus();
  }, [stepId]);

  return (
    <div className="crisis-running">
      <div className="crisis-grid">
        <section className="crisis-stage" aria-labelledby="crisis-situation">
          {view.step ? (
            <div className="situation-block" key={view.step.id}>
              <h2
                id="crisis-situation"
                className="situation-title"
                ref={situationRef}
                tabIndex={-1}
              >
                {view.step.title}
              </h2>
              <p className="situation">{view.step.situation}</p>
            </div>
          ) : null}

          {view.can.commit ? (
            <CommanderPanel room={room} handle={handle} />
          ) : view.can.propose ? (
            <ProposeForm room={room} handle={handle} />
          ) : (
            <p className="crisis-readonly">
              You are observing. You can follow the situation, proposals, messages and timeline; you
              cannot act.
            </p>
          )}

          <section className="region" aria-labelledby="crisis-proposals">
            <h2 id="crisis-proposals" className="section-title">
              Proposals for this step
            </h2>
            {view.openProposals.length ? (
              <ul className="crisis-proposals" aria-label="Open proposals">
                {view.openProposals.map((p) => (
                  <li key={p.proposalId} className="crisis-proposal">
                    <p className="crisis-proposal-head">
                      <span className="crisis-proposal-label">
                        {label.get(p.decisionId) ?? 'A decision'}
                      </span>
                      <span className="crisis-proposal-by">
                        from {name(p.proposer)}, {ROLE_NAME[p.proposerRole]}
                      </span>
                    </p>
                    {p.rationale ? <p className="crisis-proposal-why">{p.rationale}</p> : null}
                    {view.can.commit ? (
                      <div>
                        <Button
                          isDisabled={handle.busy}
                          onClick={() =>
                            void handle.run({
                              type: 'commit-decision',
                              decisionId: p.decisionId,
                              proposalId: p.proposalId,
                            })
                          }
                        >
                          Adopt and commit
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="region-body">No proposals yet for this step.</p>
            )}
          </section>
        </section>

        <aside className="crisis-side" aria-label="Objectives, messages and evidence">
          <section className="region" aria-labelledby="crisis-people">
            <h2 id="crisis-people" className="section-title">
              People in the room
            </h2>
            <ParticipantList view={view} isOwnerOf={room.isOwner ? view.viewer : null} />
          </section>
          <section className="region" aria-labelledby="crisis-objectives">
            <h2 id="crisis-objectives" className="section-title">
              Objectives
            </h2>
            <ul className="objectives" aria-label="Objectives">
              {view.objectives.map((o) => (
                <li key={o.objectiveId} className={`objective objective-${o.progress}`}>
                  <span className="objective-label">{o.label}</span>
                  <StatusBadge tone={TONE[o.progress]}>{OBJECTIVE_LABEL[o.progress]}</StatusBadge>
                </li>
              ))}
            </ul>
          </section>
          <section className="region" aria-labelledby="crisis-comms">
            <h2 id="crisis-comms" className="section-title">
              Communications
            </h2>
            <Communications
              view={view}
              busy={handle.busy}
              onPost={(kind, text) => handle.run({ type: 'communicate', kind, text })}
            />
          </section>
          {view.evidence.length ? (
            <details className="region panel-disclosure">
              <summary>
                <span className="panel-title">Evidence for your role</span>
                <span className="panel-meta">{view.evidence.length} sources</span>
              </summary>
              <div className="panel-body">
                <EvidenceList items={view.evidence} />
              </div>
            </details>
          ) : null}
        </aside>

        <section className="region crisis-log" aria-labelledby="crisis-timeline">
          <h2 id="crisis-timeline" className="section-title">
            Shared timeline
          </h2>
          <Timeline entries={room.timeline} view={view} />
        </section>
      </div>
    </div>
  );
}

function CommanderPanel({ room, handle }: { room: CrisisRoomSnapshot; handle: CrisisRoomHandle }) {
  const { view } = room;
  return (
    <section className="region" aria-labelledby="crisis-commit">
      <h2 id="crisis-commit" className="section-title">
        Commit a decision
      </h2>
      <p className="region-body">
        Only the incident commander commits. Adopt a proposal below or choose directly.
      </p>
      <ul className="decisions" aria-label="Your options">
        {view.options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              className="decision"
              disabled={handle.busy}
              onClick={() => void handle.run({ type: 'commit-decision', decisionId: o.id })}
            >
              <span className="decision-label">{o.label}</span>
              {o.detail ? <span className="decision-detail">{o.detail}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProposeForm({ room, handle }: { room: CrisisRoomSnapshot; handle: CrisisRoomHandle }) {
  const { view } = room;
  const [choice, setChoice] = useState<string>('');
  const [why, setWhy] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!choice) return;
    if (await handle.run({ type: 'propose', decisionId: choice, rationale: why.trim() })) {
      setChoice('');
      setWhy('');
    }
  };
  return (
    <section className="region" aria-labelledby="crisis-propose">
      <h2 id="crisis-propose" className="section-title">
        Propose a decision
      </h2>
      <p className="region-body">
        The incident commander decides. Your proposal and reason are shown to the whole room.
      </p>
      <form className="crisis-form" onSubmit={submit}>
        <fieldset className="crisis-options">
          <legend className="field-label">Option</legend>
          {view.options.map((o) => (
            <label key={o.id} className="crisis-option">
              <input
                type="radio"
                name="crisis-option"
                value={o.id}
                checked={choice === o.id}
                onChange={() => setChoice(o.id)}
              />
              <span>
                <span className="decision-label">{o.label}</span>
                {o.detail ? <span className="decision-detail">{o.detail}</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="field-label">Why (optional)</span>
          <textarea value={why} maxLength={500} rows={2} onChange={(e) => setWhy(e.target.value)} />
        </label>
        <div>
          <Button type="submit" variant="primary" isDisabled={handle.busy || !choice}>
            Propose
          </Button>
        </div>
      </form>
    </section>
  );
}
