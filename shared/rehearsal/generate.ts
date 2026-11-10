import type { ChangeAction, ChangeRecoveryFinding, ChangeSubject } from '../analysis/types';
import { normaliseTerm } from '../analysis/text';
import type {
  DataOrigin,
  Decision,
  EvidenceReference,
  RemediationAction,
  ScenarioStep,
  SimulationScenario,
} from '../domain/types';
import type { RemediationEffect, ScenarioRemediationModel } from '../simulation/types';
import type { GenerateRehearsalRequest, GenerateRehearsalResult } from './types';

/**
 * M5: a deterministic rehearsal generated from one M3 finding.
 *
 * Pure: no AI, no clock, no randomness. Every text is a fixed template filled
 * only with values from the finding (subject, verbatim evidence, change key,
 * page title, step order) and the caller's targets. Nothing else is invented:
 * no services, owners, systems or numbers beyond the documented constants
 * below.
 *
 * Modelled outcomes: every consequence narrative starts with `MODELLED_PREFIX`
 * ("Modelled: "), the summary says the outcomes are modelled from the finding,
 * and every consequence cites the `rule:modelled` evidence entry.
 *
 * Shape (same branching as the demo scenario):
 *
 *   detect ──follow-step──▶ step-failed ──retry/inspect/escalate──▶ communicate
 *      ├────check-change──▶ communicate                                  │
 *      └──bypass-controls─▶ communicate                                  │
 *   communicate ──(gap identified)──▶ recover, otherwise recover-uninformed
 *   recover-uninformed ──investigate-step──▶ recover
 *
 * Consequence rules per ChangeAction (following step N as written):
 * - retire, disable, replace, migrate: the step depends on something the change
 *   removes or moves; it fails. `harmful`, FOLLOW_BLOCKED minutes.
 * - rename: the step uses the old name; it does not resolve but nothing is
 *   harmed. `neutral`, FOLLOW_REVIEW minutes.
 * - upgrade: the subject still exists; the step is held for review against the
 *   upgrade. `neutral`, FOLLOW_REVIEW minutes.
 * In every case following the step as written does not restore recovery.
 *
 * "Use the replacement" is offered only when the change names one
 * (`subject.replacement`); it is never invented. Without one, recovery comes
 * from escalation, waiting or (harmfully) bypassing controls.
 *
 * Remediation `rem-step` rewrites step N. With a named replacement, following
 * the updated step restores recovery (`effective`), so a retest that follows
 * it can be `resolved`. Without one the updated step only removes the
 * dependency and says the replacement must be confirmed; following it stays
 * `neutral`, so the retest is `still-failing` until the change names a
 * replacement (conservative, per D15). `rem-change-check` is a process change
 * with no effect on this rehearsal.
 */

export const MODELLED_PREFIX = 'Modelled: ';

/** Fixed simulated minutes per action. Documented constants, not observations. */
export const REHEARSAL_MINUTES = {
  /** Following (or retrying) a step whose dependency was retired/disabled/replaced/migrated. */
  followBlocked: 10,
  /** Following (or retrying) a step affected by a rename or an upgrade. */
  followReview: 5,
  /** Checking the change, or following the updated step without a named replacement. */
  checkChange: 5,
  /** Investigating why the step fails, from the uninformed recovery step. */
  investigate: 6,
  /** Escalating to the owner of the change. */
  escalate: 15,
  /** Switching the step to the replacement the change names. */
  useReplacement: 8,
  /** Waiting for the primary path to recover by itself. */
  waitPrimary: 60,
  /** Bypassing security controls. */
  bypass: 4,
  /** Posting a status update. */
  notify: 3,
} as const;

export const DEFAULT_NOTIFY_TARGET_MINUTES = 15;

export const REHEARSAL_FLAGS = {
  restored: 'recoveryRestored',
  notified: 'stakeholdersNotified',
  gap: 'runbookGapIdentified',
  bypassed: 'securityBypassed',
} as const;

interface ActionRule {
  assessment: 'harmful' | 'neutral';
  minutes: number;
  /** Why following the step as written does not complete. */
  outcome: (s: ChangeSubject, changeKey: string, step: number) => string;
}

