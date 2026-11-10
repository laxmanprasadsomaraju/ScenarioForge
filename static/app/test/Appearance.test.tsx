import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import {
  APPEARANCE_KEY,
  readAppearance,
  subtreeMode,
  writeAppearance,
} from '../src/lib/appearance';
import { changes, issue } from './helpers';

const api = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(),
  listRecentChanges: vi.fn(),
}));
vi.mock('../src/lib/api', () => ({ api }));

/** A controllable prefers-color-scheme query. */
function mockDeviceDark(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const state = { matches: initial };
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return query.includes('prefers-color-scheme: dark') ? state.matches : false;
        },
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
          listeners.add(fn),
        removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
          listeners.delete(fn),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
  return {
    set(dark: boolean) {
      state.matches = dark;
      for (const fn of listeners) fn({ matches: dark } as MediaQueryListEvent);
    },
  };
}

const appRoot = () => document.querySelector<HTMLElement>('.app-root')!;
const appearance = () => within(screen.getByRole('group', { name: 'Appearance' }));

beforeEach(() => {
  window.localStorage.clear();
  api.getConnectionStatus.mockResolvedValue({
    ok: true,
    data: { connected: true, userDisplayName: 'Test user', checkedAt: new Date().toISOString() },
  });
  api.listRecentChanges.mockResolvedValue(changes([issue()]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('subtreeMode', () => {
  it('lets Jira theme the page in "system" inside Jira, and before Jira answers', () => {
    expect(subtreeMode('system', true, true)).toBeNull();
    expect(subtreeMode('system', null, true)).toBeNull();
  });
  it('follows the device in "system" outside Jira', () => {
    expect(subtreeMode('system', false, true)).toBe('dark');
    expect(subtreeMode('system', false, false)).toBe('light');
  });
  it('applies an explicit choice everywhere', () => {
    expect(subtreeMode('dark', true, false)).toBe('dark');
    expect(subtreeMode('light', false, true)).toBe('light');
  });
});

describe('Stored appearance', () => {
  it('reads back what was written, and ignores unknown values', () => {
    writeAppearance('dark');
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe('dark');
    expect(readAppearance()).toBe('dark');
    window.localStorage.setItem(APPEARANCE_KEY, 'sepia');
    expect(readAppearance()).toBe('system');
  });

  it('falls back to "system" when storage throws, without throwing itself', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(readAppearance()).toBe('system');
    expect(() => writeAppearance('light')).not.toThrow();
  });
});

describe('Appearance control', () => {
  it('in Jira, "Match Jira" leaves theming to Jira', async () => {
    render(<App hostTheming={Promise.resolve(true)} />);
    expect(await appearance().findByRole('radio', { name: 'Match Jira' })).toBeChecked();
    expect(appRoot()).not.toHaveAttribute('data-subtree-theme');
    expect(appRoot()).not.toHaveAttribute('data-color-mode');
  });

  it('persists Dark across a reload and themes only the app root', async () => {
    const user = userEvent.setup();
    const first = render(<App hostTheming={Promise.resolve(true)} />);
    await user.click(await appearance().findByRole('radio', { name: 'Dark' }));
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe('dark');
    await waitFor(() => expect(appRoot()).toHaveAttribute('data-color-mode', 'dark'));
    expect(appRoot()).toHaveAttribute('data-subtree-theme');
    expect(appRoot().getAttribute('data-theme')).toContain('dark:dark');
    // <html> stays Forge's.
    expect(document.documentElement).not.toHaveAttribute('data-color-mode');
    expect(document.querySelector('style[data-sf-theme="dark"]')).not.toBeNull();
    first.unmount();

    render(<App hostTheming={Promise.resolve(true)} />);
    expect(appearance().getByRole('radio', { name: 'Dark' })).toBeChecked();
    // The theme CSS is already in, so the first render carries the mode: no flash.
    expect(appRoot()).toHaveAttribute('data-color-mode', 'dark');

    await user.click(appearance().getByRole('radio', { name: 'Match Jira' }));
    expect(appRoot()).not.toHaveAttribute('data-color-mode');
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe('system');
  });

  it('outside Jira, "Match device" follows the device and its changes', async () => {
    const device = mockDeviceDark(true);
    render(<App hostTheming={Promise.resolve(false)} />);
    expect(await appearance().findByRole('radio', { name: 'Match device' })).toBeChecked();
    await waitFor(() => expect(appRoot()).toHaveAttribute('data-color-mode', 'dark'));
    device.set(false);
    await waitFor(() => expect(appRoot()).toHaveAttribute('data-color-mode', 'light'));
  });

  it('an explicit choice ignores device changes', async () => {
    const device = mockDeviceDark(false);
    window.localStorage.setItem(APPEARANCE_KEY, 'light');
    render(<App hostTheming={Promise.resolve(false)} />);
    await waitFor(() => expect(appRoot()).toHaveAttribute('data-color-mode', 'light'));
    device.set(true);
    expect(appRoot()).toHaveAttribute('data-color-mode', 'light');
  });

  it('still works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const user = userEvent.setup();
    render(<App hostTheming={Promise.resolve(true)} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Recovery readiness' }),
    ).toBeInTheDocument();
    expect(appearance().getByRole('radio', { name: 'Match Jira' })).toBeChecked();
    await user.click(appearance().getByRole('radio', { name: 'Dark' }));
    expect(appearance().getByRole('radio', { name: 'Dark' })).toBeChecked();
    await waitFor(() => expect(appRoot()).toHaveAttribute('data-color-mode', 'dark'));
  });
});
