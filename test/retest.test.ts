import { describe, expect, it } from 'vitest';
import type { SimulationScenario } from '../shared/domain/types';
import {
  evaluateSession,
  SimulationError,
  startSession,
  validateScenario,
} from '../shared/simulation/engine';
import { applyRemediations, validateRemediationModel } from '../shared/simulation/remediation';
import { replaySession } from '../shared/simulation/replay';
import { buildRetest, compareRetest } from '../shared/simulation/retest';
import { authBackupRetiredScenario as scenario } from '../shared/simulation/scenarios/authBackupRetired';
import { authBackupRetiredRemediation as model } from '../shared/simulation/scenarios/authBackupRetiredRemediation';
import type { EvaluatedRun } from '../shared/simulation/types';

const START = '2026-11-09T10:00:00.000Z';
const COMPARED = '2026-11-09T11:00:00.000Z';
const FINDING = 'demo-finding-stale-failover';
const STALE_PATH = ['follow-runbook', 'inspect-change', 'notify-now', 'activate-nimbus'];

function run(s: SimulationScenario, decisions: string[], id: string): EvaluatedRun {
  const session = replaySession(s, decisions, id, START);
  return { scenario: s, session, evaluation: evaluateSession(s, session) };
}

const original = run(scenario, STALE_PATH, 'original');

function retestWith(remediationIds: string[], decisions: string[]) {
  const retestScenario = buildRetest(scenario, original.session, remediationIds, model);
  return run(retestScenario, decisions, 'retest');
}

function compare(retest: EvaluatedRun, findingId: string | undefined = FINDING) {
  return compareRetest(original, retest, model, { id: 'cmp-1', comparedAt: COMPARED, findingId });
}

