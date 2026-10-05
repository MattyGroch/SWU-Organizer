/// <reference types="vitest/config" />
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Stamps the service worker (public/sw.js) for this build: a build id, so each deploy gets
 * a fresh cache, and the files to cache at install — the entry script and styles, plus
 * the manifest and icons. Lazy chunks (the spreadsheet importer) are cached when used.
 */
function swManifest(): Plugin {
  let precache: string[] = [];
  let outDir = 'dist';
  return {
    name: 'sw-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      precache = Object.values(bundle)
        .filter((file) => (file.type === 'chunk' ? file.isEntry : file.fileName.endsWith('.css')))
        .map((file) => `/${file.fileName}`);
    },
    async writeBundle() {
      const path = join(outDir, 'sw.js');
      const source = await readFile(path, 'utf8');
      const files = [
        ...precache,
        '/manifest.webmanifest',
        '/icons/icon.svg',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ];
      await writeFile(
        path,
        source
          .replace('__BUILD_ID__', Date.now().toString(36))
          .replace('__PRECACHE__', JSON.stringify(files).replace(/'/g, "\\'")),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), swManifest()],
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
