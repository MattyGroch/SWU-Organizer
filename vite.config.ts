/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    // `server/` is a separate sub-project with its own deps and its own vitest config
    // (server/vitest.config.ts). Without this, the root runner collects its tests and
    // fails to resolve better-sqlite3/supertest from the root node_modules.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{mjs,ts}'],
  },
});
