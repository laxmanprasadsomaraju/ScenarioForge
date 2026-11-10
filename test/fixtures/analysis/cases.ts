/**
 * SYNTHETIC labelled fixtures for the M3 change-to-recovery engine.
 *
 * None of these changes or runbooks is real. RB-AUTH-01, RB-DB-02 and the
 * notes page mirror the synthetic Confluence pages of docs/M2_CONFLUENCE_TEST.md;
 * issue A mirrors docs/M3_LIVE_TEST.md. Labels are what a careful human
 * reviewer expects, written before looking at engine output, so the eval can
 * measure precision and recall honestly (including accepted misses).
 */
import type { ChangeEvidence, RunbookEvidence } from '../../../shared/analysis/types';

export const RETRIEVED_AT = '2026-11-10T09:00:00.000Z';

export function change(
  key: string,
  summary: string,
  descriptionText: string | null,
  extra: Partial<ChangeEvidence> = {},
): ChangeEvidence {
  return {
    origin: 'demo',
    key,
    summary,
    descriptionText,
    status: 'To Do',
    issueType: 'Change',
    updated: '2026-11-09T10:00:00.000Z',
    browsePath: `/browse/${key}`,
    remoteLinks: [],
    retrievedAt: RETRIEVED_AT,
    ...extra,
  };
}

export function runbook(
  pageId: string,
  title: string,
  steps: string[],
  intro = 'Synthetic runbook for ScenarioForge testing. Not a real procedure.',
): RunbookEvidence {
  return {
    origin: 'demo',
    pageId,
    title,
    webuiPath: `/spaces/SFDEMO/pages/${pageId}/${title.replace(/[^A-Za-z0-9]+/g, '+')}`,
    lastUpdated: '2026-11-01T08:00:00.000Z',
    steps: steps.map((instruction, index) => ({ order: index + 1, instruction, dependsOn: [] })),
    stepSource: steps.length > 0 ? 'ordered-list' : 'none',
    text: [intro, ...steps].join('\n'),
    retrievedAt: RETRIEVED_AT,
  };
}

export const RB_AUTH_STEPS = [
  'Confirm elevated sign-in failures on the auth dashboard.',
  'Check the primary IdP status page.',
  'If the primary IdP is unavailable for more than 5 minutes, run `authctl failover --target legacyauth`.',
  'Post a status update to customers.',
];

export const RB_AUTH = runbook(
  '98305',
  '[DEMO] RB-AUTH-01 Customer sign-in recovery',
  RB_AUTH_STEPS,
);

export const RB_DB = runbook('98306', '[DEMO] RB-DB-02 Database failover runbook', [
  'Confirm the primary database is unreachable from two regions.',
  'Promote the read replica in the secondary region.',
  'Update the connection string secret.',
  'Verify writes succeed, then notify the incident channel.',
]);

export const NOTES = runbook(
  '98307',
  '[DEMO] Recovery notes without steps',
  [],
  'Synthetic page for ScenarioForge testing. This page discusses disaster recovery in prose only. LegacyAuth is mentioned here in prose only.',
);

export const RB_AUTH_LINKED = {
  ...RB_AUTH,
  text: `${RB_AUTH.text}\nRelated change: DEMO-102`,
};

export const RB_PLATFORM = runbook('98400', '[DEMO] RB-PLAT-03 Platform recovery', [
  'Rotate the master key in VaultKeeper.',
  'Point the zone apex at ns1.oldhost.net and wait for propagation.',
  'Restart payments-api pods in the primary region.',
  'Drain connections on pgbouncer-eu1 before failover.',
  'Leave pgbouncer-eu2 untouched.',
  'Wait for AutoHeal to replace the failed node.',
  'Restart Kafka brokers one at a time.',
  'Restore secrets from the OldVault snapshot.',
  'Check OAuth token expiry and run authctl status.',
]);

export const RB_AUTH_NEXT = runbook(
  '98500',
  '[DEMO] RB-AUTH-02 Sign-in recovery (NimbusID)',
  [
    'Run `nimbusctl failover --target NimbusID`.',
    'Formerly this step used LegacyAuth; do not use it any more.',
    'Notify the identity team.',
  ],
  'History: LegacyAuth was retired in 2023 and replaced by NimbusID. Synthetic runbook.',
);

