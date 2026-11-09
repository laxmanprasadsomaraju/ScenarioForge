import { describe, expect, it } from 'vitest';
import type { SimulationScenario } from '../shared/domain/types';
import {
  applyDecision,
  evaluateSession,
  SimulationError,
  startSession,
} from '../shared/simulation/engine';
import { applyRemediations } from '../shared/simulation/remediation';
import {
  canonicalJson,
  createAuditRecord,
  replaySession,
  scenarioFingerprint,
  verifyAuditRecord,
} from '../shared/simulation/replay';
import { authBackupRetiredScenario as scenario } from '../shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation as model } from '../shared/simulation/scenarios/authBackupRetiredRemediation';
import type { SessionAuditRecord } from '../shared/simulation/types';

const START = '2026-11-09T10:00:00.000Z';
const OPTIMAL = ['check-changes', 'notify-now', 'activate-nimbus'];
const remediated = applyRemediations(scenario, model, ['rem-runbook']);

/** Every complete decision path through a scenario, by depth-first search. */
function allPaths(s: SimulationScenario): string[][] {
  const paths: string[][] = [];
  const walk = (decisions: string[]) => {
    const session = replaySession(s, decisions, 'walk', START);
    if (session.status === 'completed') {
      paths.push(decisions);
      return;
    }
    for (const d of s.steps[session.currentStepId!]!.decisions) walk([...decisions, d.id]);
  };
  walk([]);
  return paths;
}

function record(decisions: string[], s: SimulationScenario = scenario): SessionAuditRecord {
  return createAuditRecord(s, replaySession(s, decisions, 'session-1', START));
}

function tamper(mutate: (r: SessionAuditRecord) => void): SessionAuditRecord {
  const copy = structuredClone(record(OPTIMAL));
  mutate(copy);
  return copy;
}

describe('replaySession', () => {
  it('reproduces a session decision by decision', () => {
    let manual = startSession(scenario, 'session-1', START);
    for (const id of OPTIMAL) manual = applyDecision(scenario, manual, id);
    expect(replaySession(scenario, OPTIMAL, 'session-1', START)).toEqual(manual);
  });

  it.each([
    { name: 'original', s: scenario },
    { name: 'remediated', s: remediated },
  ])('replays and verifies every complete path in the $name scenario', ({ s }) => {
    const paths = allPaths(s);
    expect(paths.length).toBeGreaterThan(10);
    for (const path of paths) {
      const session = replaySession(s, path, 'p', START);
      expect(replaySession(s, path, 'p', START)).toEqual(session);
      const audit = createAuditRecord(s, session);
      expect(verifyAuditRecord(audit, s)).toEqual({ ok: true });
    }
  });

  it('rejects decision sequences the engine would refuse', () => {
    expect(() => replaySession(scenario, ['activate-nimbus'], 's', START)).toThrow(SimulationError);
    expect(() => replaySession(scenario, [...OPTIMAL, 'notify-now'], 's', START)).toThrow(
      SimulationError,
    );
  });
});

