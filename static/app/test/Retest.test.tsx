import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SimulationsPage } from '../src/pages/Simulations';
import { renderInApp } from './helpers';

vi.mock('../src/lib/api', () => ({
  api: { getConnectionStatus: vi.fn(), listRecentChanges: vi.fn() },
}));

type User = ReturnType<typeof userEvent.setup>;

async function choose(user: User, label: string) {
  const options = within(screen.getByRole('list', { name: 'Your options' }));
  await user.click(options.getByRole('button', { name: new RegExp(`^${label}`) }));
}

/** First run: follows the stale runbook, then recovers once the gap is found. */
async function playFirstRun(user: User) {
  await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));
  await choose(user, 'Follow RB-AUTH-01 step 3: fail over to LegacyAuth');
  await choose(user, 'Check the change history');
  await choose(user, 'Post a status update');
  await choose(user, 'Promote NimbusID');
  expect(
    screen.getByRole('heading', { level: 1, name: 'After-action report' }),
  ).toBeInTheDocument();
}

describe('Fix and retest', () => {
  it('needs an approved fix before a retest can run', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playFirstRun(user);

    const retest = screen.getByRole('button', { name: 'Run targeted retest' });
    expect(retest).toBeDisabled();
    expect(screen.getByText(/creates nothing in Jira/)).toBeInTheDocument();
  });

  it('resolves the gap when the runbook fix is applied and followed', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playFirstRun(user);

    const fix = screen.getByText('Update RB-AUTH-01 step 3 to promote NimbusID').closest('li')!;
    await user.click(within(fix).getByRole('checkbox', { name: 'Approve for the retest' }));
    await user.click(screen.getByRole('button', { name: 'Run targeted retest' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Targeted retest' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('1 approved fix applied');
    await choose(user, 'Follow RB-AUTH-01 step 3: promote NimbusID');
    await choose(user, 'Post a status update');

    expect(screen.getByRole('heading', { level: 1, name: 'Retest report' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Retest verdict: Gap resolved' }),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Objectives before and after the fix' });
    const row = within(table).getByRole('row', { name: /Restore customer sign-in/ });
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Met', 'Met']);
    // The objective was met both times; what the fix changed is the procedure itself.
    const procedure = within(table).getByRole('row', { name: /Following RB-AUTH-01 as written/ });
    expect(
      within(procedure)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Costly', 'Effective']);
    expect(screen.getByText('Applied in this retest (demo approval).')).toBeInTheDocument();
    // A retest compares against its original; it cannot itself be retested.
    expect(screen.queryByRole('button', { name: 'Run targeted retest' })).not.toBeInTheDocument();
  });

  it('reports a process-only fix as not resolving the gap', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playFirstRun(user);

    const fix = screen
      .getByText('Add a recovery-procedure check to identity provider changes')
      .closest('li')!;
    await user.click(within(fix).getByRole('checkbox', { name: 'Approve for the retest' }));
    await user.click(screen.getByRole('button', { name: 'Run targeted retest' }));

    await choose(user, 'Follow RB-AUTH-01 step 3: fail over to LegacyAuth');
    await choose(user, 'Retry the LegacyAuth failover');
    await choose(user, 'Post a status update');
    await choose(user, 'Wait for the primary IdP');

    expect(
      screen.getByRole('heading', { name: 'Retest verdict: Gap still failing' }),
    ).toBeInTheDocument();
  });

  it('calls a retest that avoids the gapped procedure inconclusive', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await playFirstRun(user);

    const fix = screen.getByText('Update RB-AUTH-01 step 3 to promote NimbusID').closest('li')!;
    await user.click(within(fix).getByRole('checkbox', { name: 'Approve for the retest' }));
    await user.click(screen.getByRole('button', { name: 'Run targeted retest' }));

    const options = within(screen.getByRole('list', { name: 'Your options' }));
    await user.click(options.getAllByRole('button')[1]!);
    while (!screen.queryByRole('heading', { level: 1, name: 'Retest report' })) {
      await user.click(
        within(screen.getByRole('list', { name: 'Your options' })).getAllByRole('button')[0]!,
      );
    }
    expect(
      screen.getByRole('heading', { name: 'Retest verdict: Inconclusive' }),
    ).toBeInTheDocument();
  });
});
