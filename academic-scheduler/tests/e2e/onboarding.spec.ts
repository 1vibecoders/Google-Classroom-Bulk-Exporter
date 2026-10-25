// A new person goes through the streamlined setup in a real browser: the
// welcome slides, "Get your work in" (start empty), a one-tap study-time
// preset, the plan screen (kept after a reload), and into the app. The
// commitments description waits in the "Finish setting up" card.
import { expect, test } from './fixtures';

test('first-run setup needs only study time, then opens the day view and asks for commitments later', async ({ page }) => {
  await page.goto('/#/week/2026-10-07');
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your schedule' })).toBeVisible();

  // Welcome slides.
  await expect(page.getByRole('heading', { name: 'Everything due, in one place' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Planned into your real free time' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip intro' }).click();

  // Get your work in.
  const current = page.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]');
  await expect(current).toContainText('Get your work in');
  await page.getByRole('button', { name: /Start empty/ }).click();

  // Study time is the one required answer.
  await expect(current).toContainText('Study time');
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose when you usually study');
  await page.getByRole('button', { name: /Weekdays 4–7 PM/ }).first().click();
  await expect(page.getByRole('heading', { level: 3, name: 'Weekdays 4–7 PM' })).toBeVisible();
  await page.getByRole('button', { name: 'Build my plan' }).click();

  // The plan screen is kept after a reload.
  await expect(current).toContainText('Your plan');
  await expect(page.getByText('Nothing is planned after its due date.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]')).toContainText('Your plan');

  await page.getByRole('button', { name: 'Just take me in' }).click();
  await expect(page).toHaveURL(/#\/day\/2026-10-07$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Wednesday, October 7' })).toBeVisible();

  // The commitments description can be given later, right on the Day view.
  await page.getByRole('button', { name: 'Describe them' }).click();
  const description = page.getByRole('textbox', { name: 'Your commitments' });
  await description.fill('Swim practice Mon and Wed 4–6 PM. Library job Saturday mornings.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Describe them' })).toBeHidden();

  // Later the description is edited in Settings.
  await page.goto('/#/settings');
  await expect(page.getByRole('textbox', { name: 'Your commitments' })).toHaveValue('Swim practice Mon and Wed 4–6 PM. Library job Saturday mornings.');
});
