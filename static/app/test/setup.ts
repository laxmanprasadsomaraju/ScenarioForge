import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Outside Jira the real bridge throws on import. Tests get a controllable
// mock: no Forge history (the router falls back to memory), a fixed site URL,
// and spies for invoke and router.open.
vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(() => Promise.reject(new Error('invoke is not mocked in this test'))),
  router: { open: vi.fn(() => Promise.resolve()) },
  rovo: { isEnabled: vi.fn(() => Promise.resolve(false)), open: vi.fn(() => Promise.resolve()) },
  view: {
    theme: { enable: vi.fn(() => Promise.resolve()) },
    createHistory: vi.fn(() => Promise.reject(new Error('No Forge history in tests'))),
    getContext: vi.fn(() => Promise.resolve({ siteUrl: 'https://example.atlassian.net' })),
  },
}));

// jsdom has no matchMedia; @atlaskit/tokens reads it when it loads.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
