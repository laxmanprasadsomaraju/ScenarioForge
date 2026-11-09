import { useEffect, useRef, useState } from 'react';
import Button from '@atlaskit/button/new';
import type { SimulationScenario } from '@shared/domain/types';
import { decisionTrail } from '@shared/simulation/engine';
import type { CompletedExercise } from '../../lib/exercises';
import { EvidenceList } from './Evidence';
import { RetestVerdict } from './RetestVerdict';
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
  onRetest,
}: {
  scenario: SimulationScenario;
  exercise: CompletedExercise;
  onRunAgain?: () => void;
  /** Offered only on a first run; a retest compares against its original. */
  onRetest?: (approvedRemediationIds: string[]) => void;
}) {
  const { evaluation, session } = exercise;
  const trail = decisionTrail(scenario, session);
  const gapFound = session.flags.runbookGapIdentified !== undefined;
  const resultRef = useRef<HTMLHeadingElement>(null);
  const [approved, setApproved] = useState<string[]>([]);
  const canRetest = onRetest !== undefined && exercise.retest === undefined;
  const applied = exercise.retest?.appliedRemediationIds ?? [];
  const objectiveLabels = Object.fromEntries(scenario.objectives.map((o) => [o.id, o.label]));

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

      {exercise.retest ? (
        <RetestVerdict comparison={exercise.retest.comparison} objectiveLabels={objectiveLabels} />
      ) : null}

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
          {exercise.retest ? 'Fixes applied in this retest' : 'Recovery gap and proposed fixes'}
        </h2>
        <p className="region-body">
          {exercise.retest
            ? `This run replayed the outage against ${scenario.procedure.title} after the approved fixes.`
            : gapFound
              ? `You found the gap: ${scenario.procedure.title} still fails over to a provider that ${scenario.changeContext.key} retired.`
              : `The gap was not found during this run: ${scenario.procedure.title} still fails over to a provider that ${scenario.changeContext.key} retired.`}
        </p>
        <ul className="fixes">
          {scenario.remediation.map((r) => (
            <li key={r.id} className="fix">
              <p className="fix-title">{r.title}</p>
              <p className="region-body">{r.description}</p>
              {canRetest ? (
                <label className="fix-approve">
                  <input
                    type="checkbox"
                    name="approve-fix"
                    value={r.id}
                    checked={approved.includes(r.id)}
                    onChange={(e) =>
                      setApproved((ids) =>
                        e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id),
                      )
                    }
                  />
                  <span>Approve for the retest</span>
                </label>
              ) : null}
              <p className="fix-status">
                {applied.includes(r.id)
                  ? 'Applied in this retest (demo approval).'
                  : 'Proposed. Creating Jira work items with your approval arrives in M8.'}
              </p>
            </li>
          ))}
        </ul>
        {canRetest || onRunAgain ? (
          <div className="debrief-actions">
            {canRetest ? (
              <Button
                appearance="primary"
                isDisabled={approved.length === 0}
                onClick={() => onRetest?.(approved)}
              >
                Run targeted retest
              </Button>
            ) : null}
            {onRunAgain ? (
              <Button appearance={canRetest ? 'default' : 'primary'} onClick={onRunAgain}>
                Rehearse again
              </Button>
            ) : null}
            {canRetest ? (
              <span className="region-body">
                {approved.length === 0
                  ? 'Approve at least one fix to retest the gap. Approval here is a demo step and creates nothing in Jira.'
                  : 'The retest replays this outage against the corrected plan and checks whether the gap is closed.'}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
