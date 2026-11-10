import { describe, expect, it } from 'vitest';
import { analyzeChange } from '../shared/analysis';
import type { ChangeAction, ChangeAnalysis, RunbookEvidence } from '../shared/analysis/types';
import type { SimulationScenario } from '../shared/domain/types';
import {
  ACTION_RULES,
  DEFAULT_NOTIFY_TARGET_MINUTES,
  generateRehearsal,
  MODELLED_PREFIX,
  REHEARSAL_MINUTES,
} from '../shared/rehearsal/generate';
import type { GeneratedRehearsal, GenerateRehearsalRequest } from '../shared/rehearsal/types';
import { evaluateSession, validateScenario } from '../shared/simulation/engine';
import { validateRemediationModel } from '../shared/simulation/remediation';
import { createAuditRecord, replaySession, verifyAuditRecord } from '../shared/simulation/replay';
import { buildRetest, compareRetest } from '../shared/simulation/retest';
import type { EvaluatedRun } from '../shared/simulation/types';
import { change, RB_AUTH_STEPS, runbook } from './fixtures/analysis/cases';

/**
 * Generated rehearsals from real M3 analyses. The analyses come from the M3
 * rule engine run on the MC-62 live-test texts (docs/M3_LIVE_TEST.md), marked
 * `live` here so the generator's origin handling is exercised.
 */

const AT = '2026-11-10T09:30:00.000Z';
const START = '2026-11-10T10:00:00.000Z';
const MC62_DESCRIPTION =
  'Synthetic change for ScenarioForge testing.\n\nWe will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';
const MC62_SUMMARY = '[DEMO] Retire LegacyAuth backup SSO tenant';
const RB_TITLE = '[DEMO] RB-AUTH-01 Customer sign-in recovery';

function liveRunbook(steps: string[], intro?: string): RunbookEvidence {
  return { ...runbook('98305', RB_TITLE, steps, intro), origin: 'live' };
}

function mc62(confirmed: boolean): ChangeAnalysis {
  const intro = confirmed ? 'Synthetic runbook. Related change: MC-62' : undefined;
  return analyzeChange(
    change('MC-62', MC62_SUMMARY, MC62_DESCRIPTION, { origin: 'live' }),
    [liveRunbook(RB_AUTH_STEPS, intro)],
    AT,
  );
}

function analysisFor(summary: string, steps: string[], description: string | null = null) {
  return analyzeChange(
    change('MC-70', summary, description, { origin: 'live' }),
    [liveRunbook(steps)],
    AT,
  );
}

function generate(analysis: ChangeAnalysis, extra: Partial<GenerateRehearsalRequest> = {}) {
  const findingId = analysis.findings[0]?.id ?? 'none';
  const result = generateRehearsal({ analysis, findingId, restoreTargetMinutes: 30, ...extra });
  if (!result.ok) throw new Error(`${result.error}: ${result.message}`);
  return result.rehearsal;
}

function allDecisions(scenario: SimulationScenario) {
  return Object.values(scenario.steps).flatMap((step) => step.decisions);
}

function run(scenario: SimulationScenario, decisions: string[], id: string): EvaluatedRun {
  const session = replaySession(scenario, decisions, id, START);
  return { scenario, session, evaluation: evaluateSession(scenario, session) };
}

function statuses(r: EvaluatedRun) {
  return Object.fromEntries(r.evaluation.objectives.map((o) => [o.objectiveId, o.status]));
}

function expectValid(rehearsal: GeneratedRehearsal) {
  expect(validateScenario(rehearsal.scenario)).toEqual([]);
  expect(validateRemediationModel(rehearsal.scenario, rehearsal.remediation)).toEqual([]);
}

/** Every remediation effect narrative, so the modelled label can be checked after a fix too. */
function remediationNarratives(rehearsal: GeneratedRehearsal): string[] {
  const out: string[] = [];
  for (const effects of Object.values(rehearsal.remediation.effects)) {
    for (const effect of effects) {
      if (effect.kind === 'replaceDecision') out.push(effect.decision.consequence.narrative);
      if (effect.kind === 'addStep') {
        out.push(...effect.step.decisions.map((d) => d.consequence.narrative));
      }
    }
  }
  return out;
}

