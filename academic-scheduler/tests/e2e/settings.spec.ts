// Settings are saved in this browser; "Delete all data" asks for a typed
// confirmation and can be undone from the undo history.
import { expect, loadExample, navTo, openDialog, test, toast } from './fixtures';

test('settings are saved and survive a reload', async ({ page }) => {
  await loadExample(page);
  const limit = page.getByRole('spinbutton', { name: 'Most work per day' });
  await expect(limit).toHaveValue('180');
  await limit.fill('120');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(toast(page, 'Settings saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Most work per day' })).toHaveValue('120');
  await page.goto('/#/day/2026-10-13');
  await expect(page.getByRole('region', { name: 'Day summary' })).toContainText('Daily limit2 h');
});

test('Delete all data needs DELETE typed, and the undo history restores the schedule', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Delete all data…' }).click();
  const dialog = openDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Delete all data?' })).toBeVisible();
  const go = dialog.getByRole('button', { name: 'Delete everything' });
  await expect(go).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
  await go.click();
  await expect(dialog).toBeHidden();

  await navTo(page, 'Assignments');
  await expect(page.getByRole('heading', { level: 3, name: 'Othello Essay' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings and data' }).click();
  const history = page.locator('.ls-snapshots > li').filter({ hasText: 'Before deleting all data' });
  await history.getByRole('button', { name: 'Restore' }).click();
  const confirm = page.getByRole('dialog', { name: 'Restore this version?' });
  await confirm.getByRole('button', { name: 'Restore' }).click();
  await expect(toast(page, 'Earlier version restored.')).toBeVisible();

  await navTo(page, 'Assignments');
  await expect(page.getByRole('heading', { level: 3, name: 'Othello Essay' })).toBeVisible();
});
