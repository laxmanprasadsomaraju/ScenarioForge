import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { SimulationsPage } from '../src/pages/Simulations';
import { changes, issue, renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
  listRehearsalHistory: vi.fn(),
  saveRehearsalRun: vi.fn(),
  saveRetest: vi.fn(),
  crisisStatus: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

beforeEach(() => {
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
  api.listRecentChanges.mockResolvedValue(changes([issue()]));
  const notEnabled = {
    ok: true,
    data: {
      status: 'UNAVAILABLE',
      detail: 'Rehearsal history is not enabled in this environment.',
    },
  };
  api.listRehearsalHistory.mockResolvedValue(notEnabled);
  api.saveRehearsalRun.mockResolvedValue(notEnabled);
  api.saveRetest.mockResolvedValue(notEnabled);
});

const nav = () => within(screen.getByRole('navigation', { name: 'ScenarioForge' }));

describe('Rehearsal', () => {
  it('plays decisions on the simulated clock through to a debrief', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    expect(screen.getByText('Synthetic demo data')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));

    let decisions = 0;
    while (!screen.queryByRole('heading', { level: 1, name: 'After-action report' })) {
      // Focus lands on the new situation so keyboard users continue from it.
      const situation = document.getElementById('situation-title');
      expect(situation).toHaveFocus();
      const option = within(screen.getByRole('list', { name: 'Your options' })).getAllByRole(
        'button',
      )[0]!;
      const label = option.querySelector('.decision-label')?.textContent ?? '';
      await user.click(option);
      decisions += 1;
      if (!screen.queryByRole('heading', { level: 1, name: 'After-action report' })) {
        // The consequence is announced through the status region that stays mounted.
        const announced = screen
          .getAllByRole('status')
          .some((s) => s.textContent?.includes(`What happened: ${label}`));
        expect(announced).toBe(true);
      }
      expect(decisions).toBeLessThan(12);
    }

    expect(decisions).toBeGreaterThanOrEqual(3);
    const result = screen.getByRole('heading', { level: 2, name: /objectives met$/ });
    expect(result).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Decision timeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rehearse again' })).toBeInTheDocument();
  });

  it('returns focus to the briefing after a rehearsal is discarded', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    await user.click(screen.getByRole('button', { name: 'Leave rehearsal' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('button', { name: 'Start rehearsal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Sign-in outage/ })).toHaveFocus();
  });
});

describe('Crisis room', () => {
  it('says plainly that team rooms need storage and offers the solo rehearsal', async () => {
    api.crisisStatus.mockResolvedValue({
      ok: true,
      data: {
        status: 'UNAVAILABLE',
        detail: 'Team rooms need storage that is not enabled in this environment.',
      },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav().getByRole('link', { name: 'Crisis room' }));

    // Lazy screen: the skeleton shows until its chunk resolves.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Crisis room' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Team rooms need storage that is not enabled in this environment.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open room' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bM[0-9]{1,2}\b/);
    expect(document.body.textContent).not.toMatch(/\blive\b/i);

    await user.click(screen.getByRole('button', { name: 'Rehearse solo instead' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Recovery rehearsal' }),
    ).toBeInTheDocument();
  });
});

describe('Origin labels', () => {
  it('marks live and demo regions on the overview', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Command center' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Live Jira data')).toBeInTheDocument();
    expect(screen.getAllByText('This session').length).toBeGreaterThan(0);
    await screen.findByRole('list', { name: 'Recently updated Jira issues' });
  });

  it('marks in-tab reports as synthetic demo data when history is unavailable', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav().getByRole('link', { name: 'Rehearsals' }));
    await user.click(await screen.findByRole('button', { name: 'Start rehearsal' }));
    for (const label of [
      'Follow RB-AUTH-01 step 3',
      'Check the change history',
      'Post a status update',
      'Promote NimbusID',
    ]) {
      const options = within(screen.getByRole('list', { name: 'Your options' }));
      await user.click(options.getByRole('button', { name: new RegExp(`^${label}`) }));
    }
    await user.click(nav().getByRole('link', { name: 'History' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
    const tab = await screen.findByRole('region', { name: 'This tab only' });
    expect(within(tab).getByText('Synthetic demo')).toBeInTheDocument();
  });
});

describe('Settings', () => {
  it('does not claim Jira is connected when the check fails', async () => {
    api.getConnectionStatus.mockResolvedValue({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Consent required.' },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav().getByRole('link', { name: 'Settings' }));
    const sources = await screen.findByRole('table', { name: 'Connected sources' });
    expect(
      await within(sources).findByRole('row', { name: /^Jira Not connected/ }),
    ).toBeInTheDocument();
    expect(within(sources).queryByRole('row', { name: /^Jira Connected/ })).toBeNull();
    expect(screen.getByText('ScenarioForge needs access to Jira')).toBeInTheDocument();
  });
});
