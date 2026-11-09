import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  // Local visual preview only: swap the Forge bridge for a stub that rejects.
  // Production builds always use the real bridge.
  const stubBridge = command === 'serve' && process.env.SF_PREVIEW === '1';
  return {
    plugins: [react()],
    // Forge serves the bundle from a nested path, so assets must be relative.
    base: './',
    resolve: {
      alias: {
        '@shared': path.resolve(import.meta.dirname, '../../shared'),
        ...(stubBridge
          ? { '@forge/bridge': path.resolve(import.meta.dirname, 'src/dev/bridgeStub.ts') }
          : {}),
      },
    },
    server: {
      port: 3000,
      fs: { allow: ['../..'] },
    },
    build: {
      outDir: 'build',
      sourcemap: false,
    },
  };
});
