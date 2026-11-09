import { describe, expect, it } from 'vitest';
import { evaluateSession, SimulationError } from '../shared/simulation/engine';
import { replaySession } from '../shared/simulation/replay';
import { authBackupRetiredScenario as scenario } from '../shared/simulation/scenarios/authBackupRetired';
import { scoreSession } from '../shared/simulation/scoring';

const START = '2026-11-09T10:00:00.000Z';

function score(decisions: string[]) {
  return scoreSession(scenario, replaySession(scenario, decisions, 's', START));
}

describe('session scoring detail', () => {
  it('reports time to spare on the evidence-led path', () => {
    const result = score(['check-changes', 'notify-now', 'activate-nimbus']);
    expect(
      result.objectives.map((o) => [o.objectiveId, o.minutesToSpare, o.minutesOverTarget]),
    ).toEqual([
      ['obj-restore', 14, 0],
      ['obj-notify', 7, 0],
      ['obj-gap', null, null],
      ['obj-security', null, null],
    ]);
    expect(result).toMatchObject({
      metCount: 4,
      totalCount: 4,
      elapsedMinutes: 16,
      totalMinutesOverTarget: 0,
      deadlinesNeverReached: 0,
      decisionAssessments: { effective: 3, neutral: 0, harmful: 0 },
    });
  });

  it('reports how late a missed deadline was', () => {
    const result = score(['follow-runbook', 'inspect-change', 'notify-now', 'activate-nimbus']);
    const notify = result.objectives.find((o) => o.objectiveId === 'obj-notify')!;
    expect(notify).toEqual({
      objectiveId: 'obj-notify',
      label: 'Notify stakeholders within 15 minutes',
      status: 'missed',
      ruleKind: 'flagSetWithin',
      flag: 'stakeholdersNotified',
      flagSetAt: 18,
      targetMinutes: 15,
      minutesOverTarget: 3,
      minutesToSpare: null,
    });
    expect(result.totalMinutesOverTarget).toBe(3);
    expect(result.decisionAssessments).toEqual({ effective: 3, neutral: 0, harmful: 1 });
  });

  it('keeps lateness unknown when a deadline was never reached', () => {
    const result = score(['check-changes', 'defer-comms', 'wait-primary']);
    const notify = result.objectives.find((o) => o.objectiveId === 'obj-notify')!;
    expect(notify).toMatchObject({
      flagSetAt: null,
      minutesOverTarget: null,
      minutesToSpare: null,
    });
    const restore = result.objectives.find((o) => o.objectiveId === 'obj-restore')!;
    expect(restore).toMatchObject({ flagSetAt: 40, minutesOverTarget: 10 });
    expect(result.deadlinesNeverReached).toBe(1);
    expect(result.totalMinutesOverTarget).toBe(10);
  });

  it('agrees with evaluateSession on every status', () => {
    const session = replaySession(
      scenario,
      ['bypass-sso', 'notify-now', 'investigate-failover', 'activate-nimbus'],
      's',
      START,
    );
    const statuses = scoreSession(scenario, session).objectives.map((o) => o.status);
    expect(statuses).toEqual(evaluateSession(scenario, session).objectives.map((o) => o.status));
  });

  it('only scores completed sessions', () => {
    expect(() => score(['check-changes'])).toThrow(SimulationError);
  });
});
