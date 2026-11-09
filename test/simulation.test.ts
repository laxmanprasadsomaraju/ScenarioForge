import { describe, expect, it } from 'vitest';
import {
  applyDecision,
  currentStep,
  decisionTrail,
  evaluateSession,
  objectiveProgress,
  SimulationError,
  startSession,
  validateScenario,
} from '../shared/simulation/engine';
import { authBackupRetiredScenario as scenario } from '../shared/simulation/scenarios/authBackupRetired';

const START = '2026-11-09T10:00:00.000Z';

function play(decisions: string[]) {
  let session = startSession(scenario, 'session-1', START);
  for (const id of decisions) {
    session = applyDecision(scenario, session, id);
  }
  return session;
}

function statuses(decisions: string[]) {
  const evaluation = evaluateSession(scenario, play(decisions));
  return Object.fromEntries(evaluation.objectives.map((o) => [o.objectiveId, o.status]));
}

describe('auth backup retired demo scenario', () => {
  it('is structurally valid and marked as demo data', () => {
    expect(validateScenario(scenario)).toEqual([]);
    expect(scenario.origin).toBe('demo');
    expect(scenario.evidence.every((e) => e.origin === 'demo')).toBe(true);
  });

  it('meets every objective on the evidence-led path', () => {
    const session = play(['check-changes', 'notify-now', 'activate-nimbus']);
    expect(session.status).toBe('completed');
    expect(session.elapsedMinutes).toBe(16);
    const evaluation = evaluateSession(scenario, session);
    expect(evaluation.metCount).toBe(4);
    expect(evaluation.totalCount).toBe(4);
  });

  it('penalises following the stale runbook with late communication', () => {
    expect(statuses(['follow-runbook', 'inspect-change', 'notify-now', 'activate-nimbus'])).toEqual(
      {
        'obj-restore': 'met',
        'obj-notify': 'missed',
        'obj-gap': 'met',
        'obj-security': 'met',
      },
    );
  });

  it('routes to the uninformed recovery step when the gap is still unknown', () => {
    const session = play(['follow-runbook', 'retry-failover', 'notify-now']);
    expect(currentStep(scenario, session)?.id).toBe('recover-uninformed');
    const finished = applyDecision(
      scenario,
      applyDecision(scenario, session, 'investigate-failover'),
      'activate-nimbus',
    );
    expect(finished.elapsedMinutes).toBe(37);
    expect(evaluateSession(scenario, finished).metCount).toBe(2); // gap found + SSO kept
  });

  it('explains a late objective without calling it on time', () => {
    const evaluation = evaluateSession(
      scenario,
      play(['follow-runbook', 'inspect-change', 'notify-now', 'activate-nimbus']),
    );
    const notify = evaluation.objectives.find((o) => o.objectiveId === 'obj-notify')!;
    expect(notify).toMatchObject({
      status: 'missed',
      explanation: 'Achieved late, at T+18 min (target: within 15 min).',
    });
  });

  it('records a security violation when SSO is bypassed', () => {
    const result = statuses([
      'bypass-sso',
      'notify-now',
      'investigate-failover',
      'activate-nimbus',
    ]);
    expect(result['obj-security']).toBe('missed');
  });

  it('requires at least three decisions to complete any path', () => {
    const shortest = play(['check-changes', 'defer-comms', 'wait-primary']);
    expect(shortest.status).toBe('completed');
    expect(shortest.decisions).toHaveLength(3);
    expect(statuses(['check-changes', 'defer-comms', 'wait-primary'])['obj-restore']).toBe(
      'missed',
    );
  });

  it('is deterministic for the same decisions', () => {
    const path = ['follow-runbook', 'escalate-vendor', 'defer-comms', 'emergency-bypass'];
    expect(play(path)).toEqual(play(path));
    expect(evaluateSession(scenario, play(path))).toEqual(evaluateSession(scenario, play(path)));
  });

  it('keeps the first time a flag was set', () => {
    const session = play(['bypass-sso', 'notify-now', 'emergency-bypass-uninformed']);
    expect(session.flags.securityBypassed).toBe(4);
  });

  it('does not mutate the previous session', () => {
    const first = startSession(scenario, 's', START);
    applyDecision(scenario, first, 'check-changes');
    expect(first.decisions).toEqual([]);
    expect(first.elapsedMinutes).toBe(0);
  });

  it('rejects decisions that are not offered at the current step', () => {
    const session = startSession(scenario, 's', START);
    expect(() => applyDecision(scenario, session, 'activate-nimbus')).toThrow(SimulationError);
  });

  it('rejects decisions after completion and evaluation before completion', () => {
    const done = play(['check-changes', 'notify-now', 'activate-nimbus']);
    expect(() => applyDecision(scenario, done, 'notify-now')).toThrow(SimulationError);
    expect(() => evaluateSession(scenario, play(['check-changes']))).toThrow(SimulationError);
  });

  it('rejects sessions from another scenario version', () => {
    const session = { ...startSession(scenario, 's', START), scenarioVersion: 99 };
    expect(() => applyDecision(scenario, session, 'check-changes')).toThrow(SimulationError);
  });

  it('builds a decision trail with evidence for the debrief', () => {
    const trail = decisionTrail(scenario, play(['check-changes', 'notify-now', 'activate-nimbus']));
    expect(trail.map((t) => t.decision.id)).toEqual([
      'check-changes',
      'notify-now',
      'activate-nimbus',
    ]);
    expect(trail.map((t) => t.record.atMinute)).toEqual([0, 5, 8]);
  });

  it('detects broken scenario references', () => {
    const broken = structuredClone(scenario);
    broken.steps.detect!.decisions[0]!.next = 'missing-step';
    broken.steps.detect!.decisions[1]!.consequence.evidenceIds = ['ev-missing'];
    expect(validateScenario(broken)).toEqual([
      'decision follow-runbook points to missing step missing-step',
      'decision check-changes cites missing evidence ev-missing',
    ]);
  });

  it('tracks objective progress without optimistic passes', () => {
    const byId = (id: string) => scenario.objectives.find((o) => o.id === id)!;
    const start = startSession(scenario, 's', START);
    expect(scenario.objectives.map((o) => objectiveProgress(o, start))).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    const late = play(['follow-runbook', 'retry-failover']);
    expect(objectiveProgress(byId('obj-notify'), late)).toBe('missed');
    expect(objectiveProgress(byId('obj-restore'), late)).toBe('pending');
    const bypassed = play(['bypass-sso']);
    expect(objectiveProgress(byId('obj-security'), bypassed)).toBe('missed');
    const done = play(['check-changes', 'notify-now', 'activate-nimbus']);
    expect(scenario.objectives.map((o) => objectiveProgress(o, done))).toEqual([
      'met',
      'met',
      'met',
      'met',
    ]);
  });
});
