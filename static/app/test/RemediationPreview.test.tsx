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
import {
  CREATE_BLOCKED_REASON,
  RemediationPreview,
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