describe('generateRehearsal: MC-62 (suspected, from the real M3 engine)', () => {
  const analysis = mc62(false);
  const finding = analysis.findings[0]!;
  const rehearsal = generate(analysis);
  const { scenario } = rehearsal;

  it('starts from the suspected live finding on RB-AUTH-01 step 3', () => {
    expect(finding).toMatchObject({ stepOrder: 3, confidence: 'suspected' });
    expect(finding.subject).toMatchObject({ display: 'LegacyAuth', replacement: 'NimbusID' });
  });

  it('is valid, live, version 1, with a deterministic id and provenance', () => {
    expectValid(rehearsal);
    expect(scenario.origin).toBe('live');
    expect(scenario.version).toBe(1);
    expect(scenario.id).toBe(`rehearsal:MC-62:${finding.id}`);
    expect(rehearsal.remediation).toMatchObject({ scenarioId: scenario.id, baseVersion: 1 });
    expect(rehearsal.provenance).toEqual({
      changeKey: 'MC-62',
      findingId: finding.id,
      confidence: 'suspected',
      consequencesModelled: true,
    });
  });

  it('says the link is suspected and the outcomes are modelled', () => {
    expect(scenario.summary).toContain('suspected, not confirmed');
    expect(scenario.summary).toContain('modelled from the finding');
    expect(scenario.summary).toContain('names NimbusID as the replacement');
  });

  it('labels every consequence and rule as modelled', () => {
    for (const d of allDecisions(scenario)) {
      expect(d.consequence.narrative.startsWith(MODELLED_PREFIX)).toBe(true);
      expect(d.consequence.evidenceIds).toContain('rule:modelled');
    }
    for (const narrative of remediationNarratives(rehearsal)) {
      expect(narrative.startsWith(MODELLED_PREFIX)).toBe(true);
    }
    for (const e of scenario.evidence.filter((e) => e.kind === 'scenario-rule')) {
      expect(e.excerpt!.startsWith(MODELLED_PREFIX)).toBe(true);
    }
  });

  it('copies the finding evidence exactly, links and origin included', () => {
    expect(scenario.evidence.slice(0, 2)).toEqual(finding.evidence);
    expect(scenario.evidence.slice(0, 2).every((e) => e.origin === 'live')).toBe(true);
    expect(scenario.procedure.steps).toEqual([
      { order: 3, instruction: RB_AUTH_STEPS[2], dependsOn: ['legacyauth'] },
    ]);
    expect(scenario.procedure.source).toEqual(finding.evidence[1]);
    expect(scenario.changeContext).toMatchObject({
      key: 'MC-62',
      summary: MC62_SUMMARY,
      url: '/browse/MC-62',
      affectedServiceIds: [],
    });
    expect(scenario.services).toEqual([]);
  });

  it('quotes only exact substrings of the analysis evidence', () => {
    const sources = finding.evidence.map((e) => e.excerpt!);
    expect(MC62_DESCRIPTION).toContain(sources[0]);
    expect(sources[1]).toBe(RB_AUTH_STEPS[2]);
    const texts = [
      ...allDecisions(scenario).flatMap((d) => [d.consequence.narrative, d.detail ?? '']),
      ...Object.values(scenario.steps).map((s) => s.situation),
      ...remediationNarratives(rehearsal),
    ];
    let quotes = 0;
    for (const text of texts) {
      for (const match of text.matchAll(/"([^"]+)"/g)) {
        quotes++;
        expect(sources.some((source) => source.includes(match[1]!))).toBe(true);
      }
    }
    expect(quotes).toBeGreaterThan(3);
  });

  it('offers the demo branching with the named replacement', () => {
    const ids = (step: string) => scenario.steps[step]!.decisions.map((d) => d.id);
    expect(ids('detect')).toEqual(['follow-step', 'check-change', 'bypass-controls']);
    expect(ids('step-failed')).toEqual(['retry-step', 'inspect-change', 'escalate']);
    expect(ids('communicate')).toEqual(['notify-now', 'defer-comms']);
    expect(ids('recover')).toEqual([
      'use-replacement',
      'escalate-owner',
      'wait-primary',
      'bypass-restore',
    ]);
    expect(ids('recover-uninformed')).toEqual([
      'investigate-step',
      'wait-primary-uninformed',
      'bypass-restore-uninformed',
    ]);
    expect(scenario.steps.detect!.title).toBe('LegacyAuth is unavailable during recovery');
    expect(scenario.steps.detect!.situation).toContain(`"${RB_AUTH_STEPS[2]}"`);
    const use = scenario.steps.recover!.decisions[0]!;
    expect(use.label).toBe('Use NimbusID in place of LegacyAuth for step 3');
    expect(use.consequence.assessment).toBe('effective');
  });

  it('meets every objective on the evidence-led path and replays through the audit', () => {
    const best = run(scenario, ['check-change', 'notify-now', 'use-replacement'], 's-best');
    expect(best.session.elapsedMinutes).toBe(16);
    expect(best.evaluation.metCount).toBe(4);
    const record = createAuditRecord(scenario, best.session);
    expect(verifyAuditRecord(record, scenario)).toEqual({ ok: true });
  });

  it('defaults the notify target to 15 minutes and uses the restore target as given', () => {
    expect(DEFAULT_NOTIFY_TARGET_MINUTES).toBe(15);
    expect(scenario.objectives.map((o) => o.rule)).toEqual([
      { kind: 'flagSetWithin', flag: 'recoveryRestored', minutes: 30 },
      { kind: 'flagSetWithin', flag: 'stakeholdersNotified', minutes: 15 },
      { kind: 'flagSet', flag: 'runbookGapIdentified' },
      { kind: 'flagNeverSet', flag: 'securityBypassed' },
    ]);
    const custom = generate(analysis, { restoreTargetMinutes: 240, notifyTargetMinutes: 10 });
    expect(custom.scenario.objectives[0]!.label).toBe('Restore recovery within 240 minutes');
    expect(custom.scenario.objectives[1]!.label).toBe('Notify stakeholders within 10 minutes');
  });

  it('is deterministic and does not mutate the analysis', () => {
    const before = structuredClone(analysis);
    const again = generate(analysis);
    expect(again).toEqual(rehearsal);
    expect(JSON.stringify(again)).toBe(JSON.stringify(rehearsal));
    expect(analysis).toEqual(before);
    again.scenario.evidence[0]!.excerpt = 'changed';
    expect(analysis.findings[0]!.evidence[0]!.excerpt).not.toBe('changed');
  });
});

