import type { ApiResult } from '@shared/api';
import type { ChangeAnalysis, ChangeSubject } from '@shared/analysis/types';
import type { EvidenceReference } from '@shared/domain/types';
import type { GraphEdge, ReadinessGraph } from '@shared/graph/types';
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

function quote(id: string, title: string, excerpt: string, url?: string): EvidenceReference {
  return {
    id,
    origin: 'live',
    kind: url?.startsWith('/browse') ? 'jira-issue' : 'runbook-step',
    title,
    excerpt,
    url,
  };
}

function previewGraph(issueKey: string): ReadinessGraph {
  const analysis = previewAnalysis(issueKey);
  const change = `change:${issueKey}`;
  const base = {
    changeKey: issueKey,
    builtAt: iso(0),
    analysis,
    unassessed: [],
  };
  const sources: ReadinessGraph['sources'] = [
    { source: 'jira', status: 'used', detail: `Read ${issueKey}.` },
    { source: 'confluence', status: 'used', detail: '3 of 4 runbook pages read.' },
    { source: 'jsm', status: 'not-connected', detail: 'No service source is connected yet.' },
    {
      source: 'teamwork-graph',
      status: issueKey === 'PREVIEW-14' ? 'used' : 'not-connected',
      detail:
        issueKey === 'PREVIEW-14'
          ? 'Service and owner relations read for 1 page.'
          : 'Teamwork Graph not connected.',
    },
  ];
  if (issueKey !== 'PREVIEW-14') {
    return {
      ...base,
      sources,
      nodes: [
        {
          id: change,
          kind: 'change',
          label: issueKey,
          origin: 'live',
          source: 'jira',
          path: `/browse/${issueKey}`,
        },
        ...analysis.subjects.map((s) => ({
          id: `subject:${s.term}`,
          kind: 'subject' as const,
          label: s.display,
          origin: 'live' as const,
          source: 'm3-analysis' as const,
        })),
      ],
      edges: analysis.subjects.map((s) => ({
        id: `names:${s.term}`,
        kind: 'change-names-subject' as const,
        from: change,
        to: `subject:${s.term}`,
        confidence: 'confirmed' as const,
        basis: `${issueKey} names ${s.display} in its description.`,
        source: 'jira' as const,
        evidence: [quote(`q-${s.term}`, issueKey, s.excerpt, `/browse/${issueKey}`)],
      })),
    };
  }
  const changeQuote = quote('q1', issueKey, LEGACY_AUTH.excerpt, `/browse/${issueKey}`);
  const edges: GraphEdge[] = [
    {
      id: 'e-names',
      kind: 'change-names-subject',
      from: change,
      to: 'subject:legacyauth',
      confidence: 'confirmed',
      basis: `${issueKey} says it retires LegacyAuth.`,
      source: 'jira',
      evidence: [changeQuote],
    },
    {
      id: 'e-replaced',
      kind: 'subject-replaced-by',
      from: 'subject:legacyauth',
      to: 'subject:nimbusid',
      confidence: 'confirmed',
      basis: `${issueKey} names NimbusID as the replacement.`,
      source: 'jira',
      evidence: [changeQuote],
    },
    {
      id: 'e-step3',
      kind: 'step-depends-on-subject',
      from: 'step:1001:3',
      to: 'subject:legacyauth',
      confidence: 'confirmed',
      basis: `Step 3 names LegacyAuth and the page mentions ${issueKey}.`,
      source: 'm3-analysis',
      evidence: [
        changeQuote,
        quote(
          'q2',
          '[DEMO] RB-AUTH-01 Customer sign-in recovery, step 3',
          'Fail over to the backup identity provider: authctl failover --target legacyauth',
          '/spaces/SFDEMO/pages/1001',
        ),
      ],
    },
    {
      id: 'e-page3',
      kind: 'step-in-page',
      from: 'step:1001:3',
      to: 'page:1001',
      confidence: 'confirmed',
      basis: 'Step 3 is item 3 of the numbered list on this page.',
      source: 'confluence',
      evidence: [
        quote(
          'q3',
          '[DEMO] RB-AUTH-01 Customer sign-in recovery',
          'Fail over to the backup identity provider: authctl failover --target legacyauth',
          '/spaces/SFDEMO/pages/1001',
        ),
      ],
    },
    {
      id: 'e-service',
      kind: 'page-recovers-service',
      from: 'page:1001',
      to: 'service:customer-sign-in',
      confidence: 'confirmed',
      basis: 'The page is linked to this service in Teamwork Graph.',
      source: 'teamwork-graph',
      evidence: [
        {
          id: 'q4',
          origin: 'live',
          kind: 'jsm-service',
          title: 'Customer sign-in recovers through RB-AUTH-01',
        },
      ],
    },
    {
      id: 'e-team',
      kind: 'team-owns-service',
      from: 'team:identity-platform',
      to: 'service:customer-sign-in',
      confidence: 'confirmed',
      basis: 'Teamwork Graph lists this team as the owner of the service.',
      source: 'teamwork-graph',
      evidence: [
        {
          id: 'q5',
          origin: 'live',
          kind: 'jsm-service',
          title: 'Identity Platform owns Customer sign-in',
        },
      ],
    },
    {
      id: 'e-step2',
      kind: 'step-depends-on-subject',
      from: 'step:1003:2',
      to: 'subject:legacyauth',
      confidence: 'suspected',
      basis: 'Step 2 names LegacyAuth. No explicit link to the change was found.',
      source: 'm3-analysis',
      evidence: [
        changeQuote,
        quote(
          'q6',
          '[DEMO] RB-SSO-04 Partner single sign-on outage, step 2',
          'If partner logins fail, route them through LegacyAuth until the primary recovers.',
          '/spaces/SFDEMO/pages/1003',
        ),
      ],
    },
    {
      id: 'e-page2',
      kind: 'step-in-page',
      from: 'step:1003:2',
      to: 'page:1003',
      confidence: 'confirmed',
      basis: 'Step 2 is item 2 of the numbered list on this page.',
      source: 'confluence',
      evidence: [
        quote(
          'q7',
          '[DEMO] RB-SSO-04 Partner single sign-on outage',
          'If partner logins fail, route them through LegacyAuth until the primary recovers.',
          '/spaces/SFDEMO/pages/1003',
        ),
      ],
    },
  ];
  return {
    ...base,
    sources,
    nodes: [
      {
        id: change,
        kind: 'change',
        label: issueKey,
        origin: 'live',
        source: 'jira',
        path: `/browse/${issueKey}`,
      },
      {
        id: 'subject:legacyauth',
        kind: 'subject',
        label: 'LegacyAuth',
        origin: 'live',
        source: 'm3-analysis',
      },
      {
        id: 'subject:nimbusid',
        kind: 'subject',
        label: 'NimbusID',
        origin: 'live',
        source: 'jira',
      },
      {
        id: 'step:1001:3',
        kind: 'runbook-step',
        label: 'Step 3',
        origin: 'live',
        source: 'confluence',
      },
      {
        id: 'page:1001',
        kind: 'runbook-page',
        label: '[DEMO] RB-AUTH-01 Customer sign-in recovery',
        origin: 'demo',
        source: 'confluence',
        path: '/wiki/spaces/SFDEMO/pages/1001',
      },
      {
        id: 'service:customer-sign-in',
        kind: 'service',
        label: 'Customer sign-in',
        origin: 'live',
        source: 'teamwork-graph',
      },
      {
        id: 'team:identity-platform',
        kind: 'team',
        label: 'Identity Platform',
        origin: 'live',
        source: 'teamwork-graph',
      },
      {
        id: 'step:1003:2',
        kind: 'runbook-step',
        label: 'Step 2',
        origin: 'live',
        source: 'confluence',
      },
      {
        id: 'page:1003',
        kind: 'runbook-page',
        label: '[DEMO] RB-SSO-04 Partner single sign-on outage',
        origin: 'demo',
        source: 'confluence',
        path: '/wiki/spaces/SFDEMO/pages/1003',
      },
    ],
    edges,
    unassessed: [
      {
        from: 'page:1003',
        expected: 'service',
        source: 'jsm',
        reason: 'No service source is connected yet.',
      },
      {
        from: 'page:1003',
        expected: 'team',
        source: 'teamwork-graph',
        reason: 'No service was found for this page, so no owner could be looked up.',
      },
    ],
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
  if (functionKey === 'getReadinessGraph') {
    const issueKey =
      payload && 'issueKey' in payload && typeof payload.issueKey === 'string'
        ? payload.issueKey
        : '';
    // PREVIEW-12 shows the impact path failing on its own while the findings stay.
    if (issueKey === 'PREVIEW-12') {
      return {
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: 'The readiness graph could not be built.',
          upstreamStatus: 502,
        },
      };
    }
    return { ok: true, data: previewGraph(issueKey) };
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