const blocked =
  (verb: string) =>
  (s: ChangeSubject, key: string, step: number): string =>
    `step ${step} depends on ${s.display}, which ${key} ${verb}, so in this rehearsal the step fails and recovery stays blocked.`;

/** Consequence rules for following the affected step as written, per ChangeAction. */
export const ACTION_RULES: Record<ChangeAction, ActionRule> = {
  retire: {
    assessment: 'harmful',
    minutes: REHEARSAL_MINUTES.followBlocked,
    outcome: blocked('retires'),
  },
  disable: {
    assessment: 'harmful',
    minutes: REHEARSAL_MINUTES.followBlocked,
    outcome: blocked('disables'),
  },
  replace: {
    assessment: 'harmful',
    minutes: REHEARSAL_MINUTES.followBlocked,
    outcome: blocked('replaces'),
  },
  migrate: {
    assessment: 'harmful',
    minutes: REHEARSAL_MINUTES.followBlocked,
    outcome: blocked('migrates'),
  },
  rename: {
    assessment: 'neutral',
    minutes: REHEARSAL_MINUTES.followReview,
    outcome: (s, key, step) =>
      `step ${step} uses the old name ${s.display}, which ${key} renames, so in this rehearsal the step does not resolve and recovery stays blocked.`,
  },
  upgrade: {
    assessment: 'neutral',
    minutes: REHEARSAL_MINUTES.followReview,
    outcome: (s, key, step) =>
      `step ${step} was written before ${key} upgrades ${s.display}, so in this rehearsal the step is held for review against the upgrade and recovery stays blocked.`,
  },
};

const VERB: Record<ChangeAction, string> = {
  retire: 'retires',
  replace: 'replaces',
  migrate: 'migrates',
  rename: 'renames',
  disable: 'disables',
  upgrade: 'upgrades',
};

const RULE = {
  modelled: 'rule:modelled',
  escalate: 'rule:escalate',
  wait: 'rule:wait',
  bypass: 'rule:bypass',
} as const;

export const REMEDIATION_IDS = { step: 'rem-step', process: 'rem-change-check' } as const;

export function generateRehearsal(request: GenerateRehearsalRequest): GenerateRehearsalResult {
  const { analysis, findingId, restoreTargetMinutes } = request;
  const notifyTargetMinutes = request.notifyTargetMinutes ?? DEFAULT_NOTIFY_TARGET_MINUTES;

  if (!isIntegerIn(restoreTargetMinutes, 5, 1440)) {
    return fail('INVALID_TARGET', 'restoreTargetMinutes must be a whole number from 5 to 1440.');
  }
  if (!isIntegerIn(notifyTargetMinutes, 1, 240)) {
    return fail('INVALID_TARGET', 'notifyTargetMinutes must be a whole number from 1 to 240.');
  }
  if (analysis.status !== 'findings') {
    return fail(
      'ANALYSIS_NOT_USABLE',
      `Analysis of ${analysis.changeKey} has status ${analysis.status}; a rehearsal needs a finding.`,
    );
  }
  const finding = analysis.findings.find((f) => f.id === findingId);
  if (!finding) {
    return fail(
      'FINDING_NOT_FOUND',
      `Analysis of ${analysis.changeKey} has no finding ${findingId}.`,
    );
  }
  const changeEvidence = finding.evidence.find(
    (e) => e.kind === 'jira-issue' && hasText(e.excerpt),
  );
  const stepEvidence = finding.evidence.find(
    (e) => (e.kind === 'confluence-page' || e.kind === 'runbook-step') && hasText(e.excerpt),
  );
  if (finding.changeKey !== analysis.changeKey || !changeEvidence || !stepEvidence) {
    return fail(
      'ANALYSIS_NOT_USABLE',
      `Finding ${findingId} lacks the verbatim change and runbook step quotes a rehearsal needs.`,
    );
  }

  const ctx: Context = {
    finding,
    subject: finding.subject,
    key: analysis.change.key,
    summary: analysis.change.summary,
    browsePath: analysis.change.browsePath,
    page: finding.pageTitle,
    n: finding.stepOrder,
    stepText: stepEvidence.excerpt!,
    changeEv: structuredClone(changeEvidence),
    stepEv: structuredClone(stepEvidence),
    origin: changeEvidence.origin === 'live' && stepEvidence.origin === 'live' ? 'live' : 'demo',
    scenarioId: `rehearsal:${analysis.change.key}:${finding.id}`,
    restore: restoreTargetMinutes,
    notify: notifyTargetMinutes,
  };

  const scenario = buildScenario(ctx);
  const remediation = buildRemediationModel(ctx);
  return {
    ok: true,
    rehearsal: {
      scenario,
      remediation,
      provenance: {
        changeKey: ctx.key,
        findingId: finding.id,
        confidence: finding.confidence,
        consequencesModelled: true,
      },
    },
  };
}

