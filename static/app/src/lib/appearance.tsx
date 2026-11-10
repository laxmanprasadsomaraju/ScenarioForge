import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { view } from '@forge/bridge';
import { bridgeCall } from './preview';

/**
 * Appearance: Match Jira (or the device outside Jira), Light or Dark.
 *
 * `<html>` belongs to Forge: view.theme.enable() keeps its data-color-mode in
 * step with Jira, including live switches. An explicit choice never touches
 * it; the app root becomes an ADS subtree theme instead (data-subtree-theme +
 * data-color-mode + data-theme), with the bundled ADS theme CSS for that mode.
 * Outside Jira, where enable() rejects, "system" follows the device through
 * prefers-color-scheme the same way.
 *
 * The choice is kept per browser in localStorage under `sf.appearance`. Every
 * read and write is guarded: blocked storage means "system", never a crash.
 */
export type Appearance = 'system' | 'light' | 'dark';
export type ColorMode = 'light' | 'dark';

export const APPEARANCE_KEY = 'sf.appearance';
export const APPEARANCES: Appearance[] = ['system', 'light', 'dark'];
const OS_DARK = '(prefers-color-scheme: dark)';

export function readAppearance(): Appearance {
  try {
    const value = window.localStorage.getItem(APPEARANCE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function writeAppearance(value: Appearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, value);
  } catch {
    // Storage blocked (private window, policy): the choice lasts for this visit only.
  }
}

function osMedia(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === 'function' ? window.matchMedia(OS_DARK) : null;
  } catch {
    return null;
  }
}

export function osPrefersDark(): boolean {
  return osMedia()?.matches ?? false;
}

/**
 * The mode the app root must carry itself, or null when the host themes the
 * page. `hostThemed` is null while Jira has not answered yet: treated as
 * themed, so nothing is overridden before Jira's own theme arrives.
 */
export function subtreeMode(
  appearance: Appearance,
  hostThemed: boolean | null,
  osDark: boolean,
): ColorMode | null {
  if (appearance !== 'system') return appearance;
  if (hostThemed !== false) return null;
  return osDark ? 'dark' : 'light';
}

let hostTheming: Promise<boolean> | null = null;

/** Asks Jira to theme the page, once. Resolves true inside Jira, false outside it. */
export function startHostTheming(): Promise<boolean> {
  hostTheming ??= bridgeCall(() => view.theme.enable()).then(
    () => true,
    () => false,
  );
  return hostTheming;
}

const themeCss = new Map<ColorMode, Promise<void>>();
const injected = new Set<ColorMode>();

/** True once the ADS theme for `mode` is in the document. */
export function themeCssReady(mode: ColorMode): boolean {
  return injected.has(mode);
}

/**
 * Injects the bundled ADS theme for one mode, once. Each is its own chunk
 * (about 3 kB gzip) and is only fetched when a subtree needs it. The token
 * CSS selects `[data-subtree-theme][data-color-mode][data-theme~=…]`, so it
 * never changes `<html>`.
 */
export function loadThemeCss(mode: ColorMode): Promise<void> {
  let pending = themeCss.get(mode);
  if (!pending) {
    pending = (
      mode === 'dark'
        ? import('@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-dark')
        : import('@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-light')
    )
      .then((m: { default: string }) => {
        const style = document.createElement('style');
        style.dataset.sfTheme = mode;
        style.textContent = m.default;
        document.head.appendChild(style);
        injected.add(mode);
      })
      .catch(() => {
        // Theme chunk failed: the tokens' literal fallbacks still render a usable light page.
        themeCss.delete(mode);
      });
    themeCss.set(mode, pending);
  }
  return pending;
}

/** Attributes that make an element an ADS subtree theme for `mode`. */
export function subtreeAttributes(mode: ColorMode | null): Record<string, string | undefined> {
  return mode
    ? {
        'data-subtree-theme': '',
        'data-color-mode': mode,
        'data-theme': 'light:light dark:dark',
      }
    : {};
}

interface AppearanceValue {
  appearance: Appearance;
  setAppearance: (next: Appearance) => void;
  /** True inside Jira, false outside it, null until Jira answers. */
  hostThemed: boolean | null;
  /** The mode applied to the app root, or null when Jira's theme applies. */
  mode: ColorMode | null;
}

const AppearanceContext = createContext<AppearanceValue>({
  appearance: 'system',
  setAppearance: () => {},
  hostThemed: null,
  mode: null,
});

export function AppearanceProvider({
  children,
  hostTheming,
  initialHostThemed = null,
}: {
  children: (mode: ColorMode | null) => ReactNode;
  hostTheming?: Promise<boolean>;
  initialHostThemed?: boolean | null;
}) {
  const [host] = useState(() => hostTheming ?? startHostTheming());
  const [appearance, setChoice] = useState<Appearance>(readAppearance);
  const [hostThemed, setHostThemed] = useState<boolean | null>(initialHostThemed);
  const [osDark, setOsDark] = useState(osPrefersDark);
  const wanted = subtreeMode(appearance, hostThemed, osDark);
  // Applied only once its theme CSS is in, so the root never shows a half-switched theme.
  // main.tsx preloads the stored choice's CSS, so the first render is already right.
  const [, setLoaded] = useState(0);
  const mode = wanted && themeCssReady(wanted) ? wanted : null;

  useEffect(() => {
    let cancelled = false;
    host.then((themed) => {
      if (!cancelled) setHostThemed(themed);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  // The device setting only matters when nothing else decides.
  const followsDevice = appearance === 'system' && hostThemed === false;
  useEffect(() => {
    if (!followsDevice) return;
    const media = osMedia();
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setOsDark(event.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [followsDevice]);

  useEffect(() => {
    if (!wanted || themeCssReady(wanted)) return;
    let cancelled = false;
    loadThemeCss(wanted).then(() => {
      if (!cancelled) setLoaded((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  const setAppearance = useCallback((next: Appearance) => {
    setChoice(next);
    writeAppearance(next);
  }, []);

  const value = useMemo(
    () => ({ appearance, setAppearance, hostThemed, mode }),
    [appearance, setAppearance, hostThemed, mode],
  );
  return <AppearanceContext.Provider value={value}>{children(mode)}</AppearanceContext.Provider>;
}

export const useAppearance = () => useContext(AppearanceContext);