describe('generateRehearsal: MC-62 (confirmed)', () => {
  it('carries the confirmed link in provenance and summary', () => {
    const analysis = mc62(true);
    expect(analysis.findings[0]!.confidence).toBe('confirmed');
    const rehearsal = generate(analysis);
    expectValid(rehearsal);
    expect(rehearsal.provenance.confidence).toBe('confirmed');
    expect(rehearsal.scenario.summary).toContain('confirmed by an explicit cross-reference');
    expect(rehearsal.scenario.summary).not.toContain('suspected');
  });

  it('keeps a demo-origin analysis marked demo', () => {
    const analysis = analyzeChange(
      change('DEMO-101', MC62_SUMMARY, MC62_DESCRIPTION),
      [runbook('98305', RB_TITLE, RB_AUTH_STEPS)],
      AT,
    );
    const rehearsal = generate(analysis);
    expect(rehearsal.scenario.origin).toBe('demo');
    expect(rehearsal.scenario.evidence.every((e) => e.origin === 'demo')).toBe(true);
  });
});

describe('generateRehearsal: replacement absent', () => {
  const analysis = analysisFor('Retire LegacyAuth', RB_AUTH_STEPS);
  const rehearsal = generate(analysis);
  const { scenario } = rehearsal;

  it('never invents a replacement option', () => {
    expect(analysis.findings[0]!.subject.replacement).toBeUndefined();
    expectValid(rehearsal);
    expect(allDecisions(scenario).some((d) => d.id === 'use-replacement')).toBe(false);
    expect(scenario.steps.recover!.decisions.map((d) => d.id)).toEqual([
      'escalate-owner',
      'wait-primary',
      'bypass-restore',
    ]);
    expect(JSON.stringify(rehearsal)).not.toContain('NimbusID');
    expect(scenario.summary).toContain('does not name a replacement');
  });

  it('proposes removing the dependency and confirming the replacement', () => {
    const rem = scenario.remediation.find((r) => r.id === 'rem-step')!;
    expect(rem.title).toBe(`Update ${RB_TITLE} step 3`);
    expect(rem.description).toContain(
      'Remove dependency on LegacyAuth — replacement not stated in the change.',
    );
    const effect = rehearsal.remediation.effects['rem-step']!.find(
      (e) => e.kind === 'replaceProcedureStep',
    );
    expect(effect).toMatchObject({ step: { order: 3, dependsOn: [] } });
    if (effect?.kind !== 'replaceProcedureStep') throw new Error('missing step effect');
    expect(effect.step.instruction).toContain('must be confirmed');
    expect(effect.step.instruction).toContain(RB_AUTH_STEPS[2]);
  });
});

