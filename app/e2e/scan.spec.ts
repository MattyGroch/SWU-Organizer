import { expect, test } from '@playwright/test';

import { CAMERA_CARD } from './paths';

test('the scanner recognises a hand-held card and queues it in Intake', async ({ page }) => {
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start camera' }).click();

  // Recognised, added without a question, and shown with its corrections.
  await expect(page.getByRole('heading', { name: new RegExp(CAMERA_CARD.name) })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(`${CAMERA_CARD.setKey} #${CAMERA_CARD.num} · Normal`)).toBeVisible();
  await expect(page.getByText('Added to Intake')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Correct' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rescan' })).toBeVisible();

  // The same card still in view does not add again.
  await page.waitForTimeout(2_000);
  await page
    .getByRole('link', { name: /^Intake/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: `Fix ${CAMERA_CARD.name}` })).toBeVisible();
  await expect(page.getByText(/^1 card$/)).toBeVisible();
});
