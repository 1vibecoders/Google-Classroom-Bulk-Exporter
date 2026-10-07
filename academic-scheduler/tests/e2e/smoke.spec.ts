import { expect, test } from '@playwright/test';

test('the app loads without network requests to other origins', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.protocol !== 'data:') external.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import' })).toBeVisible();
  expect(external).toEqual([]);
});
