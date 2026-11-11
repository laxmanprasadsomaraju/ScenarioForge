import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke, router, view } from '@forge/bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeChange } from '@shared/analysis';
import type { ChangeEvidence, RunbookEvidence } from '@shared/analysis/types';
import type { RemediationAction } from '@shared/domain/types';
import {
  buildWorkItemDraft,
  CREATED_BY_FOOTER,
  FIXED_ISSUE_TYPES,
  REMEDIATION_LABEL,
} from '@shared/remediation';
import { generateRehearsal } from '@shared/rehearsal/generate';
import { evaluateSession } from '@shared/simulation/engine';
import { replaySession } from '@shared/simulation/replay';
import { buildRetest, compareRetest } from '@shared/simulation/retest';
import { api } from '../src/lib/api';
import type { CompletedExercise } from '../src/lib/exercises';
import { Debrief } from '../src/components/simulation/Debrief';
import type { CreateRemediationWorkItemResponse } from '@shared/api';
import {
  CREATE_BLOCKED_REASON,
  CREATE_NEEDS_APPROVAL,
  RemediationPreview,
  RETEST_SUGGESTION,
  type RemediationCreator,
} from '../src/components/simulation/RemediationPreview';
import { renderInApp } from './helpers';

vi.mock('../src/lib/api', () => ({
  api: {
    getConnectionStatus: vi.fn(),
    listRecentChanges: vi.fn(),
    listRecoveryPages: vi.fn(),
    getRecoveryProcedure: vi.fn(),
    analyzeChange: vi.fn(),
    getReadinessGraph: vi.fn(),
  },
}));

const SITE = 'https://example.atlassian.net';
const ACCOUNT = '557058:test-approver';
const AT = '2026-11-10T09:00:00.000Z';
const CHANGE_QUOTE = 'We will decommission the LegacyAuth tenant on 30 November.';
const STEP_QUOTE =
  'If the primary IdP is unavailable for more than 5 minutes, run `authctl failover --target legacyauth`.';
const PAGE = '[DEMO] RB-AUTH-01 Customer sign-in recovery';

const change: ChangeEvidence = {
  origin: 'live',
  key: 'MC-62',
  summary: '[DEMO] Retire LegacyAuth backup SSO tenant',
  descriptionText: `Synthetic change. ${CHANGE_QUOTE} NimbusID replaces LegacyAuth as the secondary identity provider.`,
  status: 'To Do',
  issueType: 'Change',
  updated: AT,
  browsePath: '/browse/MC-62',
  remoteLinks: [],
  retrievedAt: AT,
};
const steps = [
  'Confirm elevated sign-in failures.',
  'Check the primary IdP status page.',
  STEP_QUOTE,
];
const page: RunbookEvidence = {
  origin: 'live',
  pageId: '98305',
  title: PAGE,
  webuiPath: '/spaces/SFDEMO/pages/98305/RB-AUTH-01',
  lastUpdated: AT,
  steps: steps.map((instruction, i) => ({ order: i + 1, instruction, dependsOn: [] })),
  stepSource: 'ordered-list',
  text: ['Related change: MC-62', ...steps].join('\n'),
  retrievedAt: AT,
};
const analysis = analyzeChange(change, [page], AT);
const finding = analysis.findings[0]!;

const fixes: RemediationAction[] = [
  {
    id: 'rem-step',
    origin: 'live',
    title: `Update ${PAGE} step 3`,
    description: 'Replace the dependency on LegacyAuth in step 3 with NimbusID, as named in MC-62.',
    status: 'proposed',
    evidenceIds: [],
  },
  {
    id: 'rem-change-check',
    origin: 'live',
    title: 'Add a recovery-runbook check to changes like MC-62',
    description: 'Changes that retire a dependency should list the runbook steps that rely on it.',
    status: 'proposed',
    evidenceIds: [],
  },
];