describe('generateRehearsal: each ChangeAction', () => {
  const cases: {
    action: ChangeAction;
    summary: string;
    step: string;
    display: string;
    replacement?: string;
  }[] = [
    {
      action: 'retire',
      summary: 'Retire LegacyAuth',
      step: RB_AUTH_STEPS[2]!,
      display: 'LegacyAuth',
    },
    {
      action: 'disable',
      summary: 'Disable AutoHeal',
      step: 'If nodes stay unhealthy, let AutoHeal restart them.',
      display: 'AutoHeal',
    },
    {
      action: 'replace',
      summary: 'Replace VaultKeeper with KeyNest',
      step: 'Fetch the break-glass secret from VaultKeeper.',
      display: 'VaultKeeper',
      replacement: 'KeyNest',
    },
    {
      action: 'migrate',
      summary: 'Move SessionStore to Redis7',
      step: 'Flush the SessionStore cache.',
      display: 'SessionStore',
      replacement: 'Redis7',
    },
    {
      action: 'rename',
      summary: 'Rename `payments-api` to `billing-api`',
      step: 'Redeploy payments-api from the last good build.',
      display: 'payments-api',
      replacement: 'billing-api',
    },
    {
      action: 'upgrade',
      summary: 'Upgrade Kafka to 3.7',
      step: 'Restart the Kafka consumers in the secondary region.',
      display: 'Kafka',
    },
  ];

  it.each(cases)('$action: rules, options and remediation', (c) => {
    const analysis = analysisFor(c.summary, ['Confirm the alert.', c.step]);
    const finding = analysis.findings[0]!;
    expect(finding.subject).toMatchObject({ action: c.action, display: c.display });
    expect(finding.subject.replacement).toBe(c.replacement);

    const rehearsal = generate(analysis);
    expectValid(rehearsal);
    const { scenario } = rehearsal;
    const follow = scenario.steps.detect!.decisions.find((d) => d.id === 'follow-step')!;
    const rule = ACTION_RULES[c.action];
    expect(follow.consequence).toMatchObject({
      minutes: rule.minutes,
      assessment: rule.assessment,
    });
    expect(follow.consequence.setFlags ?? []).not.toContain('recoveryRestored');
    expect(follow.detail).toBe(c.step);

    const hasReplacementOption = allDecisions(scenario).some((d) => d.id === 'use-replacement');
    expect(hasReplacementOption).toBe(c.replacement !== undefined);
    if (c.replacement) {
      expect(scenario.remediation[0]!.description).toContain(c.replacement);
    }
    for (const d of allDecisions(scenario)) {
      expect(d.consequence.narrative.startsWith(MODELLED_PREFIX)).toBe(true);
    }
    expect(scenario.evidence.slice(0, 2)).toEqual(finding.evidence);
  });

  it('is milder for rename and upgrade than for removals', () => {
    for (const action of ['retire', 'disable', 'replace', 'migrate'] as const) {
      expect(ACTION_RULES[action]).toMatchObject({
        assessment: 'harmful',
        minutes: REHEARSAL_MINUTES.followBlocked,
      });
    }
    for (const action of ['rename', 'upgrade'] as const) {
      expect(ACTION_RULES[action]).toMatchObject({
        assessment: 'neutral',
        minutes: REHEARSAL_MINUTES.followReview,
      });
    }
    expect(REHEARSAL_MINUTES.followReview).toBeLessThan(REHEARSAL_MINUTES.followBlocked);
  });

  it('words the upgrade remediation as a review, not a removal', () => {
    const rehearsal = generate(analysisFor('Upgrade Kafka to 3.7', ['Restart Kafka consumers.']));
    expect(rehearsal.scenario.remediation[0]!.description).toContain(
      'Review step 1 against the Kafka upgrade',
    );
    expect(rehearsal.scenario.steps.detect!.title).toBe(
      'Step 1 meets an upgraded Kafka during recovery',
    );
  });
});

