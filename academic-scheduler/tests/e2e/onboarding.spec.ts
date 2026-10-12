// A new person goes through the required setup in a real browser: study time
// (with the real editor) and a description of their commitments; the answers
// are kept after a reload and the app opens normally afterwards.
import { expect, openDialog, test } from './fixtures';

test('first-run setup requires study time and a commitments description, then opens the day view', async ({ page }) => {
  await page.goto('/#/week/2026-10-07');
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your schedule' })).toBeVisible();

  // Study time is required.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('alert')).toContainText('Add at least one study-time window');
  await page.getByRole('button', { name: 'Add study time' }).click();
  const dialog = openDialog(page);
  await dialog.getByRole('textbox', { name: 'Label' }).fill('After school');
  await dialog.getByRole('textbox', { name: 'From' }).fill('15:30');
  await dialog.getByRole('textbox', { name: 'Until' }).fill('21:00');
  await dialog.getByRole('button', { name: 'Add study time' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 3, name: 'After school' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // So is a description of the person's commitments.
  const description = page.getByRole('textbox', { name: 'Your commitments' });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Describe your commitments in a sentence or two')).toBeVisible();
  await description.fill('Swim practice Mon and Wed 4–6 PM. Library job Saturday mornings.');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // The answers are saved: a reload resumes on the Preferences step.
  await expect(page.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]')).toContainText('Preferences');
  await page.reload();
  await expect(page.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]')).toContainText('Preferences');

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Swim practice Mon and Wed 4–6 PM. Library job Saturday mornings.')).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page).toHaveURL(/#\/day\/2026-10-07$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Wednesday, October 7' })).toBeVisible();

  // Later the description is edited in Settings, not by repeating the setup.
  await page.goto('/#/settings');
  await expect(page.getByRole('textbox', { name: 'Your commitments' })).toHaveValue('Swim practice Mon and Wed 4–6 PM. Library job Saturday mornings.');
});