describe('audit records', () => {
  it('captures scenario identity, decisions, flags and evaluation', () => {
    const audit = record(OPTIMAL);
    const session = replaySession(scenario, OPTIMAL, 'session-1', START);
    expect(audit).toEqual({
      schemaVersion: 1,
      sessionId: 'session-1',
      scenarioId: 'demo-auth-backup-retired',
      scenarioVersion: 1,
      scenarioFingerprint: scenarioFingerprint(scenario),
      origin: 'demo',
      startedAt: START,
      status: 'completed',
      elapsedMinutes: 16,
      decisions: session.decisions,
      flags: { runbookGapIdentified: 5, stakeholdersNotified: 8, loginRestored: 16 },
      evaluation: evaluateSession(scenario, session),
    });
  });

  it('survives a JSON round trip', () => {
    const stored = JSON.parse(JSON.stringify(record(OPTIMAL))) as SessionAuditRecord;
    expect(verifyAuditRecord(stored, scenario)).toEqual({ ok: true });
  });

  it('records in-progress sessions without an evaluation', () => {
    const audit = record(['follow-runbook']);
    expect(audit.status).toBe('in-progress');
    expect(audit.evaluation).toBeNull();
    expect(verifyAuditRecord(audit, scenario)).toEqual({ ok: true });
  });

  it('does not share state with the session it was built from', () => {
    const session = replaySession(scenario, OPTIMAL, 'session-1', START);
    const before = structuredClone(session);
    const audit = createAuditRecord(scenario, session);
    audit.decisions[0]!.atMinute = 99;
    audit.flags.loginRestored = 99;
    expect(session).toEqual(before);
  });

  it('refuses to record a session that its own replay contradicts', () => {
    const session = replaySession(scenario, OPTIMAL, 'session-1', START);
    expect(() =>
      createAuditRecord(scenario, { ...session, flags: { ...session.flags, loginRestored: 1 } }),
    ).toThrow('Session session-1 does not match its own replay.');
    expect(() => createAuditRecord(remediated, session)).toThrow(SimulationError);
  });

  it.each([
    {
      name: 'flag minute',
      mutate: (r: SessionAuditRecord) => (r.flags.loginRestored = 12),
      problem: 'flags does not match the replay',
    },
    {
      name: 'added flag',
      mutate: (r: SessionAuditRecord) => (r.flags.securityBypassed = 3),
      problem: 'flags does not match the replay',
    },
    {
      name: 'elapsed time',
      mutate: (r: SessionAuditRecord) => (r.elapsedMinutes = 10),
      problem: 'elapsedMinutes does not match the replay',
    },
    {
      name: 'decision minute',
      mutate: (r: SessionAuditRecord) => (r.decisions[2]!.atMinute = 1),
      problem: 'decisions does not match the replay',
    },
    {
      name: 'decision step',
      mutate: (r: SessionAuditRecord) => (r.decisions[1]!.stepId = 'recover'),
      problem: 'decisions does not match the replay',
    },
    {
      name: 'evaluation score',
      mutate: (r: SessionAuditRecord) => (r.evaluation!.metCount = 3),
      problem: 'evaluation does not match the replay',
    },
    {
      name: 'objective status',
      mutate: (r: SessionAuditRecord) => (r.evaluation!.objectives[3]!.status = 'missed'),
      problem: 'evaluation does not match the replay',
    },
    {
      name: 'status',
      mutate: (r: SessionAuditRecord) => (r.status = 'in-progress'),
      problem: 'status does not match the replay',
    },
    {
      name: 'origin',
      mutate: (r: SessionAuditRecord) => (r.origin = 'live'),
      problem: 'origin does not match the replay',
    },
  ])('detects a tampered $name', ({ mutate, problem }) => {
    const result = verifyAuditRecord(tamper(mutate), scenario);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems).toContain(problem);
  });

  it('detects swapped decisions that change the outcome', () => {
    // The decision ids drive the replay, so the derived fields expose the swap.
    const tampered = tamper((r) => (r.decisions[2]!.decisionId = 'wait-primary'));
    expect(verifyAuditRecord(tampered, scenario)).toEqual({
      ok: false,
      problems: [
        'elapsedMinutes does not match the replay',
        'flags does not match the replay',
        'evaluation does not match the replay',
      ],
    });
  });

  it('reports decisions the engine cannot replay', () => {
    const tampered = tamper((r) =>
      r.decisions.push({ stepId: 'recover', decisionId: 'activate-nimbus', atMinute: 16 }),
    );
    expect(verifyAuditRecord(tampered, scenario)).toEqual({
      ok: false,
      problems: ['replay failed: Exercise is already completed.'],
    });
  });

  it('rejects a record checked against another scenario version or id', () => {
    expect(verifyAuditRecord(record(OPTIMAL), remediated)).toEqual({
      ok: false,
      problems: ['scenario version 1 does not match 2'],
    });
    const other = { ...structuredClone(scenario), id: 'other-scenario' };
    expect(verifyAuditRecord(record(OPTIMAL), other)).toEqual({
      ok: false,
      problems: ['scenario id demo-auth-backup-retired does not match other-scenario'],
    });
  });

  it('rejects a record whose scenario content changed under the same version', () => {
    const checklistOnly = applyRemediations(scenario, model, ['rem-change-checklist']);
    expect(checklistOnly.version).toBe(remediated.version);
    const audit = record(OPTIMAL, remediated);
    expect(verifyAuditRecord(audit, checklistOnly)).toEqual({
      ok: false,
      problems: ['scenario content does not match the recorded fingerprint'],
    });
  });

  it('rejects unsupported schema versions', () => {
    const future = { ...record(OPTIMAL), schemaVersion: 2 } as unknown as SessionAuditRecord;
    expect(verifyAuditRecord(future, scenario)).toEqual({
      ok: false,
      problems: ['unsupported schema version 2'],
    });
  });
});

describe('scenario fingerprints', () => {
  it('is stable, ignores key order and changes with content', () => {
    expect(scenarioFingerprint(scenario)).toMatch(/^[0-9a-f]{16}$/);
    expect(scenarioFingerprint(structuredClone(scenario))).toBe(scenarioFingerprint(scenario));
    const reordered = Object.fromEntries(
      Object.entries(scenario).reverse(),
    ) as unknown as SimulationScenario;
    expect(scenarioFingerprint(reordered)).toBe(scenarioFingerprint(scenario));
    expect(scenarioFingerprint(remediated)).not.toBe(scenarioFingerprint(scenario));
    const edited = structuredClone(scenario);
    edited.steps.detect!.decisions[0]!.consequence.minutes = 11;
    expect(scenarioFingerprint(edited)).not.toBe(scenarioFingerprint(scenario));
  });

  it('serializes with sorted keys and drops undefined fields', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined, b: null }] })).toBe(
      '{"a":[{"b":null,"d":2}],"b":1}',
    );
  });
});
