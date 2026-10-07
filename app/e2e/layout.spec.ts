import { expect, test } from '@playwright/test';

/**
 * A full-bleed band that overshoots the page padding by even a few pixels lets the whole
 * app slide sideways on a phone. Every tab must be exactly as wide as the screen.
 */
const PAGES = [
  '/inventory/SOR/list',
  '/inventory/SOR/binder',
  '/inventory/bulk',
  '/decks',
  '/intake',
  '/scan',
];

for (const path of PAGES) {
  test(`${path} does not scroll sideways`, async ({ page }) => {
    await page.goto(path);
    await page.locator('main').waitFor();
    await page.waitForTimeout(500);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBe(clientWidth);
  });
}
