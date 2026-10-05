import { expect, test } from '@playwright/test';

test('installable: the manifest and icons are served', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await request.get(href!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons as Array<{ src: string }>) {
    expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  }
});

test('once visited, the app opens and scans offline', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('table').waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first load happened before the worker took control; this one goes through it,
  // which caches the catalogs. Visiting Scan caches the scan index the same way.
  await page.reload();
  await page.getByRole('table').waitFor();
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start camera' }).waitFor();
  await page.waitForTimeout(1_000);

  await context.setOffline(true);

  await page.goto('/binder/SOR');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Director Krennic/ })).toBeVisible();

  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByText('Card data could not be loaded')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /2-1B Surgical Droid/ })).toBeVisible({
    timeout: 20_000,
  });
});
