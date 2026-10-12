import { expect, test } from './fixtures';

test('the app loads without network requests to other origins', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.protocol !== 'data:' && url.protocol !== 'blob:') external.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Import', exact: true })).toBeVisible();
  // A new schedule opens on the setup wizard (study time and commitments are required).
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your schedule' })).toBeVisible();
  await expect(page).toHaveURL(/#\/welcome$/);
  expect(external).toEqual([]);
});

test('the production page may only connect to its own origin (CSP connect-src self)', async ({ page }) => {
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'self'");
});