interface Context {
  finding: ChangeRecoveryFinding;
  subject: ChangeSubject;
  key: string;
  summary: string;
  browsePath: string;
  page: string;
  n: number;
  stepText: string;
  changeEv: EvidenceReference;
  stepEv: EvidenceReference;
  origin: DataOrigin;
  scenarioId: string;
  restore: number;
  notify: number;
}

const { restored: RESTORED, notified: NOTIFIED, gap: GAP, bypassed: BYPASSED } = REHEARSAL_FLAGS;

function modelled(text: string): string {
  return MODELLED_PREFIX + text;
}

/** What the change does to the subject, in the M3 wording ("retires LegacyAuth"). */
function changeDoes(s: ChangeSubject): string {
  if (s.replacement && s.action === 'replace') return `replaces ${s.display} with ${s.replacement}`;
  if (
    s.replacement &&
    (s.action === 'migrate' || s.action === 'rename' || s.action === 'upgrade')
  ) {
    return `${VERB[s.action]} ${s.display} to ${s.replacement}`;
  }
  return `${VERB[s.action]} ${s.display}`;
}

function buildScenario(c: Context): SimulationScenario {
  const { subject: s, key, n, page } = c;
  const rule = ACTION_RULES[s.action];
  const ev = { change: c.changeEv.id, step: c.stepEv.id };

  const summary = [
    `Rehearsal modelled from finding ${c.finding.id}: ${key} ${changeDoes(s)}, and step ${n} of ${page} still refers to it.`,
    c.finding.confidence === 'suspected'
      ? 'The link between the change and the step is suspected, not confirmed.'
      : 'The link between the change and the step is confirmed by an explicit cross-reference.',
    s.replacement
      ? `The change names ${s.replacement} as the replacement.`
      : 'The change does not name a replacement.',
    'The incident and every outcome are modelled from the finding by fixed rules, not observed.',
  ].join(' ');

  const bypassAtDetect: Decision = {
    id: 'bypass-controls',
    label: 'Bypass security controls to force recovery',
    detail: 'Skip the step and relax protections without approval.',
    consequence: {
      minutes: REHEARSAL_MINUTES.bypass,
      setFlags: [BYPASSED],
      narrative: modelled(
        `bypassing controls without approval weakens protection and does not repair step ${n}. Recovery is still blocked.`,
      ),
      evidenceIds: [RULE.bypass, RULE.modelled],
      assessment: 'harmful',
    },
    next: 'communicate',
  };

  const waitDecision = (id: string): Decision => ({
    id,
    label: 'Wait for the primary path to recover',
    consequence: {
      minutes: REHEARSAL_MINUTES.waitPrimary,
      setFlags: [RESTORED],
      narrative: modelled(
        `in this rehearsal the primary path recovers by itself after ${REHEARSAL_MINUTES.waitPrimary} minutes.`,
      ),
      evidenceIds: [RULE.wait, RULE.modelled],
      assessment: 'neutral',
    },
    next: null,
  });

  const bypassDecision = (id: string): Decision => ({
    id,
    label: 'Bypass security controls to restore recovery',
    consequence: {
      minutes: REHEARSAL_MINUTES.bypass,
      setFlags: [BYPASSED, RESTORED],
      narrative: modelled(
        'recovery works, but security controls are bypassed without approval and protection is weakened.',
      ),
      evidenceIds: [RULE.bypass, RULE.modelled],
      assessment: 'harmful',
    },
    next: null,
  });

  const recoverDecisions: Decision[] = [];
  if (s.replacement) {
    recoverDecisions.push({
      id: 'use-replacement',
      label: `Use ${s.replacement} in place of ${s.display} for step ${n}`,
      detail: `${key} names ${s.replacement}: "${s.excerpt}"`,
      consequence: {
        minutes: REHEARSAL_MINUTES.useReplacement,
        setFlags: [RESTORED],
        narrative: modelled(
          `${key} names ${s.replacement} in place of ${s.display}; in this rehearsal running step ${n} against ${s.replacement} restores recovery.`,
        ),
        evidenceIds: [ev.change, ev.step, RULE.modelled],
        assessment: 'effective',
      },
      next: null,
    });
  }
  recoverDecisions.push(
    {
      id: 'escalate-owner',
      label: `Escalate to the owner of ${key}`,
      consequence: {
        minutes: REHEARSAL_MINUTES.escalate,
        setFlags: [RESTORED],
        narrative: modelled(
          `in this rehearsal the owner of ${key} answers after ${REHEARSAL_MINUTES.escalate} minutes with a supported way to complete step ${n}.`,
        ),
        evidenceIds: [ev.change, RULE.escalate, RULE.modelled],
        assessment: 'neutral',
      },
      next: null,
    },
    waitDecision('wait-primary'),
    bypassDecision('bypass-restore'),
  );

  const steps: Record<string, ScenarioStep> = {
    detect: {
      id: 'detect',
      title: incidentTitle(s, n),
      situation:
        `Modelled incident: the outage that ${page} is written for is in progress, and recovery ` +
        `has reached step ${n}, the fallback being exercised. Step ${n} reads: "${c.stepText}" ` +
        'You are the incident commander. What do you do first?',
      decisions: [
        {
          id: 'follow-step',
          label: `Follow ${page} step ${n} as written`,
          detail: c.stepText,
          consequence: {
            minutes: rule.minutes,
            narrative: modelled(rule.outcome(s, key, n)),
            evidenceIds: [ev.step, ev.change, RULE.modelled],
            assessment: rule.assessment,
          },
          next: 'step-failed',
        },
        {
          id: 'check-change',
          label: `Check recent changes to ${s.display} before running step ${n}`,
          detail: `Look for changes to what step ${n} depends on before executing it.`,
          consequence: {
            minutes: REHEARSAL_MINUTES.checkChange,
            setFlags: [GAP],
            narrative: modelled(
              `you find ${key}: "${s.excerpt}" Step ${n} of ${page} still refers to ${s.display}.`,
            ),
            evidenceIds: [ev.change, ev.step, RULE.modelled],
            assessment: 'effective',
          },
          next: 'communicate',
        },
        bypassAtDetect,
      ],
    },
    'step-failed': {
      id: 'step-failed',
      title: `Step ${n} did not complete`,
      situation: `Step ${n} of ${page} did not complete and recovery is still blocked. What is your next move?`,
      decisions: [
        {
          id: 'retry-step',
          label: `Retry step ${n} as written`,
          consequence: {
            minutes: rule.minutes,
            narrative: modelled(`the retry ends the same way: ${rule.outcome(s, key, n)}`),
            evidenceIds: [ev.step, ev.change, RULE.modelled],
            assessment: rule.assessment,
          },
          next: 'communicate',
        },
        {
          id: 'inspect-change',
          label: `Check the change history for ${s.display}`,
          consequence: {
            minutes: REHEARSAL_MINUTES.checkChange,
            setFlags: [GAP],
            narrative: modelled(
              `you find ${key}: "${s.excerpt}" Step ${n} of ${page} still refers to ${s.display}. It needs checking against the change.`,
            ),
            evidenceIds: [ev.change, ev.step, RULE.modelled],
            assessment: 'effective',
          },
          next: 'communicate',
        },
        {
          id: 'escalate',
          label: `Escalate to the owner of ${key}`,
          consequence: {
            minutes: REHEARSAL_MINUTES.escalate,
            setFlags: [GAP],
            narrative: modelled(
              `after ${REHEARSAL_MINUTES.escalate} minutes the owner of ${key} confirms that the change ${changeDoes(s)}. You learn about the gap, but late.`,
            ),
            evidenceIds: [ev.change, RULE.escalate, RULE.modelled],
            assessment: 'neutral',
          },
          next: 'communicate',
        },
      ],
    },
    communicate: {
      id: 'communicate',
      title: 'Stakeholder communication',
      situation:
        'Recovery is not complete and stakeholders are asking for news. How do you handle communication?',
      decisions: [
        {
          id: 'notify-now',
          label: 'Post a status update and brief support now',
          consequence: {
            minutes: REHEARSAL_MINUTES.notify,
            setFlags: [NOTIFIED],
            narrative: modelled(
              'stakeholders know an incident is in progress and recovery is under way.',
            ),
            evidenceIds: [RULE.modelled],
            assessment: 'effective',
          },
          next: 'recover-uninformed',
          nextIfFlag: { flag: GAP, next: 'recover' },
        },
        {
          id: 'defer-comms',
          label: 'Hold communication until the cause is confirmed',
          consequence: {
            minutes: 0,
            narrative: modelled('no update is sent and support escalates without guidance.'),
            evidenceIds: [RULE.modelled],
            assessment: 'harmful',
          },
          next: 'recover-uninformed',
          nextIfFlag: { flag: GAP, next: 'recover' },
        },
      ],
    },
    recover: {
      id: 'recover',
      title: 'Restore recovery',
      situation: s.replacement
        ? `You know that ${key} ${changeDoes(s)} and names ${s.replacement}. How do you restore recovery?`
        : `You know that ${key} ${changeDoes(s)}, and the change does not name a replacement. How do you restore recovery?`,
      decisions: recoverDecisions,
    },
    'recover-uninformed': {
      id: 'recover-uninformed',
      title: 'Restore recovery',
      situation: `Recovery is still blocked and it is not yet known why step ${n} fails. How do you restore recovery?`,
      decisions: [
        {
          id: 'investigate-step',
          label: `Investigate why step ${n} fails`,
          consequence: {
            minutes: REHEARSAL_MINUTES.investigate,
            setFlags: [GAP],
            narrative: modelled(`you find ${key}: "${s.excerpt}"`),
            evidenceIds: [ev.change, ev.step, RULE.modelled],
            assessment: 'effective',
          },
          next: 'recover',
        },
        waitDecision('wait-primary-uninformed'),
        bypassDecision('bypass-restore-uninformed'),
      ],
    },
  };

  const remediation: RemediationAction[] = [
    {
      id: REMEDIATION_IDS.step,
      origin: c.origin,
      title: `Update ${page} step ${n}`,
      description: s.replacement
        ? `Replace the dependency on ${s.display} in step ${n} with ${s.replacement}, as named in ${key}.`
        : s.action === 'upgrade'
          ? `Review step ${n} against the ${s.display} upgrade in ${key} — the change does not state how the step should change. Confirm with the owner of ${key} before relying on step ${n}.`
          : `Remove dependency on ${s.display} — replacement not stated in the change. Confirm the replacement with the owner of ${key} before relying on step ${n}.`,
      status: 'proposed',
      evidenceIds: [ev.step, ev.change],
    },
    {
      id: REMEDIATION_IDS.process,
      origin: c.origin,
      title: `Add a recovery-runbook check to changes like ${key}`,
      description: `Changes that ${VERB[s.action].replace(/s$/, '')} a dependency should list and update the runbook steps that rely on it.`,
      status: 'proposed',
      evidenceIds: [ev.change],
    },
  ];

  return {
    id: c.scenarioId,
    origin: c.origin,
    version: 1,
    title: `Rehearsal: ${s.display} during recovery after ${key}`,
    summary,
    changeContext: {
      id: `change:${key}`,
      origin: c.origin,
      key,
      summary: c.summary,
      // Status and type are not part of the M3 analysis; never guessed.
      status: 'unknown',
      issueType: 'unknown',
      updatedAt: null,
      url: c.browsePath,
      affectedServiceIds: [],
    },
    procedure: {
      id: `page:${c.finding.pageId}`,
      origin: c.origin,
      title: page,
      // No service source is part of the analysis; never invented.
      serviceId: '',
      steps: [{ order: n, instruction: c.stepText, dependsOn: [s.term] }],
      source: structuredClone(c.stepEv),
    },
    services: [],
    evidence: [
      structuredClone(c.changeEv),
      structuredClone(c.stepEv),
      ruleEvidence(
        c,
        RULE.modelled,
        'Scenario rule: modelled outcomes',
        `Consequences in this rehearsal are fixed rules derived from finding ${c.finding.id}, not observed behaviour.`,
      ),
      ruleEvidence(
        c,
        RULE.escalate,
        'Scenario rule: escalation time',
        `In this rehearsal escalating to the owner of ${key} takes ${REHEARSAL_MINUTES.escalate} minutes.`,
      ),
      ruleEvidence(
        c,
        RULE.wait,
        'Scenario rule: primary path outage',
        `In this rehearsal the primary path stays unavailable for ${REHEARSAL_MINUTES.waitPrimary} minutes.`,
      ),
      ruleEvidence(
        c,
        RULE.bypass,
        'Scenario rule: security controls',
        'Bypassing security controls requires approval and weakens protection.',
      ),
    ],
    objectives: [
      {
        id: 'obj-restore',
        label: `Restore recovery within ${c.restore} minutes`,
        rule: { kind: 'flagSetWithin', flag: RESTORED, minutes: c.restore },
      },
      {
        id: 'obj-notify',
        label: `Notify stakeholders within ${c.notify} minutes`,
        rule: { kind: 'flagSetWithin', flag: NOTIFIED, minutes: c.notify },
      },
      {
        id: 'obj-gap',
        label: `Identify the recovery gap introduced by ${key}`,
        rule: { kind: 'flagSet', flag: GAP },
      },
      {
        id: 'obj-controls',
        label: 'Keep security controls in place',
        rule: { kind: 'flagNeverSet', flag: BYPASSED },
      },
    ],
    startStepId: 'detect',
    steps,
    remediation,
  };
}

