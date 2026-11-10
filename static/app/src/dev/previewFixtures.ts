import type { ApiResult } from '@shared/api';
import type { ChangeAnalysis, ChangeSubject } from '@shared/analysis/types';
import type { PreviewMode } from '../lib/preview';

// DEV PREVIEW FIXTURES: used only by the local Vite dev server for visual
// review. Never bundled into the Forge deployment and never shown as Jira data
// (the shell displays a preview banner whenever these are active).
const now = Date.now();
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();

const ISSUES = [
  ['PREVIEW-14', 'Retire legacy backup SSO tenant', 'Done', 'done', 'Change', 3],
  [
    'PREVIEW-13',
    'Move session store to regional cluster',
    'In Progress',
    'indeterminate',
    'Task',
    7,
  ],
  [
    'PREVIEW-12',
    'Rotate signing keys for identity provider',
    'In Review',
    'indeterminate',
    'Task',
    26,
  ],
  ['PREVIEW-11', 'Decommission old DNS failover records', 'To Do', 'new', 'Change', 50],
  ['PREVIEW-10', 'Upgrade database read replicas', 'Done', 'done', 'Story', 96],
  [
    'PREVIEW-9',
    'Sign-in errors after deploy on staging with an unusually long summary to test wrapping',
    'Done',
    'done',
    'Bug',
    200,
  ],
] as const;

const LEGACY_AUTH: ChangeSubject = {
  term: 'legacyauth',
  display: 'LegacyAuth',
  action: 'retire',
  excerpt: 'We will decommission the LegacyAuth tenant on 30 November.',
  replacement: 'NimbusID',
};

function previewAnalysis(issueKey: string): ChangeAnalysis {
  const base = {
    changeKey: issueKey,
    change: { key: issueKey, summary: 'Preview change', browsePath: `/browse/${issueKey}` },
    analyzedAt: iso(0),
  };
  if (issueKey === 'PREVIEW-14') {
    return {
      ...base,
      status: 'findings',
      subjects: [LEGACY_AUTH],
      coverage: {
        pagesFound: 4,
        pagesRead: 3,
        pagesWithoutSteps: 1,
        pagesSkipped: 1,
        pagesChecked: [
          {
            pageId: '1001',
            title: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
            webuiPath: '/spaces/SFDEMO/pages/1001',
            stepSource: 'ordered-list',
          },
          {
            pageId: '1002',
            title: '[DEMO] RB-DB-02 Database failover runbook',
            webuiPath: '/spaces/SFDEMO/pages/1002',
            stepSource: 'ordered-list',
          },
          {
            pageId: '1003',
            title: '[DEMO] Recovery notes without steps',
            webuiPath: '/spaces/SFDEMO/pages/1003',
            stepSource: 'none',
          },
        ],
      },
      findings: [
        {
          id: 'f1',
          changeKey: issueKey,
          pageId: '1001',
          pageTitle: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
          stepOrder: 3,
          pageWebuiPath: '/spaces/SFDEMO/pages/1001',
          subject: LEGACY_AUTH,
          confidence: 'confirmed',
          basis: ['term-match', 'page-mentions-issue'],
          explanation: `Step 3 names LegacyAuth, which ${issueKey} retires, and the page mentions ${issueKey}.`,
          aiAssisted: false,
          evidence: [
            {
              id: 'e1',
              origin: 'live',
              kind: 'jira-issue',
              title: issueKey,
              excerpt: LEGACY_AUTH.excerpt,
            },
            {
              id: 'e2',
              origin: 'live',
              kind: 'runbook-step',
              title: '[DEMO] RB-AUTH-01 Customer sign-in recovery, step 3',
              excerpt:
                'Fail over to the backup identity provider: authctl failover --target legacyauth',
              url: '/spaces/SFDEMO/pages/1001',
            },
          ],
        },
        {
          id: 'f2',
          changeKey: issueKey,
          pageId: '1003',
          pageTitle: '[DEMO] RB-SSO-04 Partner single sign-on outage',
          stepOrder: 2,
          pageWebuiPath: '/spaces/SFDEMO/pages/1001',
          subject: LEGACY_AUTH,
          confidence: 'suspected',
          basis: ['term-match'],
          explanation: `Step 2 names LegacyAuth, which ${issueKey} retires. No explicit link between the change and this page was found.`,
          aiAssisted: false,
          evidence: [
            {
              id: 'e3',
              origin: 'live',
              kind: 'jira-issue',
              title: issueKey,
              excerpt: LEGACY_AUTH.excerpt,
            },
            {
              id: 'e4',
              origin: 'live',
              kind: 'runbook-step',
              title: '[DEMO] RB-SSO-04 Partner single sign-on outage, step 2',
              excerpt:
                'If partner logins fail, route them through LegacyAuth until the primary recovers.',
              url: '/spaces/SFDEMO/pages/1003',
            },
          ],
        },
      ],
    };
  }
  if (issueKey === 'PREVIEW-13') {
    return {
      ...base,
      status: 'no-findings',
      subjects: [
        {
          term: 'session store',
          display: 'session store',
          action: 'migrate',
          excerpt: 'Move the session store to the regional cluster.',
        },
      ],
      findings: [],
      coverage: {
        pagesFound: 5,
        pagesRead: 5,
        pagesWithoutSteps: 0,
        pagesSkipped: 0,
        pagesChecked: [],
      },
    };
  }
  return {
    ...base,
    status: 'not-assessed',
    notAssessedReason:
      'No retirement, replacement, migration, rename, disable or upgrade was recognised in the change text, so no runbook was checked.',
    subjects: [],
    findings: [],
    coverage: {
      pagesFound: 0,
      pagesRead: 0,
      pagesWithoutSteps: 0,
      pagesSkipped: 0,
      pagesChecked: [],
    },
  };
}