function expectedDraft(projectKey: string, issueType: string, fixIndex = 0) {
  const result = buildWorkItemDraft(finding, analysis, undefined, {
    projectKey,
    issueType,
    issueTypes: FIXED_ISSUE_TYPES,
    fix: fixes[fixIndex],
    siteUrl: SITE,
  });
  if (!result.ok) throw new Error(result.message);
  return result.draft;
}

function renderPreview() {
  renderInApp(<RemediationPreview analysis={analysis} findingId={finding.id} fixes={fixes} />);
}

type User = ReturnType<typeof userEvent.setup>;

async function chooseDestination(user: User, key = 'OPS', type = 'Task') {
  await user.type(screen.getByRole('textbox', { name: 'Project key' }), key);
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Issue type (fixed list for now)' }),
    type,
  );
}

const descriptionText = () => screen.getByLabelText('Description', { selector: 'pre' }).textContent;
const statusText = () => screen.getByRole('status').textContent;

function expectNoCalls() {
  expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  expect(vi.mocked(router.open)).not.toHaveBeenCalled();
  for (const fn of Object.values(api)) expect(vi.mocked(fn)).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(view.getContext).mockImplementation(() =>
    Promise.resolve({ siteUrl: SITE, accountId: ACCOUNT } as never),
  );
});

