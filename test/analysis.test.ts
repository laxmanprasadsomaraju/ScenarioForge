import { describe, expect, it } from 'vitest';
import {
  NOT_ASSESSED_CANCELLED,
  NOT_ASSESSED_NO_RUNBOOKS,
  NOT_ASSESSED_NO_STEPS,
  NOT_ASSESSED_NO_SUBJECTS,
  analyzeChange,
  searchTermsForSubjects,
  withCoverage,
} from '../shared/analysis/engine';
import { extractChangeSubjects, readChange } from '../shared/analysis/subjects';
import {
  mentionsIssueKey,
  mentionsTerm,
  normaliseTerm,
  splitSentences,
} from '../shared/analysis/text';
import type { ChangeEvidence, ChangeSubject } from '../shared/analysis/types';
import {
  CASES,
  NOTES,
  RB_AUTH,
  RB_AUTH_LINKED,
  RB_AUTH_NEXT,
  RB_DB,
  RB_PLATFORM,
  change,
  runbook,
} from './fixtures/analysis/cases';

const AT = '2026-11-10T12:00:00.000Z';

const ISSUE_A = change(
  'DEMO-102',
  '[DEMO] Retire LegacyAuth backup SSO tenant',
  'Synthetic change for ScenarioForge testing.\n\nWe will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.',
);

function subjectsOf(summary: string, description: string | null = null): ChangeSubject[] {
  return extractChangeSubjects(change('T-1', summary, description));
}

