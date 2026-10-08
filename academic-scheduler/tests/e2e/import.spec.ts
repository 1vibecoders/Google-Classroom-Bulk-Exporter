// Import examples/complete-schedule.json through the file input, then import
// it again: the second import changes nothing.
import { readFileSync } from 'node:fs';
import { EXAMPLE_FILE, dayTimeline, expect, test } from './fixtures';

test('importing the example adds everything; importing it again shows “No changes”', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Import schedule' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(EXAMPLE_FILE);
  await expect(page.getByRole('heading', { name: 'Review the changes from “complete-schedule.json”' })).toBeVisible();

  const summary = page.getByRole('region', { name: 'Schedule Import' });
  await expect(summary).toContainText('+ 2 classes');
  await expect(summary).toContainText('+ 6 assignments');
  await expect(summary).toContainText('+ 12 scheduled work blocks');
  await expect(page.getByRole('list', { name: 'New' }).getByRole('listitem')).toHaveCount(27);
  // Settings the schedule never set are offered, unticked.
  await expect(page.getByRole('checkbox', { name: /Daily study limit/ })).not.toBeChecked();

  await summary.getByRole('button', { name: 'Import' }).click();
  const done = page.getByRole('region', { name: 'Schedule imported' });
  await expect(done).toBeVisible();
  await expect(done).toContainText('2 classes, 6 assignments, 5 events, 2 study-time windows, 12 scheduled work blocks');

  // The imported schedule shows up in the Day view.
  await page.goto('/#/day/2026-10-13');
  await expect(dayTimeline(page, 'Tuesday, October 13').getByRole('button', { name: /^English 10 \/ Othello Essay, step: Draft/ })).toBeVisible();

  // Import the same file again.
  await page.getByRole('banner').getByRole('link', { name: 'Import', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(EXAMPLE_FILE);
  await expect(page.getByRole('heading', { name: 'Review the changes from “complete-schedule.json”' })).toBeVisible();
  const again = page.getByRole('region', { name: 'Schedule Import' });
  await expect(page.getByText('No changes.', { exact: true })).toBeVisible();
  await expect(again).toContainText('Unchanged:27 items');
  await expect(again).toContainText('Nothing to import: no changes.');
  await expect(again.getByRole('button', { name: 'Import' })).toBeDisabled();
  await again.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('input[type="file"]')).toBeAttached();
});

test('pasted text can be imported, and Undo restores the empty schedule', async ({ page }) => {
  await page.goto('/#/import');
  const text = readFileSync(EXAMPLE_FILE, 'utf8');
  await page.getByText('Paste the file’s text instead').click();
  await page.getByRole('textbox', { name: 'Schedule JSON' }).fill(text);
  await page.getByRole('button', { name: 'Check pasted text' }).click();
  const summary = page.getByRole('region', { name: 'Schedule Import' });
  await expect(summary).toContainText('+ 6 assignments');
  await summary.getByRole('button', { name: 'Import' }).click();
  const done = page.getByRole('region', { name: 'Schedule imported' });
  await expect(done).toBeVisible();

  await done.getByRole('button', { name: 'Undo import' }).click();
  await page.goto('/#/assignments');
  await expect(page.getByRole('heading', { level: 3, name: 'Othello Essay' })).toHaveCount(0);
});

test('an invalid file is refused with the problems listed', async ({ page }) => {
  await page.goto('/#/import');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: '1.0', assignments: [{ id: 'a', title: '', due: 'tomorrow' }] })),
  });
  const problem = page.getByRole('region', { name: /./ }).filter({ has: page.getByRole('alert') });
  await expect(problem).toContainText('File “broken.json” · Nothing was imported.');
  await expect(problem).toContainText('assignments[0]');
  await expect(page.getByRole('region', { name: 'Schedule Import' })).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'future.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: '2.0' })),
  });
  await expect(problem).toContainText('Unsupported schedule format version');
  await expect(problem).toContainText('This file says it is version “2.0”.');
  await expect(page.getByRole('region', { name: 'Schedule Import' })).toHaveCount(0);
});
