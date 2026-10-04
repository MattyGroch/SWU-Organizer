import { defineConfig } from 'vitest/config';

// Only the data pipeline's tests live at the root. The app (app/) and the API (server/)
// are separate projects with their own test setups.
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.mjs'],
  },
});
