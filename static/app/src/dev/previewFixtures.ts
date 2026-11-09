import type { ApiResult } from '@shared/api';
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

export async function previewCall(
  functionKey: string,
  mode: PreviewMode,
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
