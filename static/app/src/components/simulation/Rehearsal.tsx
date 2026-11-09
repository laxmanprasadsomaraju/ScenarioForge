import { useEffect, useRef, useState } from 'react';
import Button from '@atlaskit/button/new';
import type { ExerciseSession, SimulationScenario } from '@shared/domain/types';
import { currentStep, decisionTrail } from '@shared/simulation/engine';
import { EvidenceList } from './Evidence';
import { ObjectiveList } from './Objectives';
import { TimeRail } from './TimeRail';

const ASSESSMENT = { effective: 'Effective', neutral: 'Slow', harmful: 'Costly' } as const;

interface Props {
  scenario: SimulationScenario;
  session: ExerciseSession;
  onDecide: (decisionId: string) => void;
  onLeave: () => void;
}

export function Rehearsal({ scenario, session, onDecide, onLeave }: Props) {
  const step = currentStep(scenario, session);
  const trail = decisionTrail(scenario, session);
  const last = trail.at(-1);
  const cited = last
    ? scenario.evidence.filter((e) => last.decision.consequence.evidenceIds.includes(e.id))
    : scenario.evidence.filter((e) => e.id === 'ev-runbook-step3' || e.id === 'ev-service');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const situationRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    situationRef.current?.focus();
  }, [step?.id]);

  return (
    <div className="rehearsal">
      <div className="rehearsal-bar">
        <span className="clock" aria-live="polite">
          <span className="clock-label">Simulated time</span>
          <span className="clock-value num">T+{session.elapsedMinutes} min</span>
        </span>
        <span className="rehearsal-count num">Decision {session.decisions.length + 1}</span>
        <span className="rehearsal-leave">
          {confirmLeave ? (
            <>
              <span>Discard this rehearsal?</span>
              <Button appearance="danger" onClick={onLeave}>
                Discard
              </Button>
              <Button appearance="subtle" onClick={() => setConfirmLeave(false)}>
                Keep going
              </Button>
            </>
          ) : (
            <Button appearance="subtle" onClick={() => setConfirmLeave(true)}>
              Leave rehearsal
            </Button>
          )}
        </span>
      </div>

      <div className="rehearsal-grid">
        <section className="rehearsal-rail region" aria-labelledby="rail-title">
          <h2 id="rail-title" className="section-title">
            Timeline
          </h2>
          <TimeRail scenario={scenario} session={session} />
        </section>

        <section className="rehearsal-stage" aria-labelledby="situation-title">
          {last ? (
            <div
              className={`consequence consequence-${last.decision.consequence.assessment}`}
              role="status"
            >
              <p className="consequence-head">
                <span>What happened: {last.decision.label}</span>
                <span className={`assessment assessment-${last.decision.consequence.assessment}`}>
                  {ASSESSMENT[last.decision.consequence.assessment]},{' '}
                  {last.decision.consequence.minutes} min
                </span>
              </p>
              <p>{last.decision.consequence.narrative}</p>
            </div>
          ) : null}
          {step ? (
            <>
              <h2 id="situation-title" className="situation-title" ref={situationRef} tabIndex={-1}>
                {step.title}
              </h2>
              <p className="situation">{step.situation}</p>
              <ul className="decisions" aria-label="Your options">
                {step.decisions.map((d) => (
                  <li key={d.id}>
                    <button type="button" className="decision" onClick={() => onDecide(d.id)}>
                      <span className="decision-label">{d.label}</span>
                      {d.detail ? <span className="decision-detail">{d.detail}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <aside className="rehearsal-side" aria-label="Objectives and evidence">
          <section className="region">
            <h2 className="section-title">Objectives</h2>
            <ObjectiveList scenario={scenario} session={session} />
          </section>
          <section className="region">
            <h2 className="section-title">{last ? 'Evidence for what happened' : 'On file'}</h2>
            <EvidenceList items={cited} />
          </section>
        </aside>
      </div>
    </div>
  );
}
