import { useEffect, useRef } from 'react';
import { Button } from '../Button';
import { StatusBadge, type StatusTone } from '../Badge';
import type { ChangeAnalysis } from '@shared/analysis/types';
import type { Consequence, EvidenceReference, SimulationScenario } from '@shared/domain/types';
import { decisionTrail } from '@shared/simulation/engine';
import type { CompletedExercise } from '../../lib/exercises';
import {
  makeDuplicateChecker,
  makeRemediationCreator,
  remediationCreateUiEnabled,
} from '../../lib/remediationCreator';
import { approvedFor, useFixApprovals } from '../../lib/fixApprovals';
import { EvidenceList } from './Evidence';
import { Correction, FixStateList, fixStates } from './FixReview';
import { RemediationPreview } from './RemediationPreview';
import { RETEST_OUTCOME, missedDeadlines } from './RunComparison';
import { RetestVerdict } from './RetestVerdict';
import { TimeRail } from './TimeRail';

const ASSESSMENT: Record<Consequence['assessment'], { label: string; tone: StatusTone }> = {
  effective: { label: 'Effective', tone: 'success' },
  neutral: { label: 'Slow', tone: 'warning' },
  harmful: { label: 'Costly', tone: 'danger' },
};

/** Each decision's evidence, with any reference already quoted earlier in the trail listed once. */
function evidenceByDecision(scenario: SimulationScenario, ids: string[][]) {
  const firstAt = new Map<string, number>();
  return ids.map((list, i) => {
    const fresh: EvidenceReference[] = [];
    const repeated: { evidence: EvidenceReference; at: number }[] = [];
    for (const id of list) {
      const evidence = scenario.evidence.find((e) => e.id === id);
      if (!evidence) continue;
      const seen = firstAt.get(id);
      if (seen === undefined) {
        firstAt.set(id, i);
        fresh.push(evidence);
      } else {
        repeated.push({ evidence, at: seen });
      }
    }
    return { fresh, repeated };
  });
}

