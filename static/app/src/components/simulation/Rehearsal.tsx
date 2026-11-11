import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../Button';
import { StatusBadge, type StatusTone } from '../Badge';
import type { Consequence, ExerciseSession, SimulationScenario } from '@shared/domain/types';
import {
  applyDecision,
  currentStep,
  decisionTrail,
  objectiveProgress,
  startSession,
} from '@shared/simulation/engine';
import { useMedia } from '../../lib/useMedia';
import { EvidenceList } from './Evidence';
import { OBJECTIVE_LABEL, ObjectiveList, nextDeadline } from './Objectives';
import { TimeRail } from './TimeRail';

const ASSESSMENT = { effective: 'Effective', neutral: 'Slow', harmful: 'Costly' } as const;
const ASSESSMENT_TONE: Record<Consequence['assessment'], StatusTone> = {
  effective: 'success',
  neutral: 'warning',
  harmful: 'danger',
};

/** Matches the CSS breakpoint where the command layout stacks to one column. */
const STACKED = '(max-width: 60rem)';

interface Props {
  scenario: SimulationScenario;
  session: ExerciseSession;
  onDecide: (decisionId: string) => void;
  onLeave: () => void;
}

/** The session as it stood before its latest decision, replayed through the same engine. */
function previousSession(scenario: SimulationScenario, session: ExerciseSession) {
  if (session.decisions.length === 0) return null;
  let prev = startSession(scenario, session.id, session.startedAt);
  for (const d of session.decisions.slice(0, -1))
    prev = applyDecision(scenario, prev, d.decisionId);
  return prev;
}

/**
 * A side panel: a titled region on wide screens, a disclosure when stacked so
 * the situation and decisions come first on a phone.
 */
function Panel({
  id,
  title,
  meta,
  stacked,
  className,
  children,
}: {
  id: string;
  title: string;
  meta: string;
  stacked: boolean;
  className: string;
  children: ReactNode;
}) {
  if (stacked) {
    return (
      <details className={`region panel-disclosure ${className}`}>
        <summary>
          <span className="panel-title">{title}</span>
          <span className="panel-meta">{meta}</span>
        </summary>
        <div className="panel-body">{children}</div>
      </details>
    );
  }
  return (
    <section className={`region ${className}`} aria-labelledby={id}>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Rehearsal({ scenario, session, onDecide, onLeave }: Props) {
  const stacked = useMedia(STACKED);
  const step = currentStep(scenario, session);
  const trail = decisionTrail(scenario, session);
  const last = trail.at(-1);
  const why = last
    ? scenario.evidence.filter((e) => last.decision.consequence.evidenceIds.includes(e.id))
    : [];
  const onFile = [
    scenario.evidence.find((e) => e.kind === 'runbook-step' && e.excerpt),
    scenario.evidence.find((e) => e.kind === 'jsm-service'),
  ].filter((e) => e !== undefined);
  const prev = useMemo(() => previousSession(scenario, session), [scenario, session]);
  const changed = prev
    ? scenario.objectives.flatMap((o) => {
        const before = objectiveProgress(o, prev);
        const after = objectiveProgress(o, session);
        return before === after ? [] : [{ id: o.id, label: o.label, after }];
      })
    : [];
  const met = scenario.objectives.filter((o) => objectiveProgress(o, session) === 'met').length;
  const deadline = nextDeadline(scenario, session);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const situationRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    situationRef.current?.focus();
  }, [step?.id]);

  return (
    <div className="rehearsal">
      <div className="rehearsal-bar">
        {/* Not a live region: each decision is announced once, by the consequence status below. */}
        <span className="clock">
          <span className="clock-label">Simulated time</span>
          <span className="clock-value num" key={session.elapsedMinutes}>
            T+{session.elapsedMinutes} min
          </span>
        </span>
        <span className="rehearsal-count num">Decision {session.decisions.length + 1}</span>
        {deadline ? (
          <span className="rehearsal-deadline">
            Next deadline <span className="num">T+{deadline.minutes}</span>
          </span>
        ) : null}
        <span className="rehearsal-leave">
          {confirmLeave ? (
            <>
              <span>Discard this rehearsal?</span>
              <Button variant="danger" onClick={onLeave}>
                Discard
              </Button>
              <Button variant="subtle" onClick={() => setConfirmLeave(false)}>
                Keep going
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirmLeave(true)}>Leave rehearsal</Button>
          )}
        </span>
      </div>

      <div className="rehearsal-grid">
        <section className="rehearsal-stage" aria-labelledby="situation-title">
          <div className={last ? 'outcome' : 'outcome-empty'}>
            {/* Always mounted so screen readers announce each new consequence, once. */}
            <div role="status" aria-live="polite" className="consequence-region">
              {last ? (
                <div
                  key={session.decisions.length}
                  className={`consequence consequence-${last.decision.consequence.assessment}`}
                >
                  <p className="consequence-head">
                    <span>What happened: {last.decision.label}</span>
                  </p>
                  <p className="consequence-meta">
                    <StatusBadge tone={ASSESSMENT_TONE[last.decision.consequence.assessment]}>
                      {ASSESSMENT[last.decision.consequence.assessment]}
                    </StatusBadge>
                    <span className="num">
                      Took {last.decision.consequence.minutes} min, clock now T+
                      {session.elapsedMinutes}
                    </span>
                    <span className="consequence-modelled">Modelled result</span>
                  </p>
                  <p>{last.decision.consequence.narrative}</p>
                  {changed.length ? (
                    <ul className="consequence-objectives" aria-label="Objective updates">
                      {changed.map((c) => (
                        <li key={c.id}>
                          {c.label}: {OBJECTIVE_LABEL[c.after]}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="consequence-quiet">No objective changed.</p>
                  )}
                </div>
              ) : null}
            </div>
            {why.length ? (
              <div className="outcome-why" key={`why${session.decisions.length}`}>
                <h3 className="outcome-why-title">Why, from the evidence</h3>
                <EvidenceList items={why} />
              </div>
            ) : null}
          </div>
          {step ? (
            <div className="situation-block" key={step.id}>
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
            </div>
          ) : null}
        </section>

        <Panel
          id="rail-title"
          title="Timeline"
          meta={`T+${session.elapsedMinutes} min, ${session.decisions.length} logged`}
          stacked={stacked}
          className="rehearsal-rail"
        >
          <TimeRail scenario={scenario} session={session} />
        </Panel>

        <aside className="rehearsal-side" aria-label="Objectives and evidence">
          <Panel
            id="objectives-title"
            title="Objectives"
            meta={`${met} of ${scenario.objectives.length} met`}
            stacked={stacked}
            className="rehearsal-objectives"
          >
            <ObjectiveList scenario={scenario} session={session} />
          </Panel>
          <Panel
            id="evidence-title"
            title="On file"
            meta={`${onFile.length} sources`}
            stacked={stacked}
            className="rehearsal-evidence"
          >
            <EvidenceList items={onFile} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