describe('RemediationPreview', () => {
  it('starts with no destination chosen and creation disabled with its reason', async () => {
    const user = userEvent.setup();
    renderPreview();
    expect(screen.getByRole('heading', { name: 'Prepare a Jira work item' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Project key' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Issue type (fixed list for now)' })).toHaveValue(
      '',
    );
    expect(
      within(screen.getByRole('combobox', { name: 'Issue type (fixed list for now)' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a type', 'Task', 'Bug', 'Story']);
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeDisabled();
    expect(screen.getByText(CREATE_BLOCKED_REASON)).toBeInTheDocument();
    expect(CREATE_BLOCKED_REASON).toBe(
      'Creating work items needs the write:jira-work permission (not granted)',
    );
    expect(screen.getByRole('button', { name: 'Approve this exact draft' })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'I have reviewed this exact draft' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Enter the key of the project to create the work item in.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create in Jira' }));
    expectNoCalls();
  });

  it('renders the exact draft verbatim', async () => {
    const user = userEvent.setup();
    renderPreview();
    await screen.findByText(`${SITE}/browse/MC-62`);
    await chooseDestination(user);
    const draft = expectedDraft('OPS', 'Task');

    expect(descriptionText()).toBe(draft.description);
    expect(draft.description).toContain(`\n${CHANGE_QUOTE}\n`);
    expect(draft.description).toContain(`\n${STEP_QUOTE}\n`);
    expect(draft.description.endsWith(CREATED_BY_FOOTER)).toBe(true);

    const rows = within(screen.getByLabelText('Exact draft', { selector: 'dl' }));
    expect(rows.getByText(draft.summary)).toBeInTheDocument();
    expect(draft.summary).toBe(`Update ${PAGE} step 3: LegacyAuth retired by MC-62`);
    expect(rows.getByText('OPS')).toBeInTheDocument();
    expect(rows.getByText('Task')).toBeInTheDocument();
    expect(rows.getByText(REMEDIATION_LABEL)).toBeInTheDocument();
    expect(rows.getByText(draft.labels[1]!)).toBeInTheDocument();
    expect(rows.getByText(`${SITE}/browse/MC-62`)).toBeInTheDocument();
    expect(rows.getByText(`${SITE}/wiki/spaces/SFDEMO/pages/98305/RB-AUTH-01`)).toBeInTheDocument();
    expectNoCalls();
  });

  it('records an approval in memory, then marks it stale when any field changes', async () => {
    const user = userEvent.setup();
    renderPreview();
    await screen.findByText(`${SITE}/browse/MC-62`);
    await chooseDestination(user);

    const reviewed = screen.getByRole('checkbox', { name: 'I have reviewed this exact draft' });
    const approve = screen.getByRole('button', { name: 'Approve this exact draft' });
    expect(statusText()).toBe('Not approved.');
    await user.click(reviewed);
    await user.click(approve);
    expect(statusText()).toMatch(
      /^Approved by you for fingerprint [0-9a-f]{16}\. Held in this tab only; nothing has been created\.$/,
    );
    // Approved is not created: no success colour.
    expect(screen.getByRole('status').querySelector('.approval-note')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeDisabled();

    // Issue type change: stale, and the review checkbox clears.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Issue type (fixed list for now)' }),
      'Bug',
    );
    expect(statusText()).toMatch(/^Approval is stale: the draft changed after you approved it\./);
    expect(reviewed).not.toBeChecked();
    expect(descriptionText()).toBe(expectedDraft('OPS', 'Bug').description);

    // Changing it back restores the exact approved draft, so the approval applies again.
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Issue type (fixed list for now)' }),
      'Task',
    );
    expect(statusText()).toMatch(/^Approved by you/);

    // Project key change: stale.
    await user.type(screen.getByRole('textbox', { name: 'Project key' }), 'X');
    expect(statusText()).toMatch(/^Approval is stale/);
    await user.type(screen.getByRole('textbox', { name: 'Project key' }), '{Backspace}');
    expect(statusText()).toMatch(/^Approved by you/);

    // Summary edit: stale.
    await user.type(screen.getByRole('textbox', { name: 'Summary' }), '!');
    expect(statusText()).toMatch(/^Approval is stale/);
    await user.type(screen.getByRole('textbox', { name: 'Summary' }), '{Backspace}');
    expect(statusText()).toMatch(/^Approved by you/);

    // Fix change (description and idempotency label): stale.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fix' }), 'rem-change-check');
    expect(statusText()).toMatch(/^Approval is stale/);
    expect(descriptionText()).toBe(expectedDraft('OPS', 'Task', 1).description);

    // Re-approving the new draft makes it valid again.
    await user.click(reviewed);
    await user.click(approve);
    expect(statusText()).toMatch(/^Approved by you/);
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeDisabled();
    expectNoCalls();
  });

  it('validates the project key and blocks approval', async () => {
    const user = userEvent.setup();
    renderPreview();
    await user.type(screen.getByRole('textbox', { name: 'Project key' }), 'ops');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Issue type (fixed list for now)' }),
      'Story',
    );
    expect(screen.getByRole('textbox', { name: 'Project key' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      screen.getAllByText(
        'A project key is 2 to 10 capital letters, digits or underscores, starting with a letter.',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('checkbox', { name: 'I have reviewed this exact draft' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve this exact draft' })).toBeDisabled();
    expectNoCalls();
  });

  it('cannot approve without the viewer’s account id', async () => {
    vi.mocked(view.getContext).mockImplementation(() =>
      Promise.resolve({ siteUrl: SITE } as never),
    );
    const user = userEvent.setup();
    renderPreview();
    await screen.findByText(`${SITE}/browse/MC-62`);
    await chooseDestination(user);
    await user.click(screen.getByRole('checkbox', { name: 'I have reviewed this exact draft' }));
    expect(screen.getByRole('button', { name: 'Approve this exact draft' })).toBeDisabled();
    expect(statusText()).toBe(
      'Approval needs your Atlassian account, which this view could not read.',
    );
    expectNoCalls();
  });
});

function createdResponse(
  overrides: Partial<CreateRemediationWorkItemResponse> = {},
): CreateRemediationWorkItemResponse {
  return {
    outcome: 'created',
    issueKey: 'OPS-7',
    issueUrl: `${SITE}/browse/OPS-7`,
    adopted: false,
    issueLink: { status: 'added' },
    remoteLink: { status: 'added' },
    idempotencyLabel: expectedDraft('OPS', 'Task').labels[1]!,
    message: 'OPS-7 was created.',
    ...overrides,
  };
}

describe('RemediationPreview create step', () => {
  async function approveAs(user: User) {
    await screen.findByText(`${SITE}/browse/MC-62`);
    await chooseDestination(user);
    await user.click(screen.getByRole('checkbox', { name: 'I have reviewed this exact draft' }));
    await user.click(screen.getByRole('button', { name: 'Approve this exact draft' }));
  }

  function renderWith(creator: RemediationCreator | null) {
    renderInApp(
      <RemediationPreview
        analysis={analysis}
        findingId={finding.id}
        fixes={fixes}
        creator={creator}
      />,
    );
  }

  const stage = (label: string) =>
    within(screen.getByLabelText('Remediation stages')).getByText(label).closest('.review-item')
      ?.textContent;

  it('stays disabled with its reason after approval when writing is not permitted', async () => {
    const user = userEvent.setup();
    renderWith(null);
    await approveAs(user);
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeDisabled();
    expect(screen.getByText(CREATE_BLOCKED_REASON)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(stage('Approved (simulated)')).toContain('Approved in this tab');
    expect(stage('Jira work item created')).toContain('Not created');
    expect(stage('Runbook updated')).toContain('Not implemented');
    expect(stage('Verified retest')).toContain(RETEST_SUGGESTION);
    expectNoCalls();
  });

  it('needs approval before the create step, then asks for a second confirmation', async () => {
    const user = userEvent.setup();
    const creator = vi.fn<RemediationCreator>(async () => ({ ok: true, data: createdResponse() }));
    renderWith(creator);
    await screen.findByText(`${SITE}/browse/MC-62`);
    await chooseDestination(user);
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeDisabled();
    expect(screen.getByText(CREATE_NEEDS_APPROVAL)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'I have reviewed this exact draft' }));
    await user.click(screen.getByRole('button', { name: 'Approve this exact draft' }));
    await user.click(screen.getByRole('button', { name: 'Create in Jira' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Create 1 work item in OPS as you?' });
    const draft = expectedDraft('OPS', 'Task');
    const items = within(within(dialog).getByRole('list', { name: 'Will be created' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      `Work item: Task in OPS, “${draft.summary}”`,
      `Labels: ${draft.labels.join(', ')}`,
      'Issue link: relates to MC-62',
      `Runbook page link: “${draft.links.remoteLink!.title}”`,
    ]);
    expect(creator).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(creator).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Create in Jira' }));
    await user.click(screen.getByRole('button', { name: 'Create 1 work item' }));
    expect(creator).toHaveBeenCalledTimes(1);
    const [sentDraft, sentApproval] = creator.mock.calls[0]!;
    expect(sentDraft).toEqual(draft);
    expect(sentApproval.approverAccountId).toBe(ACCOUNT);

    const links = await screen.findAllByRole('link', { name: 'OPS-7' });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', `${SITE}/browse/OPS-7`);
    expect(screen.getByText(/Work item created:/)).toBeInTheDocument();
    expect(stage('Jira work item created')).toContain('OPS-7');
    expect(stage('Runbook updated')).toContain('Not implemented');
    expect(stage('Verified retest')).toContain(RETEST_SUGGESTION);
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeDisabled();
    expect(screen.getByText('Created as OPS-7')).toBeInTheDocument();
  });

  it('shows created with follow-up when a link was not added', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({
      ok: true,
      data: createdResponse({
        outcome: 'created-with-follow-up',
        issueLink: {
          status: 'failed',
          message: 'You do not have permission to add the link in this project.',
        },
      }),
    }));
    await approveAs(user);
    await user.click(screen.getByRole('button', { name: 'Create in Jira' }));
    await user.click(screen.getByRole('button', { name: 'Create 1 work item' }));
    expect(await screen.findByText(/Follow-up needed\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Issue link not added: You do not have permission to add the link in this project.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the failure reason and allows another attempt', async () => {
    const user = userEvent.setup();
    renderWith(async () => ({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to create the work item in this project.',
      },
    }));
    await approveAs(user);
    await user.click(screen.getByRole('button', { name: 'Create in Jira' }));
    await user.click(screen.getByRole('button', { name: 'Create 1 work item' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not created: You do not have permission to create the work item in this project.',
    );
    expect(stage('Jira work item created')).toContain('Not created');
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeEnabled();
  });

  it('shows an unknown outcome as checking, and checking again can adopt', async () => {
    const user = userEvent.setup();
    const creator = vi
      .fn<RemediationCreator>()
      .mockResolvedValueOnce({
        ok: true,
        data: createdResponse({
          outcome: 'unknown',
          issueKey: undefined,
          issueUrl: undefined,
          issueLink: { status: 'skipped', reason: 'Not attempted.' },
          remoteLink: { status: 'skipped', reason: 'Not attempted.' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        data: createdResponse({
          issueKey: 'OPS-9',
          issueUrl: `${SITE}/browse/OPS-9`,
          adopted: true,
        }),
      });
    renderWith(creator);
    await approveAs(user);
    await user.click(screen.getByRole('button', { name: 'Create in Jira' }));
    await user.click(screen.getByRole('button', { name: 'Create 1 work item' }));
    expect(await screen.findByText(/Outcome unknown: checking Jira/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Existing work item adopted:/)).toBeInTheDocument();
    expect(creator).toHaveBeenCalledTimes(2);
    expect(stage('Jira work item created')).toContain('OPS-9');
  });
});

describe('Debrief after a retest of a real finding', () => {
  function retestExercise(): CompletedExercise {
    const generated = generateRehearsal({
      analysis,
      findingId: finding.id,
      restoreTargetMinutes: 30,
    });
    if (!generated.ok) throw new Error(generated.message);
    const { scenario, remediation } = generated.rehearsal;
    const play = (s: typeof scenario, decisions: string[], id: string): CompletedExercise => {
      const session = replaySession(s, decisions, id, AT);
      return {
        scenario: s,
        remediation,
        session,
        evaluation: evaluateSession(s, session),
        completedAt: AT,
      };
    };
    const original = play(
      scenario,
      ['follow-step', 'retry-step', 'notify-now', 'investigate-step', 'use-replacement'],
      's-1',
    );
    const fixed = buildRetest(scenario, original.session, ['rem-step'], remediation);
    const retest = play(fixed, ['follow-step', 'notify-restored'], 's-2');
    retest.retest = {
      original,
      appliedRemediationIds: ['rem-step'],
      comparison: compareRetest(original, retest, remediation, { id: 'r-1', comparedAt: AT }),
    };
    return retest;
  }

  it('offers the preview after the verdict and quotes the before and after', async () => {
    const user = userEvent.setup();
    const exercise = retestExercise();
    renderInApp(
      <Debrief
        scenario={exercise.scenario}
        exercise={exercise}
        workItemSource={{ analysis, findingId: finding.id }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Retest verdict: Gap resolved' }),
    ).toBeInTheDocument();
    await screen.findByText(`${SITE}/browse/MC-62`);
    await chooseDestination(user, 'OPS', 'Bug');
    const text = descriptionText() ?? '';
    expect(text).toContain(`Requested fix: Update ${PAGE} step 3`);
    expect(text).toContain('Retest verdict: Gap resolved.');
    expect(text).toMatch(/first run Missed, retest Met/);
    expect(text).toContain('Consequences in the rehearsal were modelled, not observed.');
    expect(screen.getByRole('button', { name: 'Create in Jira' })).toBeDisabled();
    expectNoCalls();
  });

  it('shows no preview for the synthetic demo scenario', () => {
    const exercise = retestExercise();
    renderInApp(<Debrief scenario={exercise.scenario} exercise={exercise} />);
    expect(screen.queryByRole('heading', { name: 'Prepare a Jira work item' })).toBeNull();
  });
});
