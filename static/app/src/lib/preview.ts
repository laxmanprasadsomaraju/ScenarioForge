/**
 * Development-only visual preview (`?preview=fixtures|empty|error` on the Vite
 * dev server). `import.meta.env.DEV` is false in production builds, so this
 * and the fixture module are removed from what Forge deploys.
 */
export type PreviewMode = 'fixtures' | 'empty' | 'error';

function readPreviewMode(): PreviewMode | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get('preview');
  return value === 'fixtures' || value === 'empty' || value === 'error' ? value : null;
}

export const previewMode = readPreviewMode();

/** Runs a bridge call, turning a synchronous throw outside Jira into a rejection. */
export function bridgeCall<T>(fn: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(fn);
}
