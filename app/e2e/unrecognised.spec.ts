import { expect, test } from '@playwright/test';

test('a card the scanner cannot match is looked up by name instead of retried forever', async ({
  page,
}) => {
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Start camera' }).click();

  await expect(page.getByRole('heading', { name: 'Couldn’t recognise this card' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('combobox', { name: /Search cards/ }).fill('surgical');
  await page
    .getByRole('option', { name: /2-1B Surgical Droid/ })
    .first()
    .click();

  await expect(page.getByText('Added to Intake')).toBeVisible();
  // Scanning carries on, and does not retry the card still in view.
  await page.waitForTimeout(3_000);
  await expect(page.getByRole('heading', { name: 'Couldn’t recognise this card' })).toHaveCount(0);
});