describe('generateRehearsal: errors', () => {
  const analysis = mc62(false);
  const findingId = analysis.findings[0]!.id;
  const request = { analysis, findingId, restoreTargetMinutes: 30 };

  it('FINDING_NOT_FOUND for an unknown finding id', () => {
    const result = generateRehearsal({ ...request, findingId: 'MC-62:nope' });
    expect(result).toMatchObject({ ok: false, error: 'FINDING_NOT_FOUND' });
  });

  it('ANALYSIS_NOT_USABLE when the analysis has no findings', () => {
    const notAssessed = analyzeChange(
      change('MC-63', 'Tidy dashboards', null, { origin: 'live' }),
      [],
      AT,
    );
    expect(notAssessed.status).toBe('not-assessed');
    expect(generateRehearsal({ ...request, analysis: notAssessed })).toMatchObject({
      ok: false,
      error: 'ANALYSIS_NOT_USABLE',
    });
    const noFindings = analysisFor('Retire LegacyAuth', ['Restart the web tier.']);
    expect(noFindings.status).toBe('no-findings');
    expect(generateRehearsal({ ...request, analysis: noFindings })).toMatchObject({
      ok: false,
      error: 'ANALYSIS_NOT_USABLE',
    });
  });

  it('ANALYSIS_NOT_USABLE when a quote is missing', () => {
    for (const drop of ['jira-issue', 'confluence-page']) {
      const broken = structuredClone(analysis);
      broken.findings[0]!.evidence = broken.findings[0]!.evidence.filter((e) => e.kind !== drop);
      expect(generateRehearsal({ ...request, analysis: broken })).toMatchObject({
        ok: false,
        error: 'ANALYSIS_NOT_USABLE',
      });
    }
    const empty = structuredClone(analysis);
    empty.findings[0]!.evidence[1]!.excerpt = '  ';
    expect(generateRehearsal({ ...request, analysis: empty })).toMatchObject({
      ok: false,
      error: 'ANALYSIS_NOT_USABLE',
    });
  });

  it.each([
    { restoreTargetMinutes: 4 },
    { restoreTargetMinutes: 1441 },
    { restoreTargetMinutes: 30.5 },
    { restoreTargetMinutes: Number.NaN },
    { restoreTargetMinutes: 30, notifyTargetMinutes: 0 },
    { restoreTargetMinutes: 30, notifyTargetMinutes: 241 },
    { restoreTargetMinutes: 30, notifyTargetMinutes: 1.5 },
  ])('INVALID_TARGET for %o', (targets) => {
    expect(generateRehearsal({ analysis, findingId, ...targets })).toMatchObject({
      ok: false,
      error: 'INVALID_TARGET',
    });
  });

  it('accepts the boundary targets', () => {
    for (const targets of [
      { restoreTargetMinutes: 5, notifyTargetMinutes: 1 },
      { restoreTargetMinutes: 1440, notifyTargetMinutes: 240 },
    ]) {
      expect(generateRehearsal({ analysis, findingId, ...targets }).ok).toBe(true);
    }
  });
});

