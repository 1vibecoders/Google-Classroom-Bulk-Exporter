// Phone-sized screens (run by the "mobile" project: npx playwright test --project=mobile).
import { expect, loadExample, test } from './fixtures';

test('every view fits a phone screen without sideways scrolling @mobile', async ({ page }) => {
  await loadExample(page);
  for (const route of ['day/2026-10-13', 'week/2026-10-13', 'assignments', 'classes', 'commitments', 'import', 'settings']) {
    await page.goto(`/#/${route}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scrollWidth, `${route} is wider than the screen`).toBeLessThanOrEqual(clientWidth);
  }
});

test('the Day view can show the day as a list on a phone @mobile', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/day/2026-10-13');
  await expect(page.getByRole('heading', { level: 1, name: 'Tuesday, October 13' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Timeline for Tuesday, October 13' })).toBeVisible();
  await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'List' }).click();
  const list = page.getByRole('list', { name: 'Schedule for Tuesday, October 13' });
  await expect(list).toContainText('Othello Essay');
  await expect(list).toContainText('Available');
  // The choice is remembered.
  await page.reload();
  await expect(page.getByRole('list', { name: 'Schedule for Tuesday, October 13' })).toBeVisible();
});
