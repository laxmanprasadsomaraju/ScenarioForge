import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { NAV_KEY } from '../src/components/Shell';
import { changes, issue } from './helpers';

const api = vi.hoisted(() => ({
  // The Command center reads saved history; it is not enabled in these tests.
  listRehearsalHistory: vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: {
        status: 'UNAVAILABLE',
        detail: 'Rehearsal history is not enabled in this environment.',
      },
    }),
  ),
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

beforeEach(() => {
  window.localStorage.clear();
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
  api.listRecentChanges.mockResolvedValue(changes([issue()]));
});

const nav = () => screen.getByRole('navigation', { name: 'ScenarioForge' });
const shell = () => document.querySelector('.shell')!;

describe('Navigation', () => {
  it('names destinations in plain words, with no milestone codes', () => {
    render(<App hostTheming={Promise.resolve(true)} />);
    const names = within(nav())
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(names).toEqual([
      'Command center',
      'Changes',
      'Readiness checks',
      'Runbooks',
      'Rehearsals',
      'Crisis room, coming later',
      'History',
      'Settings',
    ]);
    expect(nav().textContent).not.toMatch(/\bM\d+\b/);
    expect(within(nav()).getByRole('link', { current: 'page' })).toHaveTextContent(
      'Command center',
    );
  });

  it('collapses to a rail that keeps every name, and remembers it', async () => {
    const user = userEvent.setup();
    const first = render(<App hostTheming={Promise.resolve(true)} />);
    const collapse = within(nav()).getByRole('button', { name: 'Collapse navigation' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await user.click(collapse);

    expect(shell()).toHaveAttribute('data-rail', 'true');
    const expand = within(nav()).getByRole('button', { name: 'Expand navigation' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(expand).toHaveFocus();
    // Labels are hidden visually only: links keep their accessible names and gain a title.
    const changesLink = within(nav()).getByRole('link', { name: 'Changes' });
    expect(changesLink).toHaveAttribute('title', 'Changes');
    expect(window.localStorage.getItem(NAV_KEY)).toBe('rail');
    first.unmount();

    render(<App hostTheming={Promise.resolve(true)} />);
    expect(shell()).toHaveAttribute('data-rail', 'true');
    await user.click(within(nav()).getByRole('button', { name: 'Expand navigation' }));
    expect(shell()).toHaveAttribute('data-rail', 'false');
    expect(window.localStorage.getItem(NAV_KEY)).toBe('expanded');
  });

  it('works from the keyboard and moves focus to the new screen', async () => {
    const user = userEvent.setup();
    render(<App hostTheming={Promise.resolve(true)} />);
    within(nav()).getByRole('link', { name: 'Changes' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Changes' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
    expect(within(nav()).getByRole('link', { current: 'page' })).toHaveTextContent('Changes');
  });

  it('closes the mobile menu on Escape and returns focus to its toggle', async () => {
    const user = userEvent.setup();
    render(<App hostTheming={Promise.resolve(true)} />);
    const toggle = screen.getByRole('button', { name: 'Menu' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(nav()).toHaveAttribute('data-open', 'true');

    within(nav()).getByRole('link', { name: 'Runbooks' }).focus();
    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(nav()).toHaveAttribute('data-open', 'false');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAccessibleName('Menu');
  });

  it('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const user = userEvent.setup();
    render(<App hostTheming={Promise.resolve(true)} />);
    await user.click(within(nav()).getByRole('button', { name: 'Collapse navigation' }));
    expect(shell()).toHaveAttribute('data-rail', 'true');
    vi.restoreAllMocks();
  });
});
