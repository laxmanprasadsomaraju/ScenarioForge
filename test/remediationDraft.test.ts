import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeChange } from '../shared/analysis';
import type { ChangeAnalysis } from '../shared/analysis/types';
import { generateRehearsal } from '../shared/rehearsal/generate';
import {
  approveDraft,
  buildDuplicateJql,
  buildWorkItemDraft,
  checkApproval,
  CREATED_BY_FOOTER,
  decideDuplicate,
  draftHash,
  FIXED_ISSUE_TYPES,
  idempotencyLabel,
  initialState,
  jqlString,
  MAX_DESCRIPTION_LENGTH,
  REMEDIATION_LABEL,
  RemediationError,
  sha256Hex,
  transition,
  validateDraft,
  type BuildDraftOptions,
  type DraftRehearsalResult,
  type DuplicateCheck,
  type RemediationEvent,
  type RemediationState,
  type WorkItemDraft,
} from '../shared/remediation';
import { evaluateSession } from '../shared/simulation/engine';
import { canonicalJson, replaySession } from '../shared/simulation/replay';
import { buildRetest, compareRetest } from '../shared/simulation/retest';
import type { EvaluatedRun } from '../shared/simulation/types';
import { change, RB_AUTH_STEPS, runbook } from './fixtures/analysis/cases';

/**
 * M8 remediation drafts (pure). Built from the MC-62 / RB-AUTH-01 synthetic
 * live-test texts, so the quotes are the real engine output.
 */

const AT = '2026-11-10T09:30:00.000Z';
const SITE = 'https://example.atlassian.net';
const ME = '557058:aaaa-bbbb';
const SOMEONE_ELSE = '557058:cccc-dddd';
const MC62_SUMMARY = '[DEMO] Retire LegacyAuth backup SSO tenant';
const MC62_DESCRIPTION =
  'Synthetic change for ScenarioForge testing.\n\nWe will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';
const RB_TITLE = '[DEMO] RB-AUTH-01 Customer sign-in recovery';
const CHANGE_QUOTE = 'We will decommission the LegacyAuth tenant on 30 November.';
const STEP_QUOTE = RB_AUTH_STEPS[2]!;

function mc62(): ChangeAnalysis {
  return analyzeChange(
    change('MC-62', MC62_SUMMARY, MC62_DESCRIPTION, { origin: 'live' }),
    [{ ...runbook('98305', RB_TITLE, RB_AUTH_STEPS, 'Related change: MC-62'), origin: 'live' }],
    AT,
  );
}

const analysis = mc62();
const finding = analysis.findings[0]!;

const FIX = {
  id: 'rem-step',
  title: `Update ${RB_TITLE} step 3`,
  description: 'Replace the dependency on LegacyAuth in step 3 with NimbusID, as named in MC-62.',
};

const BASE: BuildDraftOptions = {
  projectKey: 'OPS',
  issueType: 'Task',
  issueTypes: FIXED_ISSUE_TYPES,
  fix: FIX,
  siteUrl: SITE,
};

function build(options: Partial<BuildDraftOptions> = {}, rehearsal?: DraftRehearsalResult) {
  const result = buildWorkItemDraft(finding, analysis, rehearsal, { ...BASE, ...options });
  if (!result.ok) throw new Error(`${result.error}: ${result.message}`);
  return result.draft;
}

function retestResult(): DraftRehearsalResult {
  const generated = generateRehearsal({
    analysis,
    findingId: finding.id,
    restoreTargetMinutes: 30,
  });
  if (!generated.ok) throw new Error(generated.message);
  const { scenario, remediation } = generated.rehearsal;
  const run = (s: typeof scenario, decisions: string[], id: string): EvaluatedRun => {
    const session = replaySession(s, decisions, id, '2026-11-10T10:00:00.000Z');
    return { scenario: s, session, evaluation: evaluateSession(s, session) };
  };
  const original = run(
    scenario,
    ['follow-step', 'retry-step', 'notify-now', 'investigate-step', 'use-replacement'],
    's-1',
  );
  const fixed = buildRetest(scenario, original.session, ['rem-step'], remediation);
  const retest = run(fixed, ['follow-step', 'notify-restored'], 's-2');
  const comparison = compareRetest(original, retest, remediation, {
    id: 'retest-1',
    comparedAt: '2026-11-10T11:00:00.000Z',
  });
  return {
    comparison,
    objectiveLabels: Object.fromEntries(fixed.objectives.map((o) => [o.id, o.label])),
  };
}