export type Category =
  | 'true-positive'
  | 'true-negative'
  | 'cross-reference'
  | 'coverage'
  | 'cancelled'
  | 'historical'
  | 'partial'
  | 'replacement'
  | 'ambiguous'
  | 'accepted-miss';

export interface ExpectedFinding {
  pageId: string;
  stepOrder: number;
  term: string;
  confidence: 'confirmed' | 'suspected';
}

export interface LabelledCase {
  id: string;
  category: Category;
  change: ChangeEvidence;
  runbooks: RunbookEvidence[];
  expected: {
    status: 'findings' | 'no-findings' | 'not-assessed';
    /** Subject terms, in order; omitted when the case does not label them. */
    subjects?: string[];
    findings: ExpectedFinding[];
  };
}

const ISSUE_A_DESCRIPTION =
  'Synthetic change for ScenarioForge testing.\n\nWe will decommission the LegacyAuth tenant on 30 November. NimbusID replaces LegacyAuth as the secondary identity provider.';

export const CASES: LabelledCase[] = [
  {
    id: 'live-issue-a',
    category: 'true-positive',
    change: change('DEMO-101', '[DEMO] Retire LegacyAuth backup SSO tenant', ISSUE_A_DESCRIPTION),
    runbooks: [RB_AUTH, RB_DB, NOTES],
    expected: {
      status: 'findings',
      subjects: ['legacyauth'],
      findings: [{ pageId: '98305', stepOrder: 3, term: 'legacyauth', confidence: 'suspected' }],
    },
  },
  {
    id: 'live-issue-a-page-mentions-key',
    category: 'cross-reference',
    change: change('DEMO-102', '[DEMO] Retire LegacyAuth backup SSO tenant', ISSUE_A_DESCRIPTION),
    runbooks: [RB_AUTH_LINKED, RB_DB],
    expected: {
      status: 'findings',
      findings: [{ pageId: '98305', stepOrder: 3, term: 'legacyauth', confidence: 'confirmed' }],
    },
  },
  {
    id: 'issue-links-page',
    category: 'cross-reference',
    change: change('DEMO-103', 'Retire LegacyAuth', null, {
      remoteLinks: [
        {
          title: 'RB-AUTH-01',
          url: 'https://example.atlassian.net/wiki/spaces/SFDEMO/pages/98305/RB-AUTH-01',
        },
      ],
    }),
    runbooks: [RB_AUTH],
    expected: {
      status: 'findings',
      findings: [{ pageId: '98305', stepOrder: 3, term: 'legacyauth', confidence: 'confirmed' }],
    },
  },
  {
    id: 'replace-with',
    category: 'true-positive',
    change: change(
      'DEMO-104',
      'Replace VaultKeeper with KeyNest',
      'All teams move key storage to KeyNest by Friday.',
    ),
    runbooks: [RB_PLATFORM],
    expected: {
      status: 'findings',
      subjects: ['vaultkeeper'],
      findings: [{ pageId: '98400', stepOrder: 1, term: 'vaultkeeper', confidence: 'suspected' }],
    },
  },
  {
    id: 'migrate-hostname',
    category: 'true-positive',
    change: change(
      'DEMO-105',
      'Migrate DNS from ns1.oldhost.net to Route53',
      '- Migrate DNS from ns1.oldhost.net to Route53\n- Lower TTLs first.',
    ),
    runbooks: [RB_PLATFORM],
    expected: {
      status: 'findings',
      subjects: ['ns1oldhostnet'],
      findings: [{ pageId: '98400', stepOrder: 2, term: 'ns1oldhostnet', confidence: 'suspected' }],
    },
  },
  {
    id: 'rename-backticked',
    category: 'true-positive',
    change: change('DEMO-106', 'Rename `payments-api` to `billing-api`', null),
    runbooks: [RB_PLATFORM],
    expected: {
      status: 'findings',
      subjects: ['paymentsapi'],
      findings: [{ pageId: '98400', stepOrder: 3, term: 'paymentsapi', confidence: 'suspected' }],
    },
  },
  {
    id: 'decommission-backticked-id',
    category: 'true-positive',
    change: change(
      'DEMO-107',
      'Decommission old connection pooler',
      'Decommission `pgbouncer-eu1` after the cutover.',
    ),
    runbooks: [RB_PLATFORM],
    expected: {
      status: 'findings',
      subjects: ['pgbouncereu1'],
      findings: [{ pageId: '98400', stepOrder: 4, term: 'pgbouncereu1', confidence: 'suspected' }],
    },
  },
  {
    id: 'disable-camelcase',
    category: 'true-positive',
    change: change('DEMO-108', 'Disable AutoHeal on the payments cluster', null),
    runbooks: [RB_PLATFORM],
    expected: {
      status: 'findings',
      subjects: ['autoheal'],
      findings: [{ pageId: '98400', stepOrder: 6, term: 'autoheal', confidence: 'suspected' }],
    },
  },
  {
    id: 'upgrade-product-name',
    category: 'true-positive',
    change: change('DEMO-109', 'Platform maintenance', 'We will upgrade Kafka to 3.7 on Sunday.'),
    runbooks: [RB_PLATFORM],
    expected: {
      status: 'findings',
      subjects: ['kafka'],
      findings: [{ pageId: '98400', stepOrder: 7, term: 'kafka', confidence: 'suspected' }],
    },
  },
  {
    id: 'passive-voice',
    category: 'true-positive',
    change: change(
      'DEMO-110',
      'Secrets platform clean-up',
      'The OldVault cluster will be decommissioned on 1 December.',
    ),
    runbooks: [RB_PLATFORM],
    expected: {
      status: 'findings',
      subjects: ['oldvault'],
      findings: [{ pageId: '98400', stepOrder: 8, term: 'oldvault', confidence: 'suspected' }],
    },
  },
  {
    id: 'empty-description',
    category: 'true-positive',
    change: change('DEMO-111', 'Retire LegacyAuth', null),
    runbooks: [RB_AUTH, RB_DB],
    expected: {
      status: 'findings',
      subjects: ['legacyauth'],
      findings: [{ pageId: '98305', stepOrder: 3, term: 'legacyauth', confidence: 'suspected' }],
    },
  },
  {
    id: 'unrelated-change',
    category: 'true-negative',
    change: change('DEMO-120', 'Add dark mode to the settings page', 'Users asked for it.'),
    runbooks: [RB_AUTH, RB_DB, RB_PLATFORM],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'marketing-issue',
    category: 'true-negative',
    change: change(
      'DEMO-121',
      'Campaign - Email campaign',
      'Spring email campaign for customers.',
      {
        issueType: 'Task',
      },
    ),
    runbooks: [RB_AUTH, RB_DB],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'live-issue-b',
    category: 'true-negative',
    change: change(
      'DEMO-122',
      '[DEMO] Upgrade marketing email templates',
      'Synthetic change. Refresh the email campaign templates.',
    ),
    runbooks: [RB_AUTH, RB_DB],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'substring-trap-auth',
    category: 'true-negative',
    change: change('DEMO-123', 'Remove the `auth` DNS alias', null),
    runbooks: [RB_PLATFORM],
    expected: { status: 'no-findings', subjects: ['auth'], findings: [] },
  },
  {
    id: 'generic-words',
    category: 'true-negative',
    change: change(
      'DEMO-124',
      'Remove the old backup service',
      'Shut down the legacy backup server and the old provider tenant.',
    ),
    runbooks: [RB_AUTH, RB_DB],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'title-case-generic',
    category: 'true-negative',
    change: change('DEMO-125', 'Retire Old Backup Service', null),
    runbooks: [RB_DB],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'bare-noun-upgrade',
    category: 'true-negative',
    change: change('DEMO-126', 'Kafka tuning', 'This upgrade improves Kafka throughput.'),
    runbooks: [RB_PLATFORM],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'pages-without-steps-only',
    category: 'coverage',
    change: change('DEMO-130', 'Retire LegacyAuth', null),
    runbooks: [NOTES],
    expected: { status: 'not-assessed', subjects: ['legacyauth'], findings: [] },
  },
  {
    id: 'no-runbooks-read',
    category: 'coverage',
    change: change('DEMO-131', 'Retire LegacyAuth', null),
    runbooks: [],
    expected: { status: 'not-assessed', subjects: ['legacyauth'], findings: [] },
  },
  {
    id: 'no-matching-step',
    category: 'coverage',
    change: change('DEMO-132', 'Retire LegacyAuth', null),
    runbooks: [RB_DB, NOTES],
    expected: { status: 'no-findings', subjects: ['legacyauth'], findings: [] },
  },
  {
    id: 'cancelled-wording',
    category: 'cancelled',
    change: change('DEMO-140', 'Cancelled: we will no longer retire LegacyAuth', null),
    runbooks: [RB_AUTH_LINKED],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'cancelled-later-in-description',
    category: 'cancelled',
    change: change(
      'DEMO-141',
      'Retire LegacyAuth',
      "Update 12 Nov: we won't retire LegacyAuth this quarter.",
    ),
    runbooks: [RB_AUTH],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'cancelled-whole-change',
    category: 'cancelled',
    change: change('DEMO-142', 'Retire LegacyAuth', 'This change was cancelled by the CAB.'),
    runbooks: [RB_AUTH],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'cancelled-status',
    category: 'cancelled',
    change: change('DEMO-143', 'Retire LegacyAuth', null, { status: "Won't Do" }),
    runbooks: [RB_AUTH_LINKED],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'rolled-back',
    category: 'cancelled',
    change: change(
      'DEMO-144',
      'Decommission LegacyAuth',
      'The LegacyAuth decommission was rolled back after the incident.',
    ),
    runbooks: [RB_AUTH],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'historical-background',
    category: 'historical',
    change: change(
      'DEMO-150',
      'Rotate TLS certificates on the edge',
      'LegacyAuth was retired in 2023 and replaced by NimbusID. Rotate the certificates before expiry.',
    ),
    runbooks: [RB_AUTH],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'historical-prefix',
    category: 'historical',
    change: change(
      'DEMO-151',
      'Tune NimbusID session timeouts',
      'Background: we migrated from LegacyAuth to NimbusID.',
    ),
    runbooks: [RB_AUTH],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'runbook-history-note',
    category: 'historical',
    change: change('DEMO-152', 'Retire LegacyAuth', null),
    runbooks: [RB_AUTH_NEXT],
    expected: { status: 'no-findings', subjects: ['legacyauth'], findings: [] },
  },
  {
    id: 'partial-migration',
    category: 'partial',
    change: change(
      'DEMO-160',
      'Move tenants to NimbusID',
      'Migrate 50% of tenants from LegacyAuth to NimbusID; LegacyAuth stays for EU.',
    ),
    runbooks: [{ ...RB_AUTH, text: `${RB_AUTH.text}\nRelated change: DEMO-160` }],
    expected: {
      status: 'findings',
      subjects: ['legacyauth'],
      findings: [{ pageId: '98305', stepOrder: 3, term: 'legacyauth', confidence: 'suspected' }],
    },
  },
  {
    id: 'replacement-only-step',
    category: 'replacement',
    change: change('DEMO-170', 'Retire LegacyAuth in favour of NimbusID', null),
    runbooks: [RB_AUTH_NEXT],
    expected: { status: 'no-findings', subjects: ['legacyauth'], findings: [] },
  },
  {
    id: 'ambiguous-auth-config',
    category: 'ambiguous',
    change: change('DEMO-180', 'Update auth config', 'Tidy up the auth settings.'),
    runbooks: [RB_AUTH],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'ambiguous-improve-backup',
    category: 'ambiguous',
    change: change('DEMO-181', 'Improve backup', 'Make backups faster.'),
    runbooks: [RB_DB],
    expected: { status: 'not-assessed', subjects: [], findings: [] },
  },
  {
    id: 'lowercase-name-miss',
    category: 'accepted-miss',
    change: change('DEMO-190', 'Auth clean-up', 'Retire the legacyauth fallback this sprint.'),
    runbooks: [RB_AUTH],
    expected: {
      status: 'findings',
      subjects: ['legacyauth'],
      findings: [{ pageId: '98305', stepOrder: 3, term: 'legacyauth', confidence: 'suspected' }],
    },
  },
];
