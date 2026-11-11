import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import './styles/app.css';
import { App } from './App';
import {
  loadThemeCss,
  osPrefersDark,
  readAppearance,
  startHostTheming,
  subtreeMode,
} from './lib/appearance';

/** Longest wait for Jira's theme before the first render; slower hosts render and catch up. */
const HOST_THEME_WAIT_MS = 300;

/*
 * Theme bootstrap. Forge's Custom UI CSP has no `script-src 'unsafe-inline'`
 * unless the manifest declares it (it does not), so there is no inline
 * pre-paint script: index.html carries only a <style> that paints the
 * device's Canvas colour, and this module, the first script to run, settles
 * the theme before React renders:
 *   1. Ask Jira to theme the page (view.theme.enable(), docs: before mount).
 *   2. Read the stored choice and, if the app root must carry its own theme
 *      (Light, Dark, or "system" outside Jira), load that ADS theme first.
 *   3. Render, with the root's theme attributes in the first commit.
 */
async function boot() {
  const host = startHostTheming();
  const hostThemed = await Promise.race([
    host,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), HOST_THEME_WAIT_MS)),
  ]);
  const mode = subtreeMode(readAppearance(), hostThemed, osPrefersDark());
  if (mode) await loadThemeCss(mode);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App hostTheming={host} initialHostThemed={hostThemed} />
    </StrictMode>,
  );
}

void boot();