describe('buildWorkItemDraft', () => {
  it('the analysis has the confirmed MC-62 finding these tests rely on', () => {
    expect(finding).toMatchObject({ changeKey: 'MC-62', stepOrder: 3, confidence: 'confirmed' });
    expect(finding.subject.excerpt).toBe(CHANGE_QUOTE);
  });

  it('builds the exact draft, including verbatim quotes, links and the footer', () => {
    const draft = build();
    const label = idempotencyLabel('MC-62', finding.id, 'rem-step');
    const pageUrl = `${SITE}/wiki/spaces/SFDEMO/pages/98305/+DEMO+RB+AUTH+01+Customer+sign+in+recovery`;
    expect(draft).toEqual({
      schemaVersion: 1,
      projectKey: 'OPS',
      issueType: 'Task',
      summary: `Update ${RB_TITLE} step 3: LegacyAuth retired by MC-62`,
      description: [
        'ScenarioForge found a recovery runbook step that depends on something a change affects.',
        `Change: MC-62 ${MC62_SUMMARY}\nLink: ${SITE}/browse/MC-62`,
        `Runbook: ${RB_TITLE}, step 3\nLink: ${pageUrl}`,
        `Finding (confirmed): ${finding.explanation}`,
        `Quoted exactly from MC-62:\n${CHANGE_QUOTE}`,
        `Quoted exactly from ${RB_TITLE}, step 3:\n${STEP_QUOTE}`,
        `Requested fix: ${FIX.title}\n${FIX.description}`,
        'Rehearsal: no retest result for this finding is attached.',
        CREATED_BY_FOOTER,
      ].join('\n\n'),
      labels: [REMEDIATION_LABEL, label],
      links: {
        issueLink: { type: 'Relates', issueKey: 'MC-62', url: `${SITE}/browse/MC-62` },
        remoteLink: {
          globalId: `scenarioforge:finding:${finding.id}`,
          url: pageUrl,
          title: `${RB_TITLE}, step 3`,
        },
      },
      source: {
        changeKey: 'MC-62',
        findingId: finding.id,
        fixId: 'rem-step',
        pageId: '98305',
        stepOrder: 3,
      },
    });
    expect(validateDraft(draft)).toEqual([]);
    expect(label).toMatch(/^sf-rem-[0-9a-f]{16}$/);
  });

  it('quotes both sources character for character', () => {
    const { description } = build();
    expect(description).toContain(`\n${CHANGE_QUOTE}\n`);
    expect(description).toContain(`\n${STEP_QUOTE}\n`);
    expect(STEP_QUOTE).toContain('`authctl failover --target legacyauth`');
  });

  it('includes the rehearsal before and after when a retest is attached', () => {
    const { description } = build({}, retestResult());
    expect(description).toContain(
      'Rehearsal before and after the fix:\nRetest verdict: Gap resolved. The retest followed the corrected procedure and met every tied objective.',
    );
    expect(description).toMatch(/\n- [^\n]+: first run Missed, retest Met\n/);
    expect(description).toContain('Consequences in the rehearsal were modelled, not observed.');
    expect(description.endsWith(`\n\n${CREATED_BY_FOOTER}`)).toBe(true);
  });

  it('ignores a retest that does not assess this finding', () => {
    const result = retestResult();
    const other = { ...result, comparison: { ...result.comparison, gaps: [] } };
    expect(build({}, other).description).toContain(
      'Rehearsal: no retest result for this finding is attached.',
    );
  });

  it('keeps links site-relative without a site URL', () => {
    const draft = build({ siteUrl: null });
    expect(draft.links.issueLink.url).toBe('/browse/MC-62');
    expect(draft.links.remoteLink?.url.startsWith('/wiki/spaces/SFDEMO/')).toBe(true);
    expect(draft.description).toContain('Link: /browse/MC-62');
    expect(validateDraft(draft)).toEqual([]);
  });

  it('refuses an unsafe site URL', () => {
    for (const siteUrl of ['http://example.atlassian.net', 'https://x.net/evil?', 'javascript:1']) {
      const result = buildWorkItemDraft(finding, analysis, undefined, { ...BASE, siteUrl });
      expect(result.ok).toBe(false);
    }
  });

  it('omits the remote link when the page path is unknown', () => {
    const noPath = { ...finding, pageWebuiPath: null };
    const result = buildWorkItemDraft(noPath, { ...analysis, findings: [noPath] }, undefined, BASE);
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.links.remoteLink).toBeNull();
    expect(result.draft.description).toContain(
      'Link: not available (the page path was not returned)',
    );
  });

  it('never assumes the project or issue type', () => {
    const draft = build({ projectKey: '', issueType: '' });
    expect(draft.projectKey).toBe('');
    expect(validateDraft(draft).map((p) => p.field)).toEqual(['projectKey', 'issueType']);
  });

  it('asks for a review when no fix is named, with its own idempotency label', () => {
    const draft = build({ fix: undefined });
    expect(draft.description).toContain(
      'Requested fix: review step 3 against MC-62 and correct it.',
    );
    expect(draft.source.fixId).toBe('review-step');
    expect(draft.labels[1]).not.toBe(build().labels[1]);
  });

  it('rejects a finding that is not in the analysis, or lacks quotes', () => {
    const stranger = { ...finding, id: 'MC-62:1:1:x' };
    expect(buildWorkItemDraft(stranger, analysis, undefined, BASE)).toMatchObject({
      ok: false,
      error: 'FINDING_NOT_FOUND',
    });
    const unquoted = { ...finding, evidence: [] };
    expect(
      buildWorkItemDraft(unquoted, { ...analysis, findings: [unquoted] }, undefined, BASE),
    ).toMatchObject({ ok: false, error: 'ANALYSIS_NOT_USABLE' });
  });

  it('is deterministic', () => {
    expect(build()).toEqual(build());
    expect(draftHash(build())).toBe(draftHash(build()));
  });
});

