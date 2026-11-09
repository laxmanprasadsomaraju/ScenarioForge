import type { RemediationAction, SimulationScenario } from '../domain/types';
import { SimulationError } from './engine';
import type { RemediationEffect, ScenarioRemediationModel } from './types';

/**
 * Remediation-aware scenario variants.
 *
 * A remediation's effect on a rehearsal is authored data (`RemediationEffect`),
 * never inferred. Applying approved remediations produces a new scenario
 * version; the input scenario is never mutated. No clock reads, randomness or
 * AI happen here.
 */

/**
 * Applies approved remediations to a scenario and returns the next version.
 *
 * - Ids are de-duplicated and applied in the order the scenario lists its
 *   remediations, so `['a', 'b']` and `['b', 'a']` give identical results.
 * - Applied remediations are marked `approved` (a `created` one stays
 *   `created`); a `rejected` remediation cannot be applied.
 * - The result has `version: scenario.version + 1`. An empty id list returns
 *   an unchanged copy at the same version (a plain rerun, not a variant).
 * - Effects only apply to the version they were authored against, so a
 *   remediated scenario cannot be remediated again with the same model.
 *
 * Note: two different remediation sets yield the same version number. Use
 * `scenarioFingerprint` (replay.ts) to tell variants apart.
 */
export function applyRemediations(
  scenario: SimulationScenario,
  model: ScenarioRemediationModel,
  approvedRemediationIds: readonly string[],
): SimulationScenario {
  if (model.scenarioId !== scenario.id || model.baseVersion !== scenario.version) {
    throw new SimulationError(
      `Remediation model targets ${model.scenarioId} v${model.baseVersion}, not ${scenario.id} v${scenario.version}.`,
    );
  }
  const requested = new Set(approvedRemediationIds);
  for (const id of requested) {
    const action = scenario.remediation.find((r) => r.id === id);
    if (!action) {
      throw new SimulationError(`Scenario ${scenario.id} has no remediation ${id}.`);
    }
    if (action.status === 'rejected') {
      throw new SimulationError(`Remediation ${id} was rejected and cannot be applied.`);
    }
    if (!model.effects[id]) {
      throw new SimulationError(`Remediation ${id} has no authored effects.`);
    }
  }

  const next = structuredClone(scenario);
  if (requested.size === 0) {
    return next;
  }
  next.version = scenario.version + 1;
  next.remediation = next.remediation.map((action): RemediationAction =>
    requested.has(action.id) && action.status !== 'created'
      ? { ...action, status: 'approved' }
      : action,
  );
  for (const action of scenario.remediation) {
    if (!requested.has(action.id)) continue;
    for (const effect of model.effects[action.id] ?? []) {
      applyEffect(next, effect, action.id);
    }
  }
  return next;
}

/** Mutates `target`, which is always a private clone owned by applyRemediations. */
function applyEffect(target: SimulationScenario, effect: RemediationEffect, remediationId: string) {
  const fail = (what: string) => {
    throw new SimulationError(`Remediation ${remediationId}: ${what}.`);
  };
  switch (effect.kind) {
    case 'replaceProcedureStep': {
      const index = target.procedure.steps.findIndex((s) => s.order === effect.step.order);
      if (index < 0) fail(`procedure has no step ${effect.step.order}`);
      target.procedure.steps[index] = structuredClone(effect.step);
      break;
    }
    case 'replaceEvidence': {
      const index = target.evidence.findIndex((e) => e.id === effect.evidence.id);
      if (index < 0) fail(`evidence ${effect.evidence.id} does not exist`);
      target.evidence[index] = structuredClone(effect.evidence);
      break;
    }
    case 'addEvidence': {
      if (target.evidence.some((e) => e.id === effect.evidence.id)) {
        fail(`evidence ${effect.evidence.id} already exists`);
      }
      target.evidence.push(structuredClone(effect.evidence));
      break;
    }
    case 'replaceDecision': {
      const step = target.steps[effect.stepId];
      const index = step ? step.decisions.findIndex((d) => d.id === effect.decision.id) : -1;
      if (!step || index < 0) fail(`step ${effect.stepId} has no decision ${effect.decision.id}`);
      step!.decisions[index] = structuredClone(effect.decision);
      break;
    }
    case 'addStep': {
      if (target.steps[effect.step.id]) fail(`step ${effect.step.id} already exists`);
      target.steps[effect.step.id] = structuredClone(effect.step);
      break;
    }
    case 'replaceSituation': {
      const step = target.steps[effect.stepId];
      if (!step) fail(`step ${effect.stepId} does not exist`);
      step!.situation = effect.situation;
      break;
    }
  }
}

/**
 * Structural checks for a remediation model against its base scenario, so
 * authoring mistakes fail in tests rather than during a retest.
 */
export function validateRemediationModel(
  scenario: SimulationScenario,
  model: ScenarioRemediationModel,
): string[] {
  const problems: string[] = [];
  if (model.scenarioId !== scenario.id || model.baseVersion !== scenario.version) {
    problems.push(`model targets ${model.scenarioId} v${model.baseVersion}`);
  }
  const remediationIds = new Set(scenario.remediation.map((r) => r.id));
  const objectiveIds = new Set(scenario.objectives.map((o) => o.id));
  for (const id of remediationIds) {
    if (!model.effects[id]) problems.push(`remediation ${id} has no effects entry`);
  }
  for (const id of Object.keys(model.effects)) {
    if (!remediationIds.has(id)) problems.push(`effects reference unknown remediation ${id}`);
  }
  const findingIds = new Set<string>();
  for (const gap of model.gaps) {
    if (findingIds.has(gap.findingId)) problems.push(`gap ${gap.findingId} is defined twice`);
    findingIds.add(gap.findingId);
    if (gap.objectiveIds.length === 0) problems.push(`gap ${gap.findingId} has no objectives`);
    if (gap.exerciseDecisions.length === 0) {
      problems.push(`gap ${gap.findingId} has no exercise decisions`);
    }
    for (const id of gap.remediationIds) {
      if (!remediationIds.has(id))
        problems.push(`gap ${gap.findingId} cites unknown remediation ${id}`);
    }
    for (const id of gap.objectiveIds) {
      if (!objectiveIds.has(id))
        problems.push(`gap ${gap.findingId} cites unknown objective ${id}`);
    }
    for (const ref of gap.exerciseDecisions) {
      const step = scenario.steps[ref.stepId];
      if (!step?.decisions.some((d) => d.id === ref.decisionId)) {
        problems.push(
          `gap ${gap.findingId} cites unknown decision ${ref.stepId}/${ref.decisionId}`,
        );
      }
    }
  }
  return problems;
}
