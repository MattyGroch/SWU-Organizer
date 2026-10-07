import { defineConfig, devices } from '@playwright/test';

import { FAKE_CAMERA, UNKNOWN_CAMERA } from './e2e/paths';

/**
 * End-to-end tests against a production build (`vite build` + `vite preview`), so the
 * service worker is real. Run with `npm run e2e`.
 *
 * The camera is Chromium's fake device playing a video of a real card (made by
 * e2e/global-setup.ts), which is how the scanner gets tested without a phone.
 */
const PORT = 4173;

/**
 * Matt's Pixel 11 Pro as the installed app sees it: 411×816, measured on the phone with
 * display magnification on. Layout bugs show up at exactly this size, so the tests
 * use it rather than Playwright's Pixel 7.
 */
const PHONE = { ...devices['Pixel 7'], viewport: { width: 411, height: 816 } };

/** A phone whose camera is Chromium's fake device playing `video`. */
function phoneWithCamera(video: string) {
  return {
    ...PHONE,
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${video}`,
      ],
    },
  };
}

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      testIgnore: /unrecognised/,
      use: phoneWithCamera(FAKE_CAMERA),
    },
    {
      // A camera showing a card the index can't match.
      name: 'phone, unknown card',
      testMatch: /unrecognised/,
      use: phoneWithCamera(UNKNOWN_CAMERA),
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