function termsOf(summary: string, description: string | null = null): string[] {
  return subjectsOf(summary, description).map((s) => s.term);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('splitSentences', () => {
  it('splits on newlines, bullets and sentence ends but keeps hostnames whole', () => {
    const text =
      '- Retire auth.example.com now. Then rest!\n* Second line; third part\n1. Numbered';
    expect(splitSentences(text).map((s) => s.text)).toEqual([
      'Retire auth.example.com now.',
      'Then rest!',
      'Second line;',
      'third part',
      'Numbered',
    ]);
  });

  it('returns exact substrings at their offsets', () => {
    const text = '  • Move `pgbouncer-eu1` to PgCat.\r\n\r\nDone?  Yes.';
    for (const sentence of splitSentences(text)) {
      expect(text.slice(sentence.start, sentence.start + sentence.text.length)).toBe(sentence.text);
    }
  });
});

describe('extractChangeSubjects', () => {
  it('recognises the live issue A: LegacyAuth retired, replaced by NimbusID', () => {
    const subjects = extractChangeSubjects(ISSUE_A);
    expect(subjects).toEqual([
      {
        term: 'legacyauth',
        display: 'LegacyAuth',
        action: 'retire',
        excerpt: 'We will decommission the LegacyAuth tenant on 30 November.',
        replacement: 'NimbusID',
      },
    ]);
  });

  it.each([
    ['Retire LegacyAuth', 'retire', 'legacyauth'],
    ['Decommission OldVault', 'retire', 'oldvault'],
    ['Sunset the BillingV1 API', 'retire', 'billingv1'],
    ['Shut down `ldap-02`', 'retire', 'ldap02'],
    ['Deprecate PaymentsGateway', 'retire', 'paymentsgateway'],
    ['Removal of auth.example.com', 'retire', 'authexamplecom'],
    ['Disable AutoHeal', 'disable', 'autoheal'],
    ['Turn off FeatureGate checks', 'disable', 'featuregate'],
    ['Upgrade Kafka to 3.7', 'upgrade', 'kafka'],
    ['Rename `payments-api` to `billing-api`', 'rename', 'paymentsapi'],
    ['Migrate users from LegacyAuth to NimbusID', 'migrate', 'legacyauth'],
    ['Move SessionStore to Redis7', 'migrate', 'sessionstore'],
    ['Swap Okta for NimbusID', 'replace', 'okta'],
  ])('%s -> %s %s', (summary, action, term) => {
    const [subject] = subjectsOf(summary);
    expect(subject?.action).toBe(action);
    expect(subject?.term).toBe(term);
  });

  it('names the replacement for replace, migrate, rename and "in favour of"', () => {
    expect(subjectsOf('Replace VaultKeeper with KeyNest')[0]?.replacement).toBe('KeyNest');
    expect(subjectsOf('Swap Okta for NimbusID')[0]?.replacement).toBe('NimbusID');
    expect(subjectsOf('Migrate users from LegacyAuth to NimbusID')[0]?.replacement).toBe(
      'NimbusID',
    );
    expect(subjectsOf('Rename `payments-api` to `billing-api`')[0]?.replacement).toBe(
      'billing-api',
    );
    expect(subjectsOf('Retire LegacyAuth in favour of NimbusID')[0]?.replacement).toBe('NimbusID');
    expect(subjectsOf('LegacyAuth will be replaced by NimbusID.')[0]).toMatchObject({
      term: 'legacyauth',
      action: 'replace',
      replacement: 'NimbusID',
    });
    expect(subjectsOf('Retire LegacyAuth', 'NimbusID replaces it.')[0]?.replacement).toBe(
      'NimbusID',
    );
  });

  it('never treats the replacement as a subject', () => {
    expect(termsOf('Replace VaultKeeper with KeyNest')).toEqual(['vaultkeeper']);
    expect(termsOf('NimbusID replaces LegacyAuth')).toEqual(['legacyauth']);
  });

  it('handles passive and headline forms', () => {
    expect(termsOf('The OldVault cluster will be decommissioned on 1 December.')).toEqual([
      'oldvault',
    ]);
    expect(termsOf('LegacyAuth retired')).toEqual(['legacyauth']);
  });

  it('joins capitalised names and trims generic words', () => {
    expect(subjectsOf('Retire the Nimbus Vault cluster')[0]?.display).toBe('Nimbus Vault');
    expect(subjectsOf('Retire Okta Tenant')[0]?.display).toBe('Okta');
  });

  it('takes several names joined by "and"', () => {
    expect(termsOf('Retire LegacyAuth and OldVault')).toEqual(['legacyauth', 'oldvault']);
    expect(termsOf('Retire LegacyAuth and notify Support')).toEqual(['legacyauth']);
  });

  it('quotes every excerpt as an exact substring of the summary or description', () => {
    for (const testCase of CASES) {
      const { summary, descriptionText } = testCase.change;
      for (const subject of extractChangeSubjects(testCase.change)) {
        expect(
          summary.includes(subject.excerpt) || (descriptionText ?? '').includes(subject.excerpt),
        ).toBe(true);
        expect(subject.excerpt.includes(subject.display)).toBe(true);
        expect(subject.term).toBe(normaliseTerm(subject.display));
      }
    }
  });

  describe('false-positive regressions', () => {
    it.each([
      ['Campaign - Email campaign', null],
      ['Remove the old backup service', null],
      ['Retire Old Backup Service', null],
      ['Shut down the legacy backup server and the old provider tenant', null],
      ['Update auth config', 'Tidy up the auth settings.'],
      ['Improve backup', 'Make backups faster.'],
      ['Kafka tuning', 'This upgrade improves Kafka throughput.'],
      ['Move the retro to Friday', null],
      ['Remove MC-12 from the sprint', null],
      ['Upgrade to v2.4.1', null],
      ['Moving forward we keep things simple', null],
      ['[DEMO] Upgrade marketing email templates', 'Refresh the email campaign templates.'],
      ['Remove the self-service sign-in flow', null],
    ])('no subject from %j', (summary, description) => {
      expect(subjectsOf(summary, description)).toEqual([]);
    });
  });

  describe('cancellation', () => {
    it('drops subjects of negated or cancelled sentences', () => {
      expect(termsOf('Cancelled: we will no longer retire LegacyAuth')).toEqual([]);
      expect(termsOf("We won't retire LegacyAuth")).toEqual([]);
      expect(termsOf('We will not decommission OldVault this year')).toEqual([]);
      expect(
        termsOf('Retire LegacyAuth', 'The retirement of LegacyAuth is no longer planned.'),
      ).toEqual([]);
    });

    it('a later cancellation overrides an earlier retirement of the same term', () => {
      const reading = readChange(
        change('T-2', 'Retire LegacyAuth and OldVault', "We won't retire LegacyAuth after all."),
      );
      expect(reading.subjects.map((s) => s.term)).toEqual(['oldvault']);
      expect(reading.cancelledNames).toEqual(['LegacyAuth']);
    });

    it('cancels the whole change for unnamed cancellation wording or a cancelled status', () => {
      expect(
        readChange(change('T-3', 'Retire LegacyAuth', 'This change was cancelled.'))
          .changeCancelled,
      ).toBe(true);
      expect(
        readChange(change('T-4', 'Retire LegacyAuth', null, { status: 'Cancelled' }))
          .changeCancelled,
      ).toBe(true);
      expect(
        readChange(change('T-5', 'Retire LegacyAuth', null, { status: 'Done' })).changeCancelled,
      ).toBe(false);
    });

    it('keeps a rollback plan from cancelling the change', () => {
      expect(
        termsOf('Retire LegacyAuth', 'Rollback plan: re-enable the tenant if logins fail.'),
      ).toEqual(['legacyauth']);
    });
  });

  describe('historical references', () => {
    it('skips past-tense background sentences with a past marker', () => {
      expect(
        termsOf(
          'Rotate TLS certificates',
          'LegacyAuth was retired in 2023 and replaced by NimbusID.',
        ),
      ).toEqual([]);
      expect(termsOf('Tune timeouts', 'OldVault was previously decommissioned.')).toEqual([]);
      expect(
        termsOf('Tune timeouts', 'Background: we migrated from LegacyAuth to NimbusID.'),
      ).toEqual([]);
    });

    it('keeps a past-tense statement of the change itself', () => {
      expect(
        termsOf('LegacyAuth decommissioned', 'LegacyAuth was decommissioned on 30 November.'),
      ).toEqual(['legacyauth']);
    });

    it('compares years with the change date, not the clock', () => {
      const future = change('T-6', 'Plan', 'LegacyAuth will be retired in 2027.');
      expect(extractChangeSubjects(future).map((s) => s.term)).toEqual(['legacyauth']);
    });
  });

  it('marks partial scope', () => {
    const reading = readChange(
      change(
        'T-7',
        'Move tenants',
        'Migrate 50% of tenants from LegacyAuth to NimbusID; LegacyAuth stays for EU.',
      ),
    );
    expect(reading.subjects).toEqual([
      {
        term: 'legacyauth',
        display: 'LegacyAuth',
        action: 'migrate',
        excerpt: 'Migrate 50% of tenants from LegacyAuth to NimbusID;',
        replacement: 'NimbusID',
      },
    ]);
    expect(reading.partialTerms).toEqual(['legacyauth']);
    expect(readChange(change('T-8', 'Retire LegacyAuth', null)).partialTerms).toEqual([]);
  });

  it('accepts as a known miss plain lowercase names', () => {
    // Documented limitation: "legacyauth" written in lowercase prose is not distinctive.
    expect(termsOf('Retire the legacyauth fallback')).toEqual([]);
  });
});

describe('mentionsTerm', () => {
  it('matches whole words across case and separators', () => {
    expect(
      mentionsTerm('run `authctl failover --target legacyauth`', 'legacyauth', 'LegacyAuth'),
    ).toBe(true);
    expect(mentionsTerm('Fail over to LegacyAuth.', 'legacyauth', 'LegacyAuth')).toBe(true);
    expect(mentionsTerm('Use legacy-auth', 'legacyauth', 'LegacyAuth')).toBe(true);
    expect(mentionsTerm('Use legacy_auth', 'legacyauth', 'legacyauth')).toBe(true);
    expect(mentionsTerm("LegacyAuth's tokens", 'legacyauth', 'LegacyAuth')).toBe(true);
  });

  it('does not match substrings', () => {
    expect(mentionsTerm('run authctl status', 'auth', 'auth')).toBe(false);
    expect(mentionsTerm('Check OAuth tokens', 'auth', 'auth')).toBe(false);
    expect(mentionsTerm('Use LegacyAuth2', 'legacyauth', 'LegacyAuth')).toBe(false);
    expect(mentionsTerm('Drain pgbouncer-eu2', 'pgbouncereu1', 'pgbouncer-eu1')).toBe(false);
  });
});

describe('mentionsIssueKey', () => {
  it('matches the key as a whole token only', () => {
    expect(mentionsIssueKey('Related change: MC-12', 'MC-12')).toBe(true);
    expect(mentionsIssueKey('See MC-12.', 'MC-12')).toBe(true);
    expect(mentionsIssueKey('See MC-123', 'MC-12')).toBe(false);
    expect(mentionsIssueKey('See XMC-12', 'MC-12')).toBe(false);
    expect(mentionsIssueKey('anything', '')).toBe(false);
  });
});

describe('analyzeChange', () => {
  it('produces the suspected live finding with verbatim evidence and a template explanation', () => {
    const issue = change('DEMO-101', ISSUE_A.summary, ISSUE_A.descriptionText);
    const result = analyzeChange(issue, [RB_AUTH, RB_DB, NOTES], AT);
    expect(result.status).toBe('findings');
    expect(result.analyzedAt).toBe(AT);
    expect(result.coverage).toEqual({
      pagesFound: 3,
      pagesRead: 3,
      pagesWithoutSteps: 1,
      pagesSkipped: 0,
      pagesChecked: [
        expect.objectContaining({ pageId: RB_AUTH.pageId, stepSource: 'ordered-list' }),
        expect.objectContaining({ pageId: RB_DB.pageId, stepSource: 'ordered-list' }),
        expect.objectContaining({ pageId: NOTES.pageId, stepSource: 'none' }),
      ],
    });
    expect(result.change).toEqual({
      key: 'DEMO-101',
      summary: ISSUE_A.summary,
      browsePath: '/browse/DEMO-101',
      updated: '2026-11-09T10:00:00.000Z',
    });
    expect(result.findings[0]!.pageWebuiPath).toBe(RB_AUTH.webuiPath);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding).toMatchObject({
      id: 'DEMO-101:98305:3:legacyauth',
      changeKey: 'DEMO-101',
      pageId: '98305',
      pageTitle: RB_AUTH.title,
      stepOrder: 3,
      confidence: 'suspected',
      basis: ['term-match'],
      aiAssisted: false,
    });
    expect(finding.explanation).toBe(
      'DEMO-101 retires LegacyAuth, but step 3 of [DEMO] RB-AUTH-01 Customer sign-in recovery still depends on it. The change names NimbusID as the replacement. Suspected: the step names the same term, but the change and the page do not reference each other.',
    );
    expect(finding.evidence).toEqual([
      {
        id: 'DEMO-101:98305:3:legacyauth:change',
        origin: 'demo',
        kind: 'jira-issue',
        title: `DEMO-101: ${ISSUE_A.summary}`,
        excerpt: 'We will decommission the LegacyAuth tenant on 30 November.',
        url: '/browse/DEMO-101',
        retrievedAt: issue.retrievedAt,
      },
      {
        id: 'DEMO-101:98305:3:legacyauth:step',
        origin: 'demo',
        kind: 'confluence-page',
        title: `${RB_AUTH.title}, step 3`,
        excerpt: RB_AUTH.steps[2]!.instruction,
        url: `/wiki${RB_AUTH.webuiPath}`,
        retrievedAt: RB_AUTH.retrievedAt,
      },
    ]);
  });

  it('quotes evidence exactly from the Jira and Confluence text', () => {
    for (const testCase of CASES) {
      const result = analyzeChange(testCase.change, testCase.runbooks, AT);
      for (const finding of result.findings) {
        const [jira, page] = finding.evidence;
        const source = `${testCase.change.summary}\n${testCase.change.descriptionText ?? ''}`;
        expect(source.includes(jira!.excerpt!)).toBe(true);
        const step = testCase.runbooks
          .find((r) => r.pageId === finding.pageId)!
          .steps.find((s) => s.order === finding.stepOrder)!;
        expect(page!.excerpt).toBe(step.instruction);
      }
    }
  });

  it('confirms when the page mentions the issue key', () => {
    const [finding] = analyzeChange(ISSUE_A, [RB_AUTH_LINKED], AT).findings;
    expect(finding?.confidence).toBe('confirmed');
    expect(finding?.basis).toEqual(['term-match', 'page-mentions-issue']);
    expect(finding?.explanation).toContain('Confirmed: the page mentions DEMO-102.');
  });

  it('confirms when the issue links the page by id or by webui path', () => {
    const byId = change('X-1', 'Retire LegacyAuth', null, {
      remoteLinks: [
        { title: 'p', url: 'https://x.atlassian.net/wiki/pages/viewpage.action?pageId=98305' },
      ],
    });
    const byPath = change('X-2', 'Retire LegacyAuth', null, {
      remoteLinks: [{ title: 'p', url: `https://x.atlassian.net/wiki${RB_AUTH.webuiPath}` }],
    });
    const otherPage = change('X-3', 'Retire LegacyAuth', null, {
      remoteLinks: [
        { title: 'p', url: 'https://x.atlassian.net/wiki/spaces/S/pages/983051/Other' },
      ],
    });
    for (const issue of [byId, byPath]) {
      const [finding] = analyzeChange(issue, [RB_AUTH], AT).findings;
      expect(finding?.confidence).toBe('confirmed');
      expect(finding?.basis).toEqual(['term-match', 'issue-links-page']);
    }
    expect(analyzeChange(otherPage, [RB_AUTH], AT).findings[0]?.confidence).toBe('suspected');
  });

  it('never confirms on a cross-reference alone, without a term match', () => {
    const result = analyzeChange(change('DEMO-102', 'Retire OldVault', null), [RB_AUTH_LINKED], AT);
    expect(result.status).toBe('no-findings');
    expect(result.findings).toEqual([]);
  });

  it('keeps partial migrations suspected even with a cross-reference and says so', () => {
    const issue = change(
      'DEMO-160',
      'Move tenants to NimbusID',
      'Migrate 50% of tenants from LegacyAuth to NimbusID; LegacyAuth stays for EU.',
    );
    const page = { ...RB_AUTH, text: `${RB_AUTH.text}\nRelated change: DEMO-160` };
    const [finding] = analyzeChange(issue, [page], AT).findings;
    expect(finding?.confidence).toBe('suspected');
    expect(finding?.basis).toEqual(['term-match', 'page-mentions-issue']);
    expect(finding?.explanation).toBe(
      'DEMO-160 migrates part of LegacyAuth to NimbusID, but step 3 of [DEMO] RB-AUTH-01 Customer sign-in recovery still depends on it. The change states a partial scope, so LegacyAuth may still be needed; check which part this step covers. Suspected: the page mentions DEMO-160, but the change is partial.',
    );
  });

  it('does not flag steps that only name the replacement or mark the subject as superseded', () => {
    const result = analyzeChange(
      change('DEMO-170', 'Retire LegacyAuth in favour of NimbusID', null),
      [RB_AUTH_NEXT],
      AT,
    );
    expect(result.status).toBe('no-findings');
  });

  it('caps a step that names both the subject and its replacement at suspected', () => {
    const page = runbook(
      '777',
      'Cutover',
      ['Switch traffic from LegacyAuth to NimbusID.'],
      'DEMO-1',
    );
    const [finding] = analyzeChange(
      change('DEMO-1', 'Retire LegacyAuth in favour of NimbusID', null),
      [page],
      AT,
    ).findings;
    expect(finding?.confidence).toBe('suspected');
    expect(finding?.explanation).toContain('The step also names NimbusID');
  });

  it('ignores runbook text outside the numbered steps', () => {
    const result = analyzeChange(change('X-4', 'Retire LegacyAuth', null), [NOTES, RB_DB], AT);
    expect(result.status).toBe('no-findings');
    expect(result.coverage.pagesWithoutSteps).toBe(1);
  });

  it('reports not-assessed with a reason in each case', () => {
    expect(analyzeChange(change('X-5', 'Add dark mode', null), [RB_AUTH], AT)).toMatchObject({
      status: 'not-assessed',
      notAssessedReason: NOT_ASSESSED_NO_SUBJECTS,
      subjects: [],
      findings: [],
    });
    expect(analyzeChange(change('X-6', 'Retire LegacyAuth', null), [], AT)).toMatchObject({
      status: 'not-assessed',
      notAssessedReason: NOT_ASSESSED_NO_RUNBOOKS,
      coverage: { pagesFound: 0, pagesRead: 0, pagesWithoutSteps: 0, pagesSkipped: 0 },
    });
    expect(analyzeChange(change('X-7', 'Retire LegacyAuth', null), [NOTES], AT)).toMatchObject({
      status: 'not-assessed',
      notAssessedReason: NOT_ASSESSED_NO_STEPS,
    });
    expect(
      analyzeChange(
        change('X-8', 'Retire LegacyAuth', 'This change was cancelled.'),
        [RB_AUTH_LINKED],
        AT,
      ),
    ).toMatchObject({
      status: 'not-assessed',
      notAssessedReason: NOT_ASSESSED_CANCELLED,
      findings: [],
    });
    const named = analyzeChange(
      change('X-9', 'Retire LegacyAuth and OldVault', "We won't retire LegacyAuth or OldVault."),
      [RB_AUTH],
      AT,
    );
    expect(named.status).toBe('not-assessed');
    expect(named.notAssessedReason).toBe(
      'This change says the planned work on LegacyAuth, OldVault is cancelled or will not happen, so no runbook step was checked against it.',
    );
  });

  it('never returns a readiness verdict: no-findings carries no reason and full coverage', () => {
    const result = analyzeChange(change('X-10', 'Retire LegacyAuth', null), [RB_DB], AT);
    expect(result.status).toBe('no-findings');
    expect(result.notAssessedReason).toBeUndefined();
    expect(result.coverage.pagesRead).toBe(1);
    expect(['findings', 'no-findings', 'not-assessed']).toContain(result.status);
  });

  it('orders findings: confirmed first, then page order, then step order', () => {
    const issue = change('DEMO-9', 'Retire LegacyAuth and OldVault', null);
    const pageA = runbook('1', 'A', ['Use OldVault.', 'Use LegacyAuth.']);
    const pageB = runbook('2', 'B', ['Use LegacyAuth.'], 'Related change: DEMO-9');
    const ids = analyzeChange(issue, [pageA, pageB], AT).findings.map((f) => f.id);
    expect(ids).toEqual(['DEMO-9:2:1:legacyauth', 'DEMO-9:1:1:oldvault', 'DEMO-9:1:2:legacyauth']);
  });

  it('reads each page once when the input repeats it', () => {
    const result = analyzeChange(change('X-11', 'Retire LegacyAuth', null), [RB_AUTH, RB_AUTH], AT);
    expect(result.findings).toHaveLength(1);
    expect(result.coverage.pagesRead).toBe(1);
  });

  it('only links steps from ordered lists', () => {
    const prose = { ...RB_AUTH, stepSource: 'none' as const };
    const result = analyzeChange(change('X-12', 'Retire LegacyAuth', null), [prose, RB_DB], AT);
    expect(result.status).toBe('no-findings');
  });

  it('omits the page link when the page has no safe webui path', () => {
    const page = { ...RB_AUTH, webuiPath: '//evil.example/x' };
    const [finding] = analyzeChange(change('X-13', 'Retire LegacyAuth', null), [page], AT).findings;
    expect(finding?.evidence[1]?.url).toBeUndefined();
  });

  it('is deterministic and does not mutate its inputs', () => {
    const issue = deepFreeze(structuredClone(ISSUE_A));
    const pages = deepFreeze(structuredClone([RB_AUTH_LINKED, RB_DB, NOTES, RB_PLATFORM]));
    const before = JSON.stringify([issue, pages]);
    const first = analyzeChange(issue, pages, AT);
    const second = analyzeChange(issue, pages, AT);
    expect(second).toEqual(first);
    expect(JSON.stringify([issue, pages])).toBe(before);
    // Results do not share objects with each other.
    first.subjects[0]!.display = 'changed';
    expect(second.subjects[0]!.display).toBe('LegacyAuth');
  });
});

