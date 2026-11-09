import { useState } from 'react';
import type { ExerciseSession } from '@shared/domain/types';
import { applyDecision, evaluateSession, startSession } from '@shared/simulation/engine';
import { authBackupRetiredScenario as scenario } from '@shared/simulation/scenarios/authBackupRetired';
import { useExercises, type CompletedExercise } from '../lib/exercises';
import { OriginTag } from '../components/OriginTag';
import { PageHeader } from '../components/Shell';
import { Briefing } from '../components/simulation/Briefing';
import { Debrief } from '../components/simulation/Debrief';
import { Rehearsal } from '../components/simulation/Rehearsal';

type Phase =
  | { kind: 'briefing' }
  | { kind: 'running'; session: ExerciseSession }
  | { kind: 'debrief'; exercise: CompletedExercise };

function newSessionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session-${Date.now().toString(36)}`;
}

export function SimulationsPage() {
  const [phase, setPhase] = useState<Phase>({ kind: 'briefing' });
  const { record } = useExercises();

  const start = () =>
    setPhase({
      kind: 'running',
      session: startSession(scenario, newSessionId(), new Date().toISOString()),
    });

  const decide = (session: ExerciseSession, decisionId: string) => {
    const next = applyDecision(scenario, session, decisionId);
    if (next.status === 'completed') {
      const exercise = {
        session: next,
        evaluation: evaluateSession(scenario, next),
        completedAt: new Date().toISOString(),
      };
      record(exercise);
      setPhase({ kind: 'debrief', exercise });
    } else {
      setPhase({ kind: 'running', session: next });
    }
  };

  return (
    <>
      <PageHeader
        title={phase.kind === 'debrief' ? 'After-action report' : 'Recovery rehearsal'}
        lead={
          phase.kind === 'briefing'
            ? 'A short outage, played on a simulated clock, built from one change.'
            : scenario.title
        }
        aside={<OriginTag origin="demo" />}
      />
      <p className="demo-note">
        Synthetic scenario. It does not read your Jira, Confluence or service data yet; live
        evidence arrives in M2 and M3.
      </p>
      {phase.kind === 'briefing' ? <Briefing scenario={scenario} onStart={start} /> : null}
      {phase.kind === 'running' ? (
        <Rehearsal
          scenario={scenario}
          session={phase.session}
          onDecide={(id) => decide(phase.session, id)}
          onLeave={() => setPhase({ kind: 'briefing' })}
        />
      ) : null}
      {phase.kind === 'debrief' ? (
        <Debrief scenario={scenario} exercise={phase.exercise} onRunAgain={start} />
      ) : null}
    </>
  );
}
