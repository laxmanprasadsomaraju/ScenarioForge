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

/** Pretends the screen is narrow (the drawer layout, under 60rem). */
function mockNarrowScreen() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
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
      'Crisis room',
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

  it('opens a modal drawer on narrow screens: inert screen, trapped focus, Escape returns focus', async () => {
    mockNarrowScreen();
    const user = userEvent.setup();
    render(<App hostTheming={Promise.resolve(true)} />);
    const toggle = screen.getByRole('button', { name: 'Menu' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(nav()).toHaveAttribute('data-open', 'true');
    expect(document.querySelector('main')).toHaveAttribute('inert');
    // Focus moves into the drawer, onto its first destination.
    expect(within(nav()).getByRole('link', { name: 'Command center' })).toHaveFocus();

    // Tab cycles between the toggle and the drawer, never reaching the screen behind.
    for (let i = 0; i < 20; i++) {
      await user.tab();
      const active = document.activeElement!;
      expect(nav().contains(active) || active === toggle).toBe(true);
    }
    toggle.focus();
    await user.tab({ shift: true });
    expect(nav().contains(document.activeElement)).toBe(true);

    within(nav()).getByRole('link', { name: 'Runbooks' }).focus();
    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(nav()).toHaveAttribute('data-open', 'false');
    expect(document.querySelector('main')).not.toHaveAttribute('inert');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAccessibleName('Menu');
  });

  it('keeps the shell outside Suspense: the sidebar stays mounted while a screen loads', async () => {
    const user = userEvent.setup();
    render(<App hostTheming={Promise.resolve(true)} />);
    const before = nav();
    const footer = before.querySelector('.sidebar-foot');
    await user.click(within(before).getByRole('link', { name: 'Settings' }));
    // Any loading skeleton renders inside main, never around the shell.
    const main = screen.getByRole('main');
    const busy = document.querySelector('[aria-busy="true"]');
    if (busy) expect(main.contains(busy)).toBe(true);
    expect(nav()).toBe(before);
    expect(before.querySelector('.sidebar-foot')).toBe(footer);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Settings' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(nav()).toBe(before);
    expect(within(nav()).getByRole('link', { current: 'page' })).toHaveTextContent('Settings');
  });

  it('keeps names, the active page, Settings and the theme in the collapsed rail', async () => {
    const user = userEvent.setup();
    render(<App hostTheming={Promise.resolve(true)} />);
    await user.click(within(nav()).getByRole('button', { name: 'Collapse navigation' }));
    for (const name of ['Command center', 'Changes', 'Runbooks', 'History', 'Settings']) {
      expect(within(nav()).getByRole('link', { name })).toHaveAttribute('title', name);
    }
    expect(within(nav()).getByRole('link', { current: 'page' })).toHaveAccessibleName(
      'Command center',
    );

    const themeButton = within(nav()).getByRole('button', { name: 'Appearance' });
    expect(themeButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(themeButton);
    expect(themeButton).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(themeButton.getAttribute('aria-controls')!)!;
    expect(panel).not.toHaveAttribute('hidden');
    await user.click(within(panel).getByRole('radio', { name: 'Dark' }));
    expect(within(panel).getByRole('radio', { name: 'Dark' })).toBeChecked();
    await user.keyboard('{Escape}');
    expect(themeButton).toHaveAttribute('aria-expanded', 'false');
    expect(themeButton).toHaveFocus();

    await user.click(within(nav()).getByRole('link', { name: 'Settings' }));
    expect(within(nav()).getByRole('link', { current: 'page' })).toHaveAccessibleName('Settings');
  });

  it('shows the theme as a menu only in the rail', () => {
    render(<App hostTheming={Promise.resolve(true)} />);
    expect(within(nav()).queryByRole('button', { name: 'Appearance' })).toBeNull();
    expect(within(nav()).getByRole('group', { name: 'Appearance' })).toBeInTheDocument();
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

describe('Skip link', () => {
  it('is the first tab stop and moves focus to the main region', async () => {
    const user = userEvent.setup();
    render(<App hostTheming={Promise.resolve(true)} />);
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