describe('coverage', () => {
  it('accepts search counts as an optional parameter', () => {
    const result = analyzeChange(change('X-14', 'Retire LegacyAuth', null), [RB_AUTH, NOTES], AT, {
      pagesFound: 7,
      pagesSkipped: 2,
    });
    expect(result.coverage).toEqual({
      pagesFound: 7,
      pagesRead: 2,
      pagesWithoutSteps: 1,
      pagesSkipped: 2,
      pagesChecked: [
        expect.objectContaining({ pageId: RB_AUTH.pageId, stepSource: 'ordered-list' }),
        expect.objectContaining({ pageId: NOTES.pageId, stepSource: 'none' }),
      ],
    });
  });

  it('withCoverage returns a copy with the caller counts', () => {
    const result = analyzeChange(change('X-15', 'Retire LegacyAuth', null), [RB_AUTH], AT);
    const updated = withCoverage(result, 4, 3);
    expect(updated.coverage).toEqual({
      pagesFound: 4,
      pagesRead: 1,
      pagesWithoutSteps: 0,
      pagesSkipped: 3,
      pagesChecked: [expect.objectContaining({ pageId: RB_AUTH.pageId, title: RB_AUTH.title })],
    });
    expect(result.coverage.pagesFound).toBe(1);
    expect(updated.findings).toBe(result.findings);
    expect(withCoverage(result, 0, -1).coverage).toMatchObject({ pagesFound: 1, pagesSkipped: 0 });
  });
});

