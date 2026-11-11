import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { view } from '@forge/bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeChange } from '@shared/analysis';
import type { ChangeEvidence, RunbookEvidence } from '@shared/analysis/types';
import type { RemediationAction } from '@shared/domain/types';
import { RemediationPreview } from '../src/components/simulation/RemediationPreview';
import { renderInApp } from './helpers';

vi.mock('../src/lib/api', () => ({ api: {} }));

const SITE = 'https://example.atlassian.net';
const AT = '2026-11-10T09:00:00.000Z';
const STEP = 'If the primary IdP is unavailable, run `authctl failover --target legacyauth`.';
const change: ChangeEvidence = {
  origin: 'live',
  key: 'MC-62',
  summary: 'Retire LegacyAuth backup SSO tenant',
  descriptionText: 'We will decommission the LegacyAuth tenant on 30 November.',
  status: 'To Do',
  issueType: 'Change',
  updated: AT,
  browsePath: '/browse/MC-62',
  remoteLinks: [],
  retrievedAt: AT,
};
const page: RunbookEvidence = {
  origin: 'live',
  pageId: '98305',
  title: 'RB-AUTH-01',
  webuiPath: '/spaces/SFDEMO/pages/98305/RB-AUTH-01',
  lastUpdated: AT,
  steps: [{ order: 1, instruction: STEP, dependsOn: [] }],
  stepSource: 'ordered-list',
  text: ['Related change: MC-62', STEP].join('\n'),
  retrievedAt: AT,
};
const analysis = analyzeChange(change, [page], AT);
const finding = analysis.findings[0]!;
const fixes: RemediationAction[] = [
  {
    id: 'rem-step',
    origin: 'live',
    title: 'Update RB-AUTH-01 step 1',
    description: 'Replace the dependency on LegacyAuth.',
    status: 'proposed',
    evidenceIds: [],
  },
];

const dupOf = (decision: 'none' | 'duplicate', issueKey?: string) => ({
  decision,
  label: 'sf-rem-0123456789abcdef',
  ...(issueKey ? { issueKey } : {}),
  matches: issueKey ? [issueKey] : [],
  reason: decision === 'none' ? 'No work item carries the label.' : `${issueKey} carries it.`,
});
const badge = () =>
  within(screen.getByLabelText('Review state')).getByText('Duplicate check').closest('.review-item')
    ?.textContent;

async function destination(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Project key' }), 'OPS');
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Issue type (fixed list for now)' }),
    'Task',
  );
}

beforeEach(() => {
  vi.mocked(view.getContext).mockImplementation(() =>
    Promise.resolve({ siteUrl: SITE, accountId: '557058:me' } as never),
  );
});

describe('RemediationPreview duplicate check before approval', () => {
  it('shows an unrun check, and says so when no search is available', async () => {
    renderInApp(<RemediationPreview analysis={analysis} findingId={finding.id} fixes={fixes} />);
    await screen.findByText(`${SITE}/browse/MC-62`);
    expect(badge()).toContain('Not run yet');
    expect(screen.getByText('Duplicate search is not available in this view.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for duplicates' })).toBeDisabled();
    expect(screen.getByLabelText('Remediation stages')).toHaveTextContent(
      'Runbook updatedNot implemented',
    );
  });

  it('runs a read-only search for the draft on screen and reports an existing item', async () => {
    const user = userEvent.setup();
    const checker = vi.fn().mockResolvedValue({ ok: true, data: dupOf('duplicate', 'OPS-9') });
    renderInApp(
      <RemediationPreview
        analysis={analysis}
        findingId={finding.id}
        fixes={fixes}
        checker={checker}
      />,
    );
    await screen.findByText(`${SITE}/browse/MC-62`);
    await destination(user);
    await user.click(screen.getByRole('button', { name: 'Check for duplicates' }));
    expect(checker).toHaveBeenCalledTimes(1);
    expect(checker.mock.calls[0]![0]).toMatchObject({ projectKey: 'OPS', issueType: 'Task' });
    expect(await screen.findByText('OPS-9 carries it.')).toBeInTheDocument();
    expect(badge()).toContain('Existing OPS-9 found');
  });

  it('forgets the result when the draft changes; a failed search is not assessed', async () => {
    const user = userEvent.setup();
    const checker = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: dupOf('none') })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Jira down' },
      });
    renderInApp(
      <RemediationPreview
        analysis={analysis}
        findingId={finding.id}
        fixes={fixes}
        checker={checker}
      />,
    );
    await screen.findByText(`${SITE}/browse/MC-62`);
    await destination(user);
    await user.click(screen.getByRole('button', { name: 'Check for duplicates' }));
    expect(await screen.findByText('No work item carries the label.')).toBeInTheDocument();
    expect(badge()).toContain('No existing work item found');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Issue type (fixed list for now)' }),
      'Bug',
    );
    expect(badge()).toContain('Not run yet');
    await user.click(screen.getByRole('button', { name: 'Check for duplicates' }));
    expect(await screen.findByText('Duplicate search failed: Jira down')).toBeInTheDocument();
    expect(badge()).toContain('Not assessed');
  });
});
