// Export → import round trips and deletions that a later import remembers.
import { readFileSync } from 'node:fs';
import { EXAMPLE_FILE, expect, loadExample, navTo, openDialog, test, toast } from './fixtures';
import { validateDocument } from '../../src/lib/validate';

test('the example’s own export imports again with no changes', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/day/2026-10-13');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('banner').getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const text = readFileSync(await download.path(), 'utf8');
  const exported = JSON.parse(text);
  expect(validateDocument(exported, { today: '2026-10-07' }).errors).toEqual([]);
  expect(exported.meta.exportId).toMatch(/^u-exp-/);
  expect(exported.assignments).toHaveLength(6);
  expect(exported.scheduleBlocks).toHaveLength(12);

  await page.getByRole('banner').getByRole('link', { name: 'Import', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'my-export.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  const summary = page.getByRole('region', { name: 'Schedule Import' });
  await expect(page.getByText('No changes.', { exact: true })).toBeVisible();
  await expect(summary).toContainText('Unchanged:27 items');
  await expect(summary.getByRole('button', { name: 'Import' })).toBeDisabled();
});

test('a deleted class stays deleted on re-import and can be restored from the preview', async ({ page }) => {
  await loadExample(page);
  await navTo(page, 'Classes');
  await page.getByRole('button', { name: 'More actions for Biology' }).click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  const dialog = openDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Delete Biology?' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^Keep it/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Delete class' }).click();
  await expect(toast(page, 'Deleted Biology. Its 1 assignment was kept without a class.')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Biology' })).toHaveCount(0);

  // Importing the example again does not bring the class back by itself.
  await page.getByRole('banner').getByRole('link', { name: 'Import', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(EXAMPLE_FILE);
  const summary = page.getByRole('region', { name: 'Schedule Import' });
  await expect(summary).toContainText('Previously deleted:1 class');
  await expect(summary.getByRole('button', { name: 'Import' })).toBeDisabled();
  // The assignment that waits for the class is not reported as a failed choice.
  await expect(page.getByRole('heading', { name: 'Choices that can’t be carried out as ticked' })).toHaveCount(0);

  // Ticking "Restore" brings it back with the assignment's class.
  const restore = page.getByRole('checkbox', { name: 'Restore Class Biology' });
  await expect(restore).not.toBeChecked();
  await restore.check();
  await expect(summary.getByRole('button', { name: 'Import' })).toBeEnabled();
  await summary.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('region', { name: 'Schedule imported' })).toBeVisible();

  await navTo(page, 'Classes');
  const biology = page.getByRole('article', { name: 'Biology' });
  await expect(biology).toContainText('Mr. Chen');
  await expect(biology.getByRole('link', { name: 'View assignments (1)' })).toBeVisible();
});

test('marking an assignment done from the list can be undone', async ({ page }) => {
  await loadExample(page);
  await navTo(page, 'Assignments');
  await expect(page.getByText('Showing 6 of 6 assignments.')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Mark “Read Othello Act 3” done' }).click();
  const notice = toast(page, 'Marked “Read Othello Act 3” done.');
  await expect(notice).toBeVisible();
  // The default filter shows work that is not done yet.
  await expect(page.getByRole('heading', { level: 3, name: 'Read Othello Act 3' })).toHaveCount(0);

  await notice.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('checkbox', { name: 'Mark “Read Othello Act 3” done' })).not.toBeChecked();
  await expect(page.getByText('Showing 6 of 6 assignments.')).toBeVisible();
});