describe('searchTermsForSubjects', () => {
  const subject = (display: string, term = normaliseTerm(display)): ChangeSubject => ({
    term,
    display,
    action: 'retire',
    excerpt: display,
  });

  it('returns safe, deduplicated terms, at most five', () => {
    expect(
      searchTermsForSubjects([
        subject('LegacyAuth'),
        subject('legacyauth'),
        subject('Nimbus Vault'),
        subject('auth.example.com'),
        subject('a'),
        subject('"; DROP'),
        subject('pgbouncer-eu1'),
        subject('Kafka'),
        subject('OldVault'),
      ]),
    ).toEqual(['LegacyAuth', 'nimbusvault', 'auth.example.com', 'drop', 'pgbouncer-eu1']);
  });

  it('only returns terms matching the CQL-safe pattern', () => {
    const terms = searchTermsForSubjects(CASES.flatMap((c) => extractChangeSubjects(c.change)));
    expect(terms.length).toBeLessThanOrEqual(5);
    for (const term of terms) {
      expect(term).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/);
    }
  });
});

describe('engine purity', () => {
  it('produces the same subjects for the same change every time', () => {
    const changes: ChangeEvidence[] = CASES.map((c) => c.change);
    expect(changes.map(extractChangeSubjects)).toEqual(changes.map(extractChangeSubjects));
  });

  it('marks every finding as not AI-assisted', () => {
    for (const testCase of CASES) {
      for (const finding of analyzeChange(testCase.change, testCase.runbooks, AT).findings) {
        expect(finding.aiAssisted).toBe(false);
      }
    }
  });

  it('only uses the platform runbook fixture where expected', () => {
    expect(analyzeChange(change('X-16', 'Retire PlatformX9', null), [RB_PLATFORM], AT).status).toBe(
      'no-findings',
    );
  });
});