/** Incident title per ChangeAction; the affected step is the fallback being exercised. */
function incidentTitle(s: ChangeSubject, n: number): string {
  if (s.action === 'rename') return `${s.display} no longer resolves during recovery`;
  if (s.action === 'upgrade') return `Step ${n} meets an upgraded ${s.display} during recovery`;
  return `${s.display} is unavailable during recovery`;
}

function ruleEvidence(c: Context, id: string, title: string, text: string): EvidenceReference {
  return { id, origin: c.origin, kind: 'scenario-rule', title, excerpt: modelled(text) };
}

/** Text of step N after `rem-step`. Keeps the original step verbatim for reference. */
export function correctedStepText(
  subject: ChangeSubject,
  changeKey: string,
  stepText: string,
): string {
  const previous = `Previous step text: "${stepText}"`;
  if (subject.replacement) {
    return `Use ${subject.replacement} in place of ${subject.display} for this step (${changeKey} ${changeDoes(subject)}). ${previous}`;
  }
  return subject.action === 'upgrade'
    ? `Check this step against ${changeKey}, which ${changeDoes(subject)}, before using it. The change does not state how this step should change; confirm with the owner of ${changeKey}. ${previous}`
    : `Do not rely on ${subject.display} for this step (${changeKey} ${changeDoes(subject)}). The replacement is not stated in the change and must be confirmed with the owner of ${changeKey} before this step is used. ${previous}`;
}