describe('Detect → Rehearse → Fix → Verify on a generated rehearsal', () => {
  const COSTLY = ['follow-step', 'retry-step', 'notify-now', 'investigate-step', 'use-replacement'];
  const options = { id: 'retest-1', comparedAt: '2026-11-10T11:00:00.000Z' };

  function rehearse() {
    const { scenario, remediation } = generate(mc62(false));
    const original = run(scenario, COSTLY, 's-original');
    return { scenario, remediation, original };
  }

  it('the costly path misses the restore target', () => {
    const { original } = rehearse();
    expect(original.session.elapsedMinutes).toBe(37);
    expect(statuses(original)).toEqual({
      'obj-restore': 'missed',
      'obj-notify': 'missed',
      'obj-gap': 'met',
      'obj-controls': 'met',
    });
  });

  it('fix + retest following the updated step → resolved, and both runs audit cleanly', () => {
    const { scenario, remediation, original } = rehearse();
    const fixed = buildRetest(scenario, original.session, ['rem-step'], remediation);
    expect(fixed.version).toBe(2);
    expect(fixed.procedure.steps[0]!.instruction).toContain('Use NimbusID in place of LegacyAuth');
    expect(validateScenario(fixed)).toEqual([]);
    const retest = run(fixed, ['follow-step', 'notify-restored'], 's-retest');
    expect(retest.session.elapsedMinutes).toBe(11);
    expect(retest.evaluation.metCount).toBe(4);
    const comparison = compareRetest(original, retest, remediation, options);
    expect(comparison.outcome).toBe('resolved');
    expect(comparison.gaps[0]).toMatchObject({ exercised: true, decisionsEffective: true });

    for (const r of [original, retest]) {
      expect(verifyAuditRecord(createAuditRecord(r.scenario, r.session), r.scenario)).toEqual({
        ok: true,
      });
    }
  });

  it('a retest that avoids the step → inconclusive', () => {
    const { scenario, remediation, original } = rehearse();
    const fixed = buildRetest(scenario, original.session, ['rem-step'], remediation);
    const retest = run(fixed, ['check-change', 'notify-now', 'use-replacement'], 's-avoid');
    expect(retest.evaluation.metCount).toBe(4);
    expect(compareRetest(original, retest, remediation, options).outcome).toBe('inconclusive');
  });

  it('a process-only fix (step not updated) → still-failing', () => {
    const { scenario, remediation, original } = rehearse();
    const fixed = buildRetest(scenario, original.session, ['rem-change-check'], remediation);
    const retest = run(fixed, COSTLY, 's-process');
    expect(compareRetest(original, retest, remediation, options).outcome).toBe('still-failing');
  });

  it('without a named replacement the updated step cannot resolve the gap → still-failing', () => {
    const { scenario, remediation } = generate(analysisFor('Retire LegacyAuth', RB_AUTH_STEPS));
    const original = run(
      scenario,
      ['follow-step', 'retry-step', 'notify-now', 'investigate-step', 'escalate-owner'],
      's-original',
    );
    const fixed = buildRetest(scenario, original.session, ['rem-step'], remediation);
    expect(validateScenario(fixed)).toEqual([]);
    const retest = run(fixed, ['follow-step', 'notify-now', 'escalate-owner'], 's-retest');
    expect(statuses(retest)['obj-restore']).toBe('met');
    const comparison = compareRetest(original, retest, remediation, options);
    expect(comparison.outcome).toBe('still-failing');
    expect(comparison.gaps[0]).toMatchObject({ exercised: true, decisionsEffective: false });
  });
});