describe('remediation variants', () => {
  const subsets = [
    { ids: [] },
    { ids: ['rem-runbook'] },
    { ids: ['rem-change-checklist'] },
    { ids: ['rem-runbook', 'rem-change-checklist'] },
  ];

  it('has a remediation model that matches the demo scenario', () => {
    expect(validateRemediationModel(scenario, model)).toEqual([]);
  });

  it.each(subsets)('stays structurally valid and demo-only with $ids applied', ({ ids }) => {
    const variant = applyRemediations(scenario, model, ids);
    expect(validateScenario(variant)).toEqual([]);
    expect(variant.origin).toBe('demo');
    expect(variant.evidence.every((e) => e.origin === 'demo')).toBe(true);
    expect(variant.remediation.every((r) => r.origin === 'demo')).toBe(true);
    expect(variant.version).toBe(ids.length === 0 ? 1 : 2);
  });

  it('points RB-AUTH-01 step 3 at NimbusID once rem-runbook is applied', () => {
    const variant = applyRemediations(scenario, model, ['rem-runbook']);
    const step3 = variant.procedure.steps.find((s) => s.order === 3)!;
    expect(step3.instruction).toContain('promote NimbusID');
    expect(step3.instruction).not.toContain('legacyauth');
    expect(step3.dependsOn).toEqual(['nimbusid']);
    expect(variant.evidence.find((e) => e.id === 'ev-runbook-step3')!.excerpt).toBe(
      step3.instruction,
    );
    expect(variant.procedure.steps.map((s) => s.order)).toEqual([1, 2, 3, 4]);
  });

  it('marks applied remediations approved and leaves the rest proposed', () => {
    const variant = applyRemediations(scenario, model, ['rem-runbook']);
    expect(Object.fromEntries(variant.remediation.map((r) => [r.id, r.status]))).toEqual({
      'rem-runbook': 'approved',
      'rem-change-checklist': 'proposed',
    });
  });

  it('makes following the runbook effective in the remediated version', () => {
    const variant = applyRemediations(scenario, model, ['rem-runbook']);
    const session = replaySession(variant, ['follow-runbook', 'notify-restored'], 's', START);
    expect(session.status).toBe('completed');
    expect(session.elapsedMinutes).toBe(11);
    const evaluation = evaluateSession(variant, session);
    expect(evaluation.metCount).toBe(4);
    const decision = variant.steps.detect!.decisions.find((d) => d.id === 'follow-runbook')!;
    expect(decision.consequence.assessment).toBe('effective');
  });

  it('keeps the stale runbook harmful when only the process checklist is applied', () => {
    const variant = applyRemediations(scenario, model, ['rem-change-checklist']);
    const decision = variant.steps.detect!.decisions.find((d) => d.id === 'follow-runbook')!;
    expect(decision.consequence.assessment).toBe('harmful');
    expect(variant.procedure).toEqual(scenario.procedure);
  });

  it('is independent of id order and duplicates', () => {
    expect(applyRemediations(scenario, model, ['rem-change-checklist', 'rem-runbook'])).toEqual(
      applyRemediations(scenario, model, ['rem-runbook', 'rem-change-checklist', 'rem-runbook']),
    );
  });

  it('does not mutate the scenario or the model', () => {
    const scenarioBefore = structuredClone(scenario);
    const modelBefore = structuredClone(model);
    const variant = applyRemediations(scenario, model, ['rem-runbook', 'rem-change-checklist']);
    variant.steps['post-recovery-comms']!.situation = 'edited';
    variant.procedure.steps[2]!.instruction = 'edited';
    expect(scenario).toEqual(scenarioBefore);
    expect(model).toEqual(modelBefore);
  });

  it('rejects unknown, rejected and unauthored remediations', () => {
    expect(() => applyRemediations(scenario, model, ['rem-missing'])).toThrow(SimulationError);
    const rejected = structuredClone(scenario);
    rejected.remediation[0]!.status = 'rejected';
    expect(() => applyRemediations(rejected, model, ['rem-runbook'])).toThrow(/rejected/);
    const unauthored = structuredClone(model);
    delete unauthored.effects['rem-runbook'];
    expect(() => applyRemediations(scenario, unauthored, ['rem-runbook'])).toThrow(/no authored/);
  });

  it('refuses to apply effects to a version they were not authored for', () => {
    const variant = applyRemediations(scenario, model, ['rem-runbook']);
    expect(() => applyRemediations(variant, model, ['rem-runbook'])).toThrow(SimulationError);
  });

  it('fails loudly when an effect target is missing', () => {
    const broken = structuredClone(model);
    broken.effects['rem-change-checklist'] = [
      { kind: 'replaceSituation', stepId: 'missing-step', situation: 'x' },
    ];
    expect(() => applyRemediations(scenario, broken, ['rem-change-checklist'])).toThrow(
      'Remediation rem-change-checklist: step missing-step does not exist.',
    );
  });

  it('reports remediation model authoring errors', () => {
    const broken = structuredClone(model);
    broken.gaps[0]!.objectiveIds = ['obj-missing'];
    broken.gaps[0]!.exerciseDecisions = [{ stepId: 'detect', decisionId: 'nope' }];
    broken.gaps[0]!.remediationIds = ['rem-missing'];
    delete broken.effects['rem-change-checklist'];
    expect(validateRemediationModel(scenario, broken)).toEqual([
      'remediation rem-change-checklist has no effects entry',
      `gap ${FINDING} cites unknown remediation rem-missing`,
      `gap ${FINDING} cites unknown objective obj-missing`,
      `gap ${FINDING} cites unknown decision detect/nope`,
    ]);
  });
});

describe('buildRetest', () => {
  it('builds the remediated version from a completed session', () => {
    const retest = buildRetest(scenario, original.session, ['rem-runbook'], model);
    expect(retest).toEqual(applyRemediations(scenario, model, ['rem-runbook']));
  });

  it('rejects sessions that are in progress or from another version', () => {
    const inProgress = startSession(scenario, 's', START);
    expect(() => buildRetest(scenario, inProgress, ['rem-runbook'], model)).toThrow(
      SimulationError,
    );
    const otherVersion = { ...original.session, scenarioVersion: 7 };
    expect(() => buildRetest(scenario, otherVersion, ['rem-runbook'], model)).toThrow(
      SimulationError,
    );
  });
});

