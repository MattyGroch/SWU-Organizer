/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: false,
      },
      // The card CDN is an S3 bucket that sends no Access-Control-Allow-Origin header, so
      // a cross-origin fetch() is blocked outright. Proxying makes art same-origin, which
      // is what lets the app downscale it to a canvas and cache the blob for offline use.
      // Production has the equivalent rule in docker/nginx.conf.
      '/card-art': {
        target: 'https://cdn.swu-db.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/card-art/, '/images/cards'),
      },
    },
  },
  build: {
    // The importer pulls in SheetJS, which is large and rarely used; keeping it in its
    // own chunk means it only downloads when someone actually imports a spreadsheet.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