export async function previewCall(
  functionKey: string,
  mode: PreviewMode,
  payload?: object,
): Promise<ApiResult<unknown>> {
  await new Promise((r) => setTimeout(r, 400));
  if (mode === 'error') {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to browse these Jira issues.',
        upstreamStatus: 403,
      },
    };
  }
  if (functionKey === 'analyzeChange') {
    const issueKey =
      payload && 'issueKey' in payload && typeof payload.issueKey === 'string'
        ? payload.issueKey
        : '';
    return { ok: true, data: previewAnalysis(issueKey) };
  }
  if (functionKey === 'listRecoveryPages') {
    return {
      ok: true,
      data: {
        pages:
          mode === 'empty'
            ? []
            : [
                {
                  id: '1001',
                  title: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
                  spaceKey: 'SFDEMO',
                  lastUpdated: iso(5),
                  webuiPath: '/spaces/SFDEMO/pages/1001',
                },
                {
                  id: '1002',
                  title: '[DEMO] RB-DB-02 Database failover runbook',
                  spaceKey: 'SFDEMO',
                  lastUpdated: iso(30),
                  webuiPath: '/spaces/SFDEMO/pages/1002',
                },
              ],
        truncated: false,
        fetchedAt: iso(0),
        cql: 'type = page AND (text ~ "runbook" OR text ~ "recovery")',
      },
    };
  }
  if (functionKey === 'getRecoveryProcedure') {
    return {
      ok: true,
      data: {
        pageId: '1001',
        title: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
        spaceId: '1',
        lastUpdated: iso(5),
        webuiPath: '/spaces/SFDEMO/pages/1001',
        excerpt: 'Preview fixture text.',
        excerptTruncated: false,
        steps: [
          { order: 1, instruction: 'Confirm elevated sign-in failures.', dependsOn: [] },
          { order: 2, instruction: 'Check the primary IdP status page.', dependsOn: [] },
          { order: 3, instruction: 'Fail over to LegacyAuth.', dependsOn: [] },
        ],
        stepSource: 'ordered-list',
        evidence: {
          id: 'preview',
          origin: 'live',
          kind: 'confluence-page',
          title: 'Preview fixture',
          retrievedAt: iso(0),
        },
      },
    };
  }
  if (functionKey === 'getConnectionStatus') {
    return {
      ok: true,
      data: { connected: true, userDisplayName: 'Preview user', checkedAt: iso(0) },
    };
  }
  const issues =
    mode === 'empty'
      ? []
      : ISSUES.map(([key, summary, status, statusCategory, issueType, h]) => ({
          key,
          summary,
          status,
          statusCategory,
          issueType,
          projectKey: 'PREVIEW',
          updated: iso(h),
          browsePath: `/browse/${key}`,
        }));
  return {
    ok: true,
    data: {
      issues,
      truncated: false,
      fetchedAt: iso(0),
      jql: 'updated >= -30d ORDER BY updated DESC',
    },
  };
}
