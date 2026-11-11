import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SimulationsPage } from '../src/pages/Simulations';
import { fixStates } from '../src/components/simulation/FixReview';
import {
  IntegrityStatus,
  INTEGRITY_TEXT,
  type IntegrityState,
} from '../src/components/history/IntegrityStatus';
import { FixApprovalProvider, useFixApprovals } from '../src/lib/fixApprovals';
import { renderInApp } from './helpers';

vi.mock('../src/lib/api', () => ({
  api: { getConnectionStatus: vi.fn(), listRecentChanges: vi.fn() },
}));

type User = ReturnType<typeof userEvent.setup>;

async function choose(user: User, label: string) {
  const options = within(screen.getByRole('list', { name: 'Your options' }));
  await user.click(options.getByRole('button', { name: new RegExp(`^${label}`) }));
}

async function playFirstRun(user: User) {
  await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));
  await choose(user, 'Follow RB-AUTH-01 step 3: fail over to LegacyAuth');
  await choose(user, 'Check the change history');
  await choose(user, 'Post a status update');
  await choose(user, 'Promote NimbusID');
}

const RUNBOOK_FIX = 'Update RB-AUTH-01 step 3 to promote NimbusID';

const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('After-action report', () => {
  it('leads with a scannable summary and collapses repeated evidence', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playFirstRun(user);

    const summary = screen.getByRole('heading', { name: '3 of 4 objectives met' }).parentElement!;
    expect(within(summary).getByText('Modelled time')).toBeInTheDocument();
    expect(within(summary).getByText('Missed deadlines')).toBeInTheDocument();
    expect(within(summary).getByText('Gap found')).toBeInTheDocument();
    for (const title of ['Decision timeline', 'Recovery gap', 'Uncertainties', 'Next actions']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    // Each evidence quote appears once in the trail, however many decisions cite it.
    const quotes = Array.from(document.querySelectorAll('.report-trail .evidence-title')).map(
      (e) => e.textContent,
    );
    expect(new Set(quotes).size).toBe(quotes.length);
    expect(screen.queryByText(/\bM\d\b/)).toBeNull();
  });

  it('keeps proposed, approved, Jira and runbook states apart for each fix', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playFirstRun(user);

    const states = () => screen.getByLabelText(`States of ${RUNBOOK_FIX}`);
    expect(states()).toHaveTextContent('ProposedYes, by this report');
    expect(states()).toHaveTextContent('Approved (simulated, this tab)Not approved');
    expect(states()).toHaveTextContent(
      'Jira work item createdNot available: write permission not granted',
    );
    expect(states()).toHaveTextContent('Runbook updatedNot tracked');

    const fix = screen.getByText(RUNBOOK_FIX).closest('li')!;
    await user.click(within(fix).getByRole('checkbox', { name: 'Approve for the retest' }));
    expect(states()).toHaveTextContent('Approved (simulated, this tab)Approved for the retest');
    // Approving never claims a Jira item or a runbook change.
    expect(states()).toHaveTextContent('Not available: write permission not granted');
    expect(states()).toHaveTextContent('Runbook updatedNot tracked');
  });

  it('describes the four fix states without merging them', () => {
    expect(fixStates('not-approved').map((s) => s.label)).toEqual([
      'Proposed',
      'Approved (simulated, this tab)',
      'Jira work item created',
      'Runbook updated',
    ]);
    expect(fixStates('applied')[1]!.value).toBe('Applied in this retest (demo approval).');
    expect(
      fixStates('approved')
        .slice(2)
        .map((s) => s.value),
    ).toEqual(['Not available: write permission not granted', 'Not tracked']);
  });
});

describe('Retest comparison', () => {
  it('shows the original and the retest side by side, scoped to the simulation', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playFirstRun(user);
    const firstMinutes = screen.getByText('Modelled time').nextElementSibling!.textContent;

    const fix = screen.getByText(RUNBOOK_FIX).closest('li')!;
    await user.click(within(fix).getByRole('checkbox', { name: 'Approve for the retest' }));
    await user.click(screen.getByRole('button', { name: 'Run targeted retest' }));
    await choose(user, 'Follow RB-AUTH-01 step 3: promote NimbusID');
    await choose(user, 'Post a status update');

    const table = screen.getByRole('table', { name: 'Original run and retest, side by side' });
    const row = (name: RegExp) => within(table).getByRole('row', { name });
    expect(cells(row(/^Modelled recovery time/))).toEqual([firstMinutes, '11 min']);
    expect(firstMinutes).toBe('26 min');
    expect(cells(row(/^Objectives met/))).toEqual(['3/4', '4/4']);
    expect(cells(row(/^Missed deadlines/))).toEqual(['1', '0']);
    expect(cells(row(/^Decisions/))).toEqual(['4', '2']);
    expect(cells(row(/^Verdict/))).toEqual(['Gap open', 'Gap resolved in the simulation']);
    expect(screen.getByText(/Resolved in the simulation only\./)).toHaveTextContent(
      'No runbook change or Jira work item is recorded',
    );
    // The retest's fix shows as applied, and still not as a Jira item or runbook change.
    expect(screen.getByLabelText(`States of ${RUNBOOK_FIX}`)).toHaveTextContent(
      'Applied in this retest (demo approval).Jira work item createdNot available',
    );
  });
});

describe('Fix approval store', () => {
  function Probe() {
    const { approvals, setApproved } = useFixApprovals();
    return (
      <>
        <output>{JSON.stringify(approvals)}</output>
        <button onClick={() => setApproved('s1', ['a', 'b'])}>approve</button>
        <button onClick={() => setApproved('s1', [])}>clear</button>
      </>
    );
  }

  it('records approvals per run and clears them when emptied', async () => {
    render(
      <FixApprovalProvider>
        <Probe />
      </FixApprovalProvider>,
    );
    const out = screen.getByRole('status');
    expect(out).toHaveTextContent('{}');
    act(() => screen.getByRole('button', { name: 'approve' }).click());
    expect(out).toHaveTextContent('{"s1":["a","b"]}');
    act(() => screen.getByRole('button', { name: 'clear' }).click());
    expect(out).toHaveTextContent('{}');
  });
});

describe('History integrity states', () => {
  it('names every state in words with an icon', () => {
    const states: IntegrityState[] = ['verified', 'tampered', 'unverifiable', 'unavailable'];
    render(
      <ul>
        {states.map((s) => (
          <li key={s}>
            <IntegrityStatus state={s} />
          </li>
        ))}
      </ul>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Verified',
      'Tampered',
      'Unverifiable',
      'Unavailable',
    ]);
    for (const item of items) expect(item.querySelector('svg')).not.toBeNull();
    expect(items[1]!.querySelector('.badge-danger')).not.toBeNull();
    expect(items[0]!.querySelector('.badge-success')).not.toBeNull();
    expect(INTEGRITY_TEXT.unavailable).toBe('Unavailable');
  });
});
