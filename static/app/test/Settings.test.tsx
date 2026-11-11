import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rovo } from '@forge/bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MANIFEST_SCOPES } from '@shared/environment';
import { SettingsPage } from '../src/pages/Settings';
import { AskRovo } from '../src/components/AskRovo';
import { renderInApp } from './helpers';

const api = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(),
  listRehearsalHistory: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

beforeEach(() => {
  vi.mocked(rovo.isEnabled).mockResolvedValue(false);
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
  api.listRehearsalHistory.mockResolvedValue({
    ok: true,
    data: {
      status: 'UNAVAILABLE',
      detail: 'Rehearsal history is not enabled in this environment.',
    },
  });
});

describe('Settings', () => {
  it('lists exactly the declared scopes and claims nothing more', async () => {
    renderInApp(<SettingsPage />);
    const table = screen.getByRole('table', { name: 'Permissions' });
    const scopes = within(table)
      .getAllByRole('rowheader')
      .map((c) => c.textContent);
    expect(scopes).toEqual(MANIFEST_SCOPES.map((s) => s.scope));
    expect(screen.getByText('storage:app')).toBeInTheDocument();
    expect(screen.getByText(/not granted, so saving rehearsal history/)).toBeInTheDocument();
  });

  it('reports AI and history as not enabled when the environment says so', async () => {
    renderInApp(<SettingsPage />);
    const ai = screen.getByRole('region', { name: 'AI availability' });
    expect(within(ai).getByText('Not enabled in this environment')).toBeInTheDocument();
    expect(within(ai).queryByRole('checkbox')).toBeNull();
    expect(within(ai).queryByRole('switch')).toBeNull();
    const history = screen.getByRole('region', { name: 'Rehearsal history and retention' });
    expect(await within(history).findByText('Not enabled in this environment')).toBeInTheDocument();
    expect(within(history).getByText('Nothing is stored, so nothing is retained.')).toBeVisible();
  });

  it('shows retention limits when history is stored', async () => {
    api.listRehearsalHistory.mockResolvedValue({
      ok: true,
      data: { status: 'OK', items: [], pruned: [] },
    });
    renderInApp(<SettingsPage />);
    const history = screen.getByRole('region', { name: 'Rehearsal history and retention' });
    expect(await within(history).findByText('Saved on this site')).toBeInTheDocument();
    expect(within(history).getByText(/kept for 90 days/)).toBeInTheDocument();
  });

  it('has no milestone codes', async () => {
    renderInApp(<SettingsPage />);
    await screen.findByText('Test user');
    expect(document.body.textContent).not.toMatch(/\bM[0-9]{1,2}\b/);
  });
});

describe('Ask the investigator', () => {
  it('renders nothing when Rovo is not enabled', async () => {
    render(<AskRovo agent="investigator" prompt="Why?" />);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when the bridge rejects', async () => {
    vi.mocked(rovo.isEnabled).mockRejectedValue(new Error('no bridge'));
    render(<AskRovo agent="investigator" prompt="Why?" />);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens the investigator with the prompt when Rovo is enabled', async () => {
    vi.mocked(rovo.isEnabled).mockResolvedValue(true);
    const user = userEvent.setup();
    render(<AskRovo agent="investigator" prompt="Why?" />);
    await user.click(await screen.findByRole('button', { name: 'Ask the investigator' }));
    expect(rovo.open).toHaveBeenCalledWith({
      type: 'forge',
      agentKey: 'recovery-investigator',
      agentName: 'Recovery Investigator',
      prompt: 'Why?',
    });
  });
});
