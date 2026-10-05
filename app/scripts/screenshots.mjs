/**
 * Screenshots of every page and dialog at phone sizes, for reviewing the mobile layout.
 *
 *   npm run dev            # in another terminal
 *   node scripts/screenshots.mjs [--out dir] [--base url] [backup.json …]
 *
 * Each device gets a fresh browser profile, filled by importing the given backup files
 * through the real Import dialog (in order, adding up), plus a few scanned cards queued
 * in Intake. The camera is Chromium's fake test pattern.
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const out = resolve(option('--out', 'screenshots'));
const base = option('--base', 'http://localhost:5173');
const only = option('--device');
const backups = args.map((file) => resolve(file));

const DEVICES = {
  'iphone-se': devices['iPhone SE'],
  'pixel-7': devices['Pixel 7'],
};

const SCANS = [
  { setKey: 'SOR', base: 59, num: '059', variant: 'normal' },
  { setKey: 'SOR', base: 59, num: '059', variant: 'normal' },
  { setKey: 'SOR', base: 10, num: '010', variant: 'normal' },
  { setKey: 'SHD', base: 120, num: '120', variant: 'normal' },
];

async function run(name, device) {
  const dir = join(out, name);
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({ ...device, permissions: ['camera'] });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`[${name}] page error: ${error.message}`));
  let n = 0;
  const shot = async (label, { full = true } = {}) => {
    await page.waitForTimeout(400);
    const file = join(dir, `${String(++n).padStart(2, '0')}-${label}.png`);
    await page.screenshot({ path: file, fullPage: full });
    const overflow = await sideways();
    console.log(overflow ? `${file}\n  ⚠ wider than the screen: ${overflow}` : file);
  };
  /** Elements that stick out past the right edge of the screen, unless something clips them. */
  const sideways = () =>
    page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const clipped = (el) => {
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (a === document.body) return false;
          const { overflowX } = getComputedStyle(a);
          if (overflowX !== 'visible') return true;
        }
        return false;
      };
      const culprits = [];
      for (const el of document.querySelectorAll('body *')) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.right <= width + 1 || clipped(el)) continue;
        if (!el.checkVisibility()) continue;
        // Report the outermost offender only, not every descendant.
        if (culprits.some((c) => c.contains(el))) continue;
        culprits.push(el);
      }
      if (!culprits.length) return null;
      return culprits
        .slice(0, 6)
        .map((el) => {
          const cls = [...el.classList].map((c) => c.replace(/^_?(\w+?)_.*$/, '$1')).join('.');
          const text = (el.textContent ?? '').trim().slice(0, 30);
          return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}> +${Math.round(el.getBoundingClientRect().right - width)}px "${text}"`;
        })
        .join(' · ');
    });
  const dialog = () => page.locator('dialog[open]');
  const closeDialog = async () => {
    await page.keyboard.press('Escape');
    await dialog()
      .waitFor({ state: 'detached' })
      .catch(() => {});
  };

  try {
    await steps();
  } catch (error) {
    await page.screenshot({ path: join(dir, 'FAILED.png'), fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }

  async function steps() {
    await page.goto(base);
    await page.waitForURL(/\/binder\//);
    await page.getByRole('button', { name: 'Import / export' }).waitFor();
    await shot('binder-empty');

    // Fill the profile through the Import dialog.
    for (const [i, file] of backups.entries()) {
      await page.getByRole('button', { name: 'Import / export' }).click();
      await dialog().locator('input[type=file]').setInputFiles(file);
      // Backups default to replacing everything; these files add up instead.
      await dialog()
        .getByRole('radio', { name: /^Add to collection/ })
        .check();
      if (i === 0) await shot('import-preview', { full: false });
      const restore = dialog().getByRole('checkbox', { name: /restore/ });
      if (await restore.count()) await restore.check();
      await dialog()
        .getByRole('button', { name: /^Import \d+ copies/ })
        .click();
      await page.waitForTimeout(800);
      if (await dialog().count()) await closeDialog();
    }
    await page.evaluate(async (scans) => {
      const { queueScan } = await import('/src/data/intake.ts');
      for (const scan of scans) await queueScan(scan);
    }, SCANS);

    await page.goto(`${base}/binder/SOR`);
    await page.getByRole('button', { name: 'Bulk edit' }).waitFor();
    await shot('binder');
    await shot('binder-top', { full: false });
    await page.locator('table').first().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 120);
    await shot('binder-table', { full: false });
    // Tapping a row selects the card: on phones its panel pins to the bottom.
    await page.locator('tbody tr', { hasText: 'Luke Skywalker' }).first().click();
    await shot('binder-selected', { full: false });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));

    for (const label of ['Sets', 'Filters']) {
      const toggle = page.locator('summary', { hasText: label }).first();
      if (!(await toggle.count())) continue;
      await toggle.click();
      await shot(`binder-${label.toLowerCase()}-open`, { full: false });
      await toggle.click();
    }

    const search = page.getByRole('combobox', { name: /Search cards/ });
    if (await search.count()) {
      await search.fill('vader');
      await shot('search', { full: false });
      await search.fill('');
    }

    await page.getByRole('button', { name: 'Bulk edit' }).click();
    await shot('bulk-edit', { full: false });
    await closeDialog();

    await page.getByRole('button', { name: 'Import / export' }).click();
    await shot('import-export', { full: false });
    await closeDialog();

    await page.goto(`${base}/decks`);
    await page.waitForLoadState('networkidle');
    await shot('decks');
    await shot('decks-top', { full: false });
    const deck = page.locator('button[aria-expanded="false"]').first();
    if (await deck.count()) {
      await deck.click();
      await shot('deck-open');
      await deck.click();
    }
    const precons = page.locator('summary', { hasText: 'Precon' }).first();
    if (await precons.count()) {
      await precons.click();
      await shot('precons-open');
    }

    await page.goto(`${base}/intake`);
    await page.getByRole('button', { name: /^Fix/ }).first().waitFor();
    await shot('intake');
    await page.getByRole('button', { name: /^Fix/ }).first().click();
    await shot('intake-fix', { full: false });
    await closeDialog();

    await page.goto(`${base}/scan`);
    await shot('scan-before-camera', { full: false });
    const start = page.getByRole('button', { name: 'Start camera' });
    if (await start.count()) {
      await start.click();
      await page.waitForTimeout(1500);
      await shot('scan-camera', { full: false });
    }
  }
}

for (const [name, device] of Object.entries(DEVICES)) {
  if (!only || only === name) await run(name, device);
}
