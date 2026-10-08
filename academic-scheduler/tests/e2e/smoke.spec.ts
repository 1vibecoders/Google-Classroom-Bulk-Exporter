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
  // An empty schedule opens on today's Day view with the setup guide.
  await expect(page.getByRole('heading', { level: 1, name: 'Wednesday, October 7' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Welcome — let’s set up your schedule' })).toBeVisible();
  expect(external).toEqual([]);
});

test('the production page forbids network connections (CSP connect-src none)', async ({ page }) => {
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
});
