import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests for the Custom UI. `@forge/bridge` is mocked in test/setup.ts;
// nothing here touches the dev preview stub or fixtures.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, '../../shared') },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    css: false,
    clearMocks: true,
  },
});
