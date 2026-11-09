import { useEffect, useRef } from 'react';
import Button from '@atlaskit/button/new';
import type { SimulationScenario } from '@shared/domain/types';
import { decisionTrail } from '@shared/simulation/engine';
import type { CompletedExercise } from '../../lib/exercises';
import { EvidenceList } from './Evidence';
import { TimeRail } from './TimeRail';

const ASSESSMENT: Record<string, string> = {
  effective: 'Effective',
  neutral: 'Slow',
  harmful: 'Costly',
};

export function Debrief({
  scenario,
  exercise,
  onRunAgain,
}: {
  scenario: SimulationScenario;
  exercise: CompletedExercise;
  onRunAgain?: () => void;
}) {
  const { evaluation, session } = exercise;
  const trail = decisionTrail(scenario, session);
  const gapFound = session.flags.runbookGapIdentified !== undefined;
  const resultRef = useRef<HTMLHeadingElement>(null);

  // The control that opened the debrief (the last decision, or "Open report")
  // is gone once it renders, so move focus to the result instead of the page body.
  useEffect(() => {
    resultRef.current?.focus();
  }, []);

  return (
    <div className="debrief">
      <section className="debrief-result" aria-labelledby="result-title">
        <h2 id="result-title" className="result-figure num" ref={resultRef} tabIndex={-1}>
          {evaluation.metCount} of {evaluation.totalCount} objectives met
        </h2>
        <p className="result-sub num">
          Simulated recovery time {evaluation.elapsedMinutes} minutes
        </p>
      </section>

      <div className="debrief-grid">
        <section className="region" aria-labelledby="obj-title">
          <h2 id="obj-title" className="section-title">
            Objectives
          </h2>
          <ul className="objectives objectives-final">
            {evaluation.objectives.map((o) => (
              <li key={o.objectiveId} className={`objective objective-${o.status}`}>
                <span className="objective-label">{o.label}</span>
                <span className="objective-state">{o.status === 'met' ? 'Met' : 'Missed'}</span>
                <span className="objective-why">{o.explanation}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="region" aria-labelledby="tl-title">
          <h2 id="tl-title" className="section-title">
            Timeline
          </h2>
          <TimeRail scenario={scenario} session={session} />
        </section>
      </div>

      <section className="region" aria-labelledby="decisions-title">
        <h2 id="decisions-title" className="section-title">
          Decisions and their evidence
        </h2>
        <ol className="trail">
          {trail.map(({ record, step, decision }) => (
            <li key={`${record.stepId}-${record.decisionId}`} className="trail-item">
              <p className="trail-head">
                <span className="num trail-time">T+{record.atMinute}</span>
                <span className="trail-step">{step.title}</span>
              </p>
              <p className="trail-decision">
                {decision.label}{' '}
                <span className={`assessment assessment-${decision.consequence.assessment}`}>
                  {ASSESSMENT[decision.consequence.assessment]}
                </span>
              </p>
              <p className="region-body">{decision.consequence.narrative}</p>
              <EvidenceList
                items={scenario.evidence.filter((e) =>
                  decision.consequence.evidenceIds.includes(e.id),
                )}
              />
            </li>
          ))}
        </ol>
      </section>

      <section className="region" aria-labelledby="fix-title">
        <h2 id="fix-title" className="section-title">
          Recovery gap and proposed fixes
        </h2>
        <p className="region-body">
          {gapFound
            ? `You found the gap: ${scenario.procedure.title} still fails over to a provider that ${scenario.changeContext.key} retired.`
            : `The gap was not found during this run: ${scenario.procedure.title} still fails over to a provider that ${scenario.changeContext.key} retired.`}
        </p>
        <ul className="fixes">
          {scenario.remediation.map((r) => (
            <li key={r.id} className="fix">
              <p className="fix-title">{r.title}</p>
              <p className="region-body">{r.description}</p>
              <p className="fix-status">
                Proposed. Creating Jira work items with your approval arrives in M8.
              </p>
            </li>
          ))}
        </ul>
        {onRunAgain ? (
          <div className="debrief-actions">
            <Button appearance="primary" onClick={onRunAgain}>
              Rehearse again
            </Button>
            <span className="region-body">
              A targeted retest after the runbook is fixed arrives in M8.
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