export function Debrief({
  scenario,
  exercise,
  onRunAgain,
  onRetest,
  workItemSource,
}: {
  scenario: SimulationScenario;
  exercise: CompletedExercise;
  onRunAgain?: () => void;
  /** Offered only on a first run; a retest compares against its original. */
  onRetest?: (approvedRemediationIds: string[]) => void;
  /** The real finding behind a generated rehearsal; enables the work item preview. */
  workItemSource?: { analysis: ChangeAnalysis; findingId: string };
}) {
  const { evaluation, session } = exercise;
  const trail = decisionTrail(scenario, session);
  const evidence = evidenceByDecision(
    scenario,
    trail.map(({ decision }) => decision.consequence.evidenceIds),
  );
  const gapFound = session.flags.runbookGapIdentified !== undefined;
  const resultRef = useRef<HTMLHeadingElement>(null);
  const { approvals, setApproved } = useFixApprovals();
  const approved = approvedFor(approvals, session.id);
  const canRetest = onRetest !== undefined && exercise.retest === undefined;
  const applied = exercise.retest?.appliedRemediationIds ?? [];
  const objectiveLabels = Object.fromEntries(scenario.objectives.map((o) => [o.id, o.label]));
  const finding = workItemSource?.analysis.findings.find((f) => f.id === workItemSource.findingId);
  const missed = missedDeadlines(scenario, evaluation);
  const outcome = exercise.retest ? RETEST_OUTCOME[exercise.retest.comparison.outcome] : null;
  const effective = trail.filter((t) => t.decision.consequence.assessment === 'effective').length;
  const costly = trail.filter((t) => t.decision.consequence.assessment === 'harmful').length;

  // The control that opened the debrief (the last decision, or "Open report")
  // is gone once it renders, so move focus to the result instead of the page body.
  useEffect(() => {
    resultRef.current?.focus();
  }, []);

  const toggle = (id: string, on: boolean) =>
    setApproved(session.id, on ? [...approved, id] : approved.filter((x) => x !== id));

  const uncertainties = [
    'Times and outcomes are modelled by the scenario’s rules, not measured in a real outage.',
    ...(scenario.id.startsWith('rehearsal:')
      ? []
      : ['This is a synthetic demo scenario; it does not describe your own runbooks.']),
    ...(!exercise.retest && !gapFound
      ? ['The gap was not found in this run, so it does not show how quickly a team would spot it.']
      : []),
    ...(exercise.retest?.comparison.outcome === 'inconclusive'
      ? ['The retest avoided the step with the gap, so the fix was not exercised.']
      : []),
    'Fix approvals here are simulated and held in this tab only.',
  ];

  return (
    <div className="debrief report">
      <section className="report-summary" aria-labelledby="result-title">
        <h2 id="result-title" className="result-figure num" ref={resultRef} tabIndex={-1}>
          {evaluation.metCount} of {evaluation.totalCount} objectives met
        </h2>
        <dl className="report-stats">
          <div className="report-stat">
            <dt>Modelled time</dt>
            <dd className="num">{evaluation.elapsedMinutes} min</dd>
          </div>
          <div className="report-stat">
            <dt>Missed deadlines</dt>
            <dd className="num">{missed}</dd>
          </div>
          <div className="report-stat">
            <dt>Decisions</dt>
            <dd className="num">
              {trail.length}
              <span className="report-stat-note">
                {effective} effective, {costly} costly
              </span>
            </dd>
          </div>
          <div className="report-stat">
            <dt>Verdict</dt>
            <dd>
              {outcome ? (
                <StatusBadge
                  tone={
                    outcome.tone === 'met'
                      ? 'success'
                      : outcome.tone === 'missed'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {outcome.scoped}
                </StatusBadge>
              ) : gapFound ? (
                <StatusBadge tone="warning">Gap found</StatusBadge>
              ) : (
                <StatusBadge tone="danger">Gap not found</StatusBadge>
              )}
            </dd>
          </div>
        </dl>
        <ul className="report-objectives" aria-label="Objectives">
          {evaluation.objectives.map((o) => (
            <li key={o.objectiveId} className={`report-objective objective-${o.status}`}>
              <StatusBadge tone={o.status === 'met' ? 'success' : 'danger'}>
                {o.status === 'met' ? 'Met' : 'Missed'}
              </StatusBadge>
              <span className="report-objective-label">{o.label}</span>
              <span className="report-objective-why">{o.explanation}</span>
            </li>
          ))}
        </ul>
      </section>

      {exercise.retest ? (
        <RetestVerdict
          comparison={exercise.retest.comparison}
          original={exercise.retest.original}
          retest={exercise}
          objectiveLabels={objectiveLabels}
        />
      ) : null}

      <section className="region report-section" aria-labelledby="decisions-title">
        <h2 id="decisions-title" className="section-title">
          Decision timeline
        </h2>
        <ol className="trail report-trail">
          {trail.map(({ record, step, decision }, i) => {
            const a = ASSESSMENT[decision.consequence.assessment];
            const { fresh, repeated } = evidence[i]!;
            const count = fresh.length + repeated.length;
            return (
              <li
                key={`${record.stepId}-${record.decisionId}`}
                className={`trail-item trail-${decision.consequence.assessment}`}
              >
                <p className="trail-head">
                  <span className="num trail-time">T+{record.atMinute}</span>
                  <span className="trail-step">{step.title}</span>
                </p>
                <p className="trail-decision">
                  <span>{decision.label}</span> <StatusBadge tone={a.tone}>{a.label}</StatusBadge>
                </p>
                <p className="region-body">{decision.consequence.narrative}</p>
                {count > 0 ? (
                  <details className="trail-evidence">
                    <summary>
                      Evidence ({count}
                      {repeated.length > 0 ? `, ${repeated.length} cited above` : ''})
                    </summary>
                    <EvidenceList items={fresh} />
                    {repeated.length > 0 ? (
                      <p className="trail-repeat">
                        Also relies on{' '}
                        {repeated
                          .map(
                            ({ evidence: e, at }) =>
                              `${e.title} (quoted at T+${trail[at]!.record.atMinute})`,
                          )
                          .join('; ')}
                        .
                      </p>
                    ) : null}
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
        <details className="report-rail">
          <summary>Show the time rail</summary>
          <TimeRail scenario={scenario} session={session} />
        </details>
      </section>

      <section className="region report-section" aria-labelledby="gap-title">
        <h2 id="gap-title" className="section-title">
          Recovery gap
        </h2>
        <p className="region-body">
          {exercise.retest
            ? `This run replayed the outage against ${scenario.procedure.title} after the approved fixes.`
            : gapFound
              ? `You found the gap: ${scenario.procedure.title} still fails over to a provider that ${scenario.changeContext.key} retired.`
              : `The gap was not found during this run: ${scenario.procedure.title} still fails over to a provider that ${scenario.changeContext.key} retired.`}
        </p>
        {finding ? <Correction finding={finding} /> : null}
      </section>

      <section className="region report-section" aria-labelledby="fix-title">
        <h2 id="fix-title" className="section-title">
          {exercise.retest ? 'Fixes applied in this retest' : 'Recommended corrections'}
        </h2>
        <ul className="fixes">
          {scenario.remediation.map((r) => {
            const state = applied.includes(r.id)
              ? 'applied'
              : approved.includes(r.id)
                ? 'approved'
                : 'not-approved';
            return (
              <li key={r.id} className="fix">
                <div className="fix-main">
                  <p className="fix-title">{r.title}</p>
                  <p className="region-body">{r.description}</p>
                  {canRetest ? (
                    <label className="fix-approve">
                      <input
                        type="checkbox"
                        name="approve-fix"
                        value={r.id}
                        checked={approved.includes(r.id)}
                        onChange={(e) => toggle(r.id, e.target.checked)}
                      />
                      <span>Approve for the retest</span>
                    </label>
                  ) : null}
                </div>
                <FixStateList title={r.title} states={fixStates(state)} />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="region report-section" aria-labelledby="uncertain-title">
        <h2 id="uncertain-title" className="section-title">
          Uncertainties
        </h2>
        <ul className="report-list">
          {uncertainties.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </section>

      <section className="region report-section" aria-labelledby="next-title">
        <h2 id="next-title" className="section-title">
          Next actions
        </h2>
        <ul className="report-list">
          {canRetest ? (
            <li>Approve at least one correction above, then run a targeted retest.</li>
          ) : null}
          {exercise.retest?.comparison.outcome === 'resolved' ? (
            <li>
              Update {scenario.procedure.title} itself: the fix is applied only in the simulation.
            </li>
          ) : null}
          {exercise.retest && exercise.retest.comparison.outcome !== 'resolved' ? (
            <li>Choose a different correction and rehearse again.</li>
          ) : null}
          {workItemSource ? <li>Prepare the correction as a Jira work item below.</li> : null}
        </ul>
        {canRetest || onRunAgain ? (
          <div className="debrief-actions">
            {canRetest ? (
              <Button
                variant="primary"
                isDisabled={approved.length === 0}
                onClick={() => onRetest?.([...approved])}
              >
                Run targeted retest
              </Button>
            ) : null}
            {onRunAgain ? (
              <Button variant={canRetest ? 'secondary' : 'primary'} onClick={onRunAgain}>
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

      {workItemSource ? (
        <RemediationPreview
          analysis={workItemSource.analysis}
          findingId={workItemSource.findingId}
          fixes={scenario.remediation}
          defaultFixId={applied[0]}
          checker={makeDuplicateChecker({
            changeKey: workItemSource.analysis.change.key,
            findingId: workItemSource.findingId,
          })}
          creator={
            remediationCreateUiEnabled()
              ? makeRemediationCreator({
                  changeKey: workItemSource.analysis.change.key,
                  findingId: workItemSource.findingId,
                })
              : null
          }
          rehearsal={
            exercise.retest
              ? { comparison: exercise.retest.comparison, objectiveLabels }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