function buildRemediationModel(c: Context): ScenarioRemediationModel {
  const { subject: s, key, n, page } = c;
  const corrected = correctedStepText(s, key, c.stepText);
  const proposedId = `${c.finding.id}:proposed-step`;

  const effects: RemediationEffect[] = [
    {
      kind: 'replaceProcedureStep',
      step: {
        order: n,
        instruction: corrected,
        dependsOn: s.replacement ? [normaliseTerm(s.replacement)] : [],
      },
    },
    {
      kind: 'addEvidence',
      evidence: {
        id: proposedId,
        origin: c.origin,
        kind: 'scenario-rule',
        title: `Proposed ${page} step ${n} (remediation ${REMEDIATION_IDS.step}, not yet applied to the page)`,
        excerpt: corrected,
      },
    },
  ];

  if (s.replacement) {
    effects.push(
      {
        kind: 'replaceDecision',
        stepId: 'detect',
        decision: {
          id: 'follow-step',
          label: `Follow ${page} step ${n} as updated: use ${s.replacement}`,
          detail: corrected,
          consequence: {
            minutes: REHEARSAL_MINUTES.useReplacement,
            setFlags: [GAP, RESTORED],
            narrative: modelled(
              `updated step ${n} records that ${key} ${changeDoes(s)} and directs you to ${s.replacement}; in this rehearsal recovery is restored.`,
            ),
            evidenceIds: [proposedId, c.changeEv.id, RULE.modelled],
            assessment: 'effective',
          },
          next: 'post-recovery-comms',
        },
      },
      {
        kind: 'addStep',
        step: {
          id: 'post-recovery-comms',
          title: 'Close the loop',
          situation: `Recovery is restored through ${s.replacement}. Stakeholders still have open questions from the outage. How do you handle communication?`,
          decisions: [
            {
              id: 'notify-restored',
              label: 'Post a status update and brief support now',
              consequence: {
                minutes: REHEARSAL_MINUTES.notify,
                setFlags: [NOTIFIED],
                narrative: modelled('stakeholders learn that recovery is complete.'),
                evidenceIds: [RULE.modelled],
                assessment: 'effective',
              },
              next: null,
            },
            {
              id: 'skip-comms',
              label: 'Skip the update now that recovery works',
              consequence: {
                minutes: 0,
                narrative: modelled(
                  'no update is sent and support answers outage questions without guidance.',
                ),
                evidenceIds: [RULE.modelled],
                assessment: 'harmful',
              },
              next: null,
            },
          ],
        },
      },
    );
  } else {
    effects.push({
      kind: 'replaceDecision',
      stepId: 'detect',
      decision: {
        id: 'follow-step',
        label: `Follow ${page} step ${n} as updated`,
        detail: corrected,
        consequence: {
          minutes: REHEARSAL_MINUTES.checkChange,
          setFlags: [GAP],
          narrative: modelled(
            s.action === 'upgrade'
              ? `updated step ${n} flags the ${s.display} upgrade, but ${key} does not state how the step should change, so it cannot restore recovery yet.`
              : `updated step ${n} no longer relies on ${s.display}, but ${key} does not state a replacement, so the step cannot restore recovery yet.`,
          ),
          evidenceIds: [proposedId, c.changeEv.id, RULE.modelled],
          assessment: 'neutral',
        },
        next: 'communicate',
      },
    });
  }

  return {
    scenarioId: c.scenarioId,
    baseVersion: 1,
    effects: { [REMEDIATION_IDS.step]: effects, [REMEDIATION_IDS.process]: [] },
    gaps: [
      {
        findingId: c.finding.id,
        title: `${page} step ${n} still depends on ${s.display}`,
        remediationIds: [REMEDIATION_IDS.step],
        objectiveIds: ['obj-restore'],
        exerciseDecisions: [
          { stepId: 'detect', decisionId: 'follow-step' },
          { stepId: 'step-failed', decisionId: 'retry-step' },
        ],
      },
    ],
  };
}

function isIntegerIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function hasText(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim().length > 0;
}

function fail(
  error: 'FINDING_NOT_FOUND' | 'ANALYSIS_NOT_USABLE' | 'INVALID_TARGET',
  message: string,
): GenerateRehearsalResult {
  return { ok: false, error, message };
}
