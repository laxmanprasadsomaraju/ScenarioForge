/**
 * M5 contract: a deterministic rehearsal generated from one real M3 finding.
 *
 * Owned by the lead. Lane C implements `generateRehearsal` (pure); the UI
 * wires "Rehearse this change" to it at integration.
 *
 * Principles:
 * - The incident, decisions and evidence come from the actual change and the
 *   affected runbook step (verbatim quotes, real links). No generic scenario,
 *   no AI.
 * - Consequences are fixed rules keyed to the finding. They are modelled, not
 *   observed, and the scenario says so.
 * - The restore target is never assumed: the caller passes it (from a service
 *   tier when a source provides one, otherwise from the user).
 * - Same inputs give the same scenario (ids, text, order); replay and audit
 *   from shared/simulation apply unchanged.
 */
import type { ChangeAnalysis } from '../analysis/types';
import type { SimulationScenario } from '../domain/types';
import type { ScenarioRemediationModel } from '../simulation/types';

export interface GenerateRehearsalRequest {
  analysis: ChangeAnalysis;
  findingId: string;
  /** Minutes to restore the affected capability; required, never defaulted. */
  restoreTargetMinutes: number;
  /** Minutes to notify stakeholders; defaults to 15 when omitted. */
  notifyTargetMinutes?: number;
}

export interface GeneratedRehearsal {
  scenario: SimulationScenario;
  remediation: ScenarioRemediationModel;
  /** Where the scenario came from, shown in the UI. */
  provenance: {
    changeKey: string;
    findingId: string;
    confidence: 'confirmed' | 'suspected';
    /** Always true: outcomes are rule-based models, not observations. */
    consequencesModelled: true;
  };
}

export type GenerateRehearsalError = 'FINDING_NOT_FOUND' | 'ANALYSIS_NOT_USABLE' | 'INVALID_TARGET';

export type GenerateRehearsalResult =
  | { ok: true; rehearsal: GeneratedRehearsal }
  | { ok: false; error: GenerateRehearsalError; message: string };
