import { useState } from 'react';
import type { ExerciseSession, SimulationScenario } from '@shared/domain/types';
import { applyDecision, evaluateSession, startSession } from '@shared/simulation/engine';
import { buildRetest, compareRetest } from '@shared/simulation/retest';
import { authBackupRetiredScenario } from '@shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation as remediationModel } from '@shared/simulation/scenarios/authBackupRetiredRemediation';
import { useExercises, type CompletedExercise } from '../lib/exercises';
import { OriginTag } from '../components/OriginTag';
import { PageHeader } from '../components/Shell';
import { Briefing } from '../components/simulation/Briefing';
import { Debrief } from '../components/simulation/Debrief';
import { Rehearsal } from '../components/simulation/Rehearsal';

/** The run a retest is compared against, plus the fixes approved for it. */
interface RetestOf {
  original: CompletedExercise;
  appliedRemediationIds: string[];
}

type Phase =
  | { kind: 'briefing'; returned?: boolean }
  | {
      kind: 'running';
      scenario: SimulationScenario;
      session: ExerciseSession;
      retestOf?: RetestOf;
    }
  | { kind: 'debrief'; exercise: CompletedExercise };

function newId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now().toString(36)}`;
}

export function SimulationsPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'briefing' });
  const { record } = useExercises();

  const run = (scenario: SimulationScenario, retestOf?: RetestOf) =>
    setPhase({
      kind: 'running',
      scenario,
      session: startSession(scenario, newId('session'), new Date().toISOString()),
      retestOf,
    });

  const start = () => run(authBackupRetiredScenario);

  // Fixes are approved inside this demo only; no Jira work item is created.
  const retest = (original: CompletedExercise, approvedIds: string[]) => {
    const scenario = buildRetest(
      original.scenario,
      original.session,
      approvedIds,
      remediationModel,
    );
    run(scenario, { original, appliedRemediationIds: approvedIds });
  };

  const decide = (
    scenario: SimulationScenario,
    session: ExerciseSession,
    decisionId: string,
    retestOf?: RetestOf,
  ) => {
    const next = applyDecision(scenario, session, decisionId);
    if (next.status !== 'completed') {
      setPhase({ kind: 'running', scenario, session: next, retestOf });
      return;
    }
    const exercise: CompletedExercise = {
      scenario,
      session: next,
      evaluation: evaluateSession(scenario, next),
      completedAt: new Date().toISOString(),
    };
    if (retestOf) {
      exercise.retest = {
        appliedRemediationIds: retestOf.appliedRemediationIds,
        original: retestOf.original,
        comparison: compareRetest(retestOf.original, exercise, remediationModel, {
          id: newId('retest'),
          comparedAt: exercise.completedAt,
        }),
      };
    }
    record(exercise);
    setPhase({ kind: 'debrief', exercise });
  };

  const retesting = phase.kind === 'running' && phase.retestOf !== undefined;
  const title =
    phase.kind === 'debrief'
      ? phase.exercise.retest
        ? 'Retest report'
        : 'After-action report'
      : retesting
        ? 'Targeted retest'
        : 'Recovery rehearsal';

  return (
    <>
      <PageHeader
        title={title}
        lead={
          phase.kind === 'briefing'
            ? 'A short outage, played on a simulated clock, built from one change.'
            : authBackupRetiredScenario.title
        }
        aside={<OriginTag origin="demo" />}
      />
      <p className="demo-note">
        Synthetic scenario. It does not read your Jira, Confluence or service data yet; live
        evidence arrives in M2 and M3.
      </p>
      {phase.kind === 'briefing' ? (
        <Briefing
          scenario={authBackupRetiredScenario}
          onStart={start}
          focusOnMount={phase.returned}
        />
      ) : null}
      {phase.kind === 'running' ? (
        <>
          {phase.retestOf ? (
            <p className="retest-note" role="note">
              Retest of your earlier run with {phase.retestOf.appliedRemediationIds.length} approved{' '}
              {phase.retestOf.appliedRemediationIds.length === 1 ? 'fix' : 'fixes'} applied. The
              same outage replays against the corrected recovery plan.
            </p>
          ) : null}
          <Rehearsal
            scenario={phase.scenario}
            session={phase.session}
            onDecide={(id) => decide(phase.scenario, phase.session, id, phase.retestOf)}
            onLeave={() => setPhase({ kind: 'briefing', returned: true })}
          />
        </>
      ) : null}
      {phase.kind === 'debrief' ? (
        <Debrief
          scenario={phase.exercise.scenario}
          exercise={phase.exercise}
          onRunAgain={start}
          onRetest={(ids) => retest(phase.exercise, ids)}
        />
      ) : null}
    </>
  );
}