describe('validateDraft', () => {
  const draft = build();
  const fields = (d: WorkItemDraft) => validateDraft(d).map((p) => p.field);

  it('checks project keys', () => {
    for (const key of ['OPS', 'AB', 'OPS_2', 'A1234567890'.slice(0, 10)]) {
      expect(fields({ ...draft, projectKey: key })).toEqual([]);
    }
    for (const key of ['ops', 'O', '1OPS', 'OPS-1', 'OPS KEY', 'ABCDEFGHIJK', 'OPS"']) {
      expect(fields({ ...draft, projectKey: key })).toEqual(['projectKey']);
    }
  });

  it('checks the issue type against the provided list', () => {
    expect(fields({ ...draft, issueType: 'Epic' })).toEqual(['issueType']);
    expect(validateDraft({ ...draft, issueType: 'Epic' }, ['Epic'])).toEqual([]);
  });

  it('checks the summary', () => {
    expect(fields({ ...draft, summary: '' })).toEqual(['summary']);
    expect(fields({ ...draft, summary: '   ' })).toEqual(['summary']);
    expect(fields({ ...draft, summary: 'a'.repeat(255) })).toEqual([]);
    expect(fields({ ...draft, summary: 'a'.repeat(256) })).toEqual(['summary']);
    expect(fields({ ...draft, summary: 'one\ntwo' })).toEqual(['summary']);
  });

  it('cuts a long template summary to 255 characters', () => {
    const long = { ...finding, pageTitle: 'P'.repeat(400) };
    const result = buildWorkItemDraft(long, { ...analysis, findings: [long] }, undefined, BASE);
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.summary).toHaveLength(255);
    expect(result.draft.summary.endsWith('…')).toBe(true);
  });

  it('checks the description size', () => {
    expect(fields({ ...draft, description: 'x'.repeat(MAX_DESCRIPTION_LENGTH) })).toEqual([]);
    expect(fields({ ...draft, description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) })).toEqual([
      'description',
    ]);
    expect(fields({ ...draft, description: '' })).toEqual(['description']);
  });

  it('checks labels and links', () => {
    expect(fields({ ...draft, labels: [REMEDIATION_LABEL] })).toEqual(['labels']);
    expect(fields({ ...draft, labels: [...draft.labels, 'extra'] })).toEqual(['labels']);
    expect(fields({ ...draft, labels: [REMEDIATION_LABEL, 'sf-rem-0000000000000000'] })).toEqual([
      'labels',
    ]);
    const links = draft.links;
    expect(
      fields({ ...draft, links: { ...links, issueLink: { ...links.issueLink, issueKey: 'X-1' } } }),
    ).toEqual(['links']);
    expect(
      fields({
        ...draft,
        links: { ...links, remoteLink: { ...links.remoteLink!, url: 'javascript:alert(1)' } },
      }),
    ).toEqual(['links']);
  });
});

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with node:crypto on UTF-8 text and block boundaries', () => {
    const samples = ['é', '…', 'Ωmega 🚀', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)];
    samples.push(canonicalJson(build()));
    for (const text of samples) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('approval binding', () => {
  const draft = build();

  it('hashes canonical JSON, so key order does not matter', () => {
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as WorkItemDraft;
    expect(draftHash(reordered)).toBe(draftHash(draft));
    expect(draftHash(draft)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('approves an exact draft and checks it', () => {
    const approval = approveDraft(draft, ME, AT);
    expect(approval).toEqual({
      draftHash: draftHash(draft),
      approverAccountId: ME,
      approvedAt: AT,
    });
    expect(checkApproval(draft, approval, ME)).toBe('valid');
    expect(checkApproval(structuredClone(draft), approval, ME)).toBe('valid');
  });

  it('reports a missing approval', () => {
    expect(checkApproval(draft, null, ME)).toBe('missing');
    expect(checkApproval(draft, undefined, ME)).toBe('missing');
  });

  it('reports an approval by someone else', () => {
    expect(checkApproval(draft, approveDraft(draft, SOMEONE_ELSE, AT), ME)).toBe('wrong-approver');
  });

  it('refuses to approve an invalid draft or without an account id', () => {
    expect(() => approveDraft({ ...draft, projectKey: 'ops' }, ME, AT)).toThrow(RemediationError);
    expect(() => approveDraft(draft, '', AT)).toThrow(RemediationError);
    expect(() => approveDraft(draft, 'a b', AT)).toThrow(RemediationError);
  });

  const edits: [string, (d: WorkItemDraft) => void][] = [
    ['projectKey', (d) => (d.projectKey = 'OPZ')],
    ['issueType', (d) => (d.issueType = 'Bug')],
    ['summary', (d) => (d.summary += '.')],
    ['summary (whitespace only)', (d) => (d.summary += ' ')],
    ['description', (d) => (d.description = d.description.replace('step 3', 'step 4'))],
    ['description (one character)', (d) => (d.description += '\n')],
    ['labels (order)', (d) => d.labels.reverse()],
    ['labels (value)', (d) => (d.labels[1] = 'sf-rem-0000000000000000')],
    ['labels (added)', (d) => d.labels.push('extra')],
    ['issue link key', (d) => (d.links.issueLink.issueKey = 'MC-63')],
    ['issue link url', (d) => (d.links.issueLink.url = '/browse/MC-63')],
    ['remote link url', (d) => (d.links.remoteLink!.url += 'x')],
    ['remote link title', (d) => (d.links.remoteLink!.title += 'x')],
    ['remote link globalId', (d) => (d.links.remoteLink!.globalId += 'x')],
    ['remote link removed', (d) => (d.links.remoteLink = null)],
    ['source finding', (d) => (d.source.findingId += 'x')],
    ['source fix', (d) => (d.source.fixId = 'rem-change-check')],
    ['source step', (d) => (d.source.stepOrder = 4)],
    ['schema version', (d) => ((d as { schemaVersion: number }).schemaVersion = 2)],
  ];

  it.each(edits)('an edit to %s after approval makes it stale', (_field, edit) => {
    const approval = approveDraft(draft, ME, AT);
    const changed = structuredClone(draft);
    edit(changed);
    expect(checkApproval(changed, approval, ME)).toBe('stale');
    expect(checkApproval(draft, approval, ME)).toBe('valid');
  });

  it('a rebuilt draft with a new user choice is stale, the same choice is valid', () => {
    const approval = approveDraft(draft, ME, AT);
    expect(checkApproval(build(), approval, ME)).toBe('valid');
    expect(checkApproval(build({ issueType: 'Story' }), approval, ME)).toBe('stale');
    expect(checkApproval(build({ summary: 'Fix RB-AUTH-01 step 3' }), approval, ME)).toBe('stale');
    expect(checkApproval(build({}, retestResult()), approval, ME)).toBe('stale');
  });

  it('keeps the idempotency label across summary edits and retests', () => {
    expect(build({ summary: 'Another summary' }).labels).toEqual(build().labels);
    expect(build({}, retestResult()).labels).toEqual(build().labels);
    expect(build({ projectKey: 'OTHER' }).labels).toEqual(build().labels);
  });
});

describe('state machine', () => {
  const draft = build();
  const label = draft.labels[1]!;
  const none: DuplicateCheck = decideDuplicate(label, []);

  function step(state: RemediationState, event: RemediationEvent) {
    const result = transition(state, event);
    if (!result.ok) throw new Error(result.reason);
    return result;
  }
  const approved = () => step(initialState(draft), { kind: 'approve', actorAccountId: ME, at: AT });
  const creating = () =>
    step(approved().state, { kind: 'start-create', actorAccountId: ME, at: AT, duplicates: none });

  it('drafted -> approved -> creating -> created, with an audit record each time', () => {
    const a = approved();
    expect(a.state.status).toBe('approved');
    expect(a.audit).toEqual({
      schemaVersion: 1,
      event: 'approve',
      from: 'drafted',
      to: 'approved',
      at: AT,
      actorAccountId: ME,
      draftHash: draftHash(draft),
      idempotencyLabel: label,
      changeKey: 'MC-62',
      findingId: finding.id,
    });
    const c = creating();
    expect(c.state.status).toBe('creating');
    const done = step(c.state, { kind: 'created', issueKey: 'OPS-7', at: AT });
    expect(done.state).toMatchObject({ status: 'created', issueKey: 'OPS-7', adopted: false });
    expect(done.audit).toMatchObject({ from: 'creating', to: 'created', issueKey: 'OPS-7' });
    expect(done.audit.actorAccountId).toBeNull();
  });

  it('creating requires an approval: a drafted item cannot start', () => {
    const result = transition(initialState(draft), {
      kind: 'start-create',
      actorAccountId: ME,
      at: AT,
      duplicates: none,
    });
    expect(result).toEqual({
      ok: false,
      reason: 'Cannot start-create a work item that is drafted.',
    });
  });

  it('creating requires the approver to be the actor', () => {
    const result = transition(approved().state, {
      kind: 'start-create',
      actorAccountId: SOMEONE_ELSE,
      at: AT,
      duplicates: none,
    });
    expect(result).toEqual({ ok: false, reason: 'The approval is wrong-approver.' });
  });

  it('creating refuses a tampered approved state (stale approval)', () => {
    const state = approved().state as Extract<RemediationState, { status: 'approved' }>;
    const tampered = { ...state, draft: { ...state.draft, summary: 'Different' } };
    const result = transition(tampered, {
      kind: 'start-create',
      actorAccountId: ME,
      at: AT,
      duplicates: none,
    });
    expect(result).toEqual({ ok: false, reason: 'The approval is stale.' });
  });

  it('creating refuses unless the duplicate check for this label found none', () => {
    const base = { kind: 'start-create' as const, actorAccountId: ME, at: AT };
    const dup = decideDuplicate(label, [
      { key: 'OPS-3', summary: 'x', labels: [REMEDIATION_LABEL, label] },
    ]);
    expect(transition(approved().state, { ...base, duplicates: dup })).toMatchObject({
      ok: false,
    });
    const otherLabel = decideDuplicate('sf-rem-0000000000000000', []);
    expect(transition(approved().state, { ...base, duplicates: otherLabel })).toEqual({
      ok: false,
      reason: 'The duplicate check searched for a different label.',
    });
  });

  it('an edit drops the approval', () => {
    const edited = step(approved().state, {
      kind: 'edit',
      draft: build({ issueType: 'Bug' }),
      actorAccountId: ME,
      at: AT,
    });
    expect(edited.state).toEqual({ status: 'drafted', draft: build({ issueType: 'Bug' }) });
    expect(
      step(approved().state, { kind: 'revoke', actorAccountId: ME, at: AT }).state.status,
    ).toBe('drafted');
  });

  it('approve refuses an invalid draft', () => {
    const bad = transition(initialState(build({ projectKey: '' })), {
      kind: 'approve',
      actorAccountId: ME,
      at: AT,
    });
    expect(bad.ok).toBe(false);
  });

  it('failure, retry, timeout and adoption', () => {
    const failed = step(creating().state, { kind: 'failed', message: 'HTTP 400', at: AT });
    expect(failed.audit).toMatchObject({ to: 'failed', message: 'HTTP 400' });
    expect(step(failed.state, { kind: 'retry', actorAccountId: ME, at: AT }).state.status).toBe(
      'approved',
    );
    expect(
      transition(failed.state, { kind: 'retry', actorAccountId: SOMEONE_ELSE, at: AT }),
    ).toEqual({ ok: false, reason: 'The approval is wrong-approver.' });

    const unknown = step(creating().state, { kind: 'timed-out', at: AT });
    expect(unknown.state.status).toBe('unknown');
    const found = decideDuplicate(label, [
      { key: 'OPS-9', summary: draft.summary, labels: [REMEDIATION_LABEL, label] },
    ]);
    const adopted = step(unknown.state, { kind: 'adopt', duplicates: found, at: AT });
    expect(adopted.state).toMatchObject({ status: 'created', issueKey: 'OPS-9', adopted: true });
    expect(transition(unknown.state, { kind: 'adopt', duplicates: none, at: AT }).ok).toBe(false);
  });

  it('refuses a created key from another project', () => {
    expect(transition(creating().state, { kind: 'created', issueKey: 'MC-70', at: AT })).toEqual({
      ok: false,
      reason: 'MC-70 is not a work item key in OPS.',
    });
    expect(transition(creating().state, { kind: 'created', issueKey: 'OPS-0', at: AT }).ok).toBe(
      false,
    );
  });

  it('created is final', () => {
    const done = step(creating().state, { kind: 'created', issueKey: 'OPS-7', at: AT }).state;
    const events: RemediationEvent[] = [
      { kind: 'edit', draft, actorAccountId: ME, at: AT },
      { kind: 'approve', actorAccountId: ME, at: AT },
      { kind: 'start-create', actorAccountId: ME, at: AT, duplicates: none },
      { kind: 'failed', message: 'x', at: AT },
      { kind: 'retry', actorAccountId: ME, at: AT },
    ];
    for (const event of events) expect(transition(done, event).ok).toBe(false);
  });

  it('only the listed transitions are allowed', () => {
    expect(transition(initialState(draft), { kind: 'created', issueKey: 'OPS-1', at: AT }).ok).toBe(
      false,
    );
    expect(transition(approved().state, { kind: 'approve', actorAccountId: ME, at: AT }).ok).toBe(
      false,
    );
    expect(
      transition(creating().state, { kind: 'edit', draft, actorAccountId: ME, at: AT }).ok,
    ).toBe(false);
  });
});

describe('duplicate prevention', () => {
  const label = build().labels[1]!;
  const item = (key: string, labels: string[]) => ({ key, summary: 'Update step', labels });

  it('decides none, duplicate and ambiguous', () => {
    expect(decideDuplicate(label, []).decision).toBe('none');
    expect(decideDuplicate(label, [item('OPS-1', [REMEDIATION_LABEL, label])])).toMatchObject({
      decision: 'duplicate',
      issueKey: 'OPS-1',
      matches: ['OPS-1'],
    });
    expect(
      decideDuplicate(label, [
        item('OPS-1', [REMEDIATION_LABEL, label]),
        item('OPS-2', [REMEDIATION_LABEL, label]),
      ]),
    ).toMatchObject({ decision: 'ambiguous', matches: ['OPS-1', 'OPS-2'] });
    expect(decideDuplicate(label, [item('OPS-1', [label])]).decision).toBe('ambiguous');
    expect(decideDuplicate(label, [item('OPS-1', [label.toUpperCase()])]).decision).toBe(
      'ambiguous',
    );
  });

  it('builds the JQL only from a valid idempotency label', () => {
    expect(buildDuplicateJql(label)).toBe(`labels = "${label}" ORDER BY created ASC`);
    for (const bad of [
      '',
      'scenarioforge-remediation',
      'sf-rem-0000',
      `${label}" OR project = X`,
      'sf-rem-000000000000000G',
      `${label}\n`,
    ]) {
      expect(() => buildDuplicateJql(bad)).toThrow();
    }
  });

  it('escapes JQL strings', () => {
    expect(jqlString('plain')).toBe('"plain"');
    expect(jqlString('a"b')).toBe('"a\\"b"');
    expect(jqlString('a\\b')).toBe('"a\\\\b"');
    expect(jqlString('x\\" OR 1=1')).toBe('"x\\\\\\" OR 1=1"');
    expect(() => jqlString('a\nb')).toThrow();
  });
});