describe('compareRetest', () => {
  it('resolves the gap when the corrected runbook is followed and restore is met', () => {
    const result = compare(retestWith(['rem-runbook'], ['follow-runbook', 'notify-restored']));
    expect(result).toMatchObject({
      id: 'cmp-1',
      originalSessionId: 'original',
      retestSessionId: 'retest',
      findingId: FINDING,
      outcome: 'resolved',
      comparedAt: COMPARED,
    });
    expect(result.gaps).toEqual([
      {
        findingId: FINDING,
        outcome: 'resolved',
        exercised: true,
        decisionsEffective: true,
        objectivesMet: true,
        objectives: [{ objectiveId: 'obj-restore', original: 'met', retest: 'met' }],
        reason: 'The retest followed the corrected procedure and met every tied objective.',
      },
    ]);
  });

  it('is still failing when the runbook was not remediated', () => {
    const rerun = compare(retestWith([], STALE_PATH));
    expect(rerun.outcome).toBe('still-failing');
    expect(rerun.gaps[0]).toMatchObject({ exercised: true, decisionsEffective: false });

    const checklistOnly = compare(retestWith(['rem-change-checklist'], STALE_PATH));
    expect(checklistOnly.outcome).toBe('still-failing');
  });

  it('is still failing when the stale step is retried on the uninformed path', () => {
    const result = compare(
      retestWith([], ['follow-runbook', 'retry-failover', 'notify-now', 'wait-primary-uninformed']),
    );
    expect(result.outcome).toBe('still-failing');
  });

  it('is still failing when a tied objective is missed despite an effective procedure', () => {
    const strict = structuredClone(model);
    strict.gaps[0]!.objectiveIds = ['obj-restore', 'obj-notify'];
    const retest = retestWith(['rem-runbook'], ['follow-runbook', 'skip-comms']);
    const result = compareRetest(original, retest, strict, { id: 'c', comparedAt: COMPARED });
    expect(result.outcome).toBe('still-failing');
    expect(result.gaps[0]).toMatchObject({
      decisionsEffective: true,
      objectivesMet: false,
      reason: 'The procedure worked, but tied objectives were not met: obj-notify.',
    });
  });

  it('is inconclusive when the retest never exercises the gap, even with every objective met', () => {
    const retest = retestWith(['rem-runbook'], ['check-changes', 'notify-now', 'activate-nimbus']);
    expect(retest.evaluation.metCount).toBe(4);
    const result = compare(retest);
    expect(result.outcome).toBe('inconclusive');
    expect(result.gaps[0]).toMatchObject({ exercised: false, decisionsEffective: false });
  });

  it('assesses every gap when no finding is given and combines outcomes strictly', () => {
    const retest = retestWith(['rem-runbook'], ['follow-runbook', 'notify-restored']);
    const all = compareRetest(original, retest, model, { id: 'c', comparedAt: COMPARED });
    expect(all.outcome).toBe('resolved');
    expect(all.findingId).toBeUndefined();
    expect('findingId' in all).toBe(false);

    const twoGaps = structuredClone(model);
    twoGaps.gaps.push({
      findingId: 'demo-finding-comms',
      title: 'Communication is skipped',
      remediationIds: [],
      objectiveIds: ['obj-notify'],
      exerciseDecisions: [{ stepId: 'communicate', decisionId: 'defer-comms' }],
    });
    expect(
      compareRetest(original, retest, twoGaps, { id: 'c', comparedAt: COMPARED }).outcome,
    ).toBe('inconclusive');
    const failing = retestWith([], STALE_PATH);
    expect(
      compareRetest(original, failing, twoGaps, { id: 'c', comparedAt: COMPARED }).outcome,
    ).toBe('still-failing');
    const noGaps = { ...model, gaps: [] };
    expect(compareRetest(original, retest, noGaps, { id: 'c', comparedAt: COMPARED }).outcome).toBe(
      'inconclusive',
    );
  });

  it('is deterministic and does not mutate its inputs', () => {
    const retest = retestWith(['rem-runbook'], ['follow-runbook', 'notify-restored']);
    const before = structuredClone({ original, retest, model });
    expect(compare(retest)).toEqual(compare(retest));
    expect({ original, retest, model }).toEqual(before);
  });

  it('rejects an evaluation that does not match its session', () => {
    const retest = retestWith(['rem-runbook'], ['follow-runbook', 'notify-restored']);
    const tampered = structuredClone(original);
    tampered.evaluation.objectives[0]!.status = 'missed';
    expect(() => compareRetest(tampered, retest, model, { id: 'c', comparedAt: COMPARED })).toThrow(
      'Original evaluation does not match its session.',
    );
  });

  it('rejects unknown findings, incomplete runs and mismatched scenarios', () => {
    const retest = retestWith(['rem-runbook'], ['follow-runbook', 'notify-restored']);
    expect(() => compare(retest, 'demo-finding-missing')).toThrow(SimulationError);

    const inProgress = { ...retest, session: startSession(retest.scenario, 'r', START) };
    expect(() => compare(inProgress)).toThrow(SimulationError);

    const otherScenario = { ...structuredClone(scenario), id: 'other' };
    const foreign = run(otherScenario, STALE_PATH, 'foreign');
    expect(() => compare(foreign)).toThrow(SimulationError);

    const older = compareRetest.bind(null, retest, original, model, {
      id: 'c',
      comparedAt: COMPARED,
    });
    expect(older).toThrow('Retest scenario version is older than the original.');
  });
});
