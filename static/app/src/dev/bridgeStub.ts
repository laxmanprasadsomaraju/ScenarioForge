// Dev-server stand-in for @forge/bridge, which throws on import outside Jira.
// Wired in vite.config.ts only for `vite serve` with SF_PREVIEW=1. Every call
// rejects, so the app exercises the same fallbacks it uses when the bridge fails.
const unavailable = () =>
  Promise.reject(new Error('Forge bridge is not available in local preview.'));

export const invoke = unavailable;
export const view = {
  getContext: unavailable,
  createHistory: unavailable,
  theme: { enable: unavailable },
};
export const router = { open: unavailable, navigate: unavailable };
export const rovo = { isEnabled: unavailable, open: unavailable };
