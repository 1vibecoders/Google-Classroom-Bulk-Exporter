// Load the shipped example from Settings and look at it in every view.
import { dayTimeline, expect, loadExample, navTo, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await loadExample(page);
});

test('Day view shows the example’s Tuesday, October 13', async ({ page }) => {
  await page.goto('/#/day/2026-10-13');
  await expect(page.getByRole('heading', { level: 1, name: 'Tuesday, October 13' })).toBeVisible();

  const timeline = dayTimeline(page, 'Tuesday, October 13');
  await expect(timeline.getByRole('button', { name: 'School, School, 8:00 AM – 3:00 PM, busy' })).toBeVisible();
  await expect(timeline.getByRole('button', { name: /^Biology \/ Unit 2 Test: Cells, step: Review chapter 3 notes, 3:30 – 4:15 PM, 45 m, Planned/ })).toBeVisible();
  await expect(timeline.getByRole('button', { name: /^English 10 \/ Othello Essay, step: Draft, 4:30 – 5:20 PM, 50 m, Planned/ })).toBeVisible();
  await expect(timeline.getByText(/^Available/)).toBeVisible();

  const allDay = page.getByRole('list', { name: 'All day' });
  await expect(allDay.getByRole('button', { name: 'Due · English 10 · Read Othello Act 3' })).toBeVisible();

  const summary = page.getByRole('region', { name: 'Day summary' });
  await expect(summary.getByRole('definition').first()).toHaveText('1 h 35 m');

  // The same day as a list ("3:30 PM Biology … 4:15 PM Available …").
  const inOrder = page.getByRole('list', { name: 'Schedule for Tuesday, October 13, in order' });
  await expect(inOrder.getByRole('listitem')).toHaveCount(5);
  await expect(inOrder.getByRole('listitem').nth(2)).toContainText('4:15 PM');
  await expect(inOrder.getByRole('listitem').nth(2)).toContainText('Available');

  // Day navigation.
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wednesday, October 14' })).toBeVisible();
  await expect(page).toHaveURL(/#\/day\/2026-10-14$/);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wednesday, October 7' })).toBeVisible();
});

test('Week view shows the week of October 12 with totals and the open issue', async ({ page }) => {
  await page.goto('/#/day/2026-10-13');
  await navTo(page, 'Week');
  await expect(page).toHaveURL(/#\/week\/2026-10-13$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Week of Oct 12 – 18' })).toBeVisible();

  const summary = page.getByRole('region', { name: 'Week summary' });
  await expect(summary).toContainText('9 h 5 m');
  await expect(summary).toContainText('32 h');

  const week = page.getByRole('group', { name: 'Week of Oct 12 – 18' });
  await expect(week.getByRole('link', { name: 'Open Friday, October 16' })).toBeVisible();
  await expect(week.getByRole('button', { name: /^Piano theory exam, .*10:00 – 11:00 AM/ }).first()).toBeVisible();
  await expect(page.getByText(/Thursday, Oct 15 is tight/)).toBeVisible();

  // List mode shows the same week as text.
  await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'List' }).click();
  const friday = page.getByRole('region', { name: 'Fri, Oct 16' });
  await expect(friday.getByRole('heading', { level: 2, name: 'Fri, Oct 16' })).toBeVisible();
  await expect(friday.getByRole('list', { name: 'Schedule for Friday, October 16' })).toContainText('School');

  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Week of Oct 19 – 25' })).toBeVisible();
});

test('Assignments, Classes and Commitments list the example’s items', async ({ page }) => {
  await page.goto('/#/day/2026-10-13');
  await navTo(page, 'Assignments');
  await expect(page.getByRole('heading', { level: 1, name: 'Assignments' })).toBeVisible();
  await expect(page.getByText('Showing 6 of 6 assignments.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Othello Essay' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Unit 2 Test: Cells' })).toBeVisible();

  // Search filter.
  await page.getByRole('searchbox', { name: 'Search' }).fill('othello');
  await expect(page.getByText('Showing 2 of 6 assignments.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search' }).fill('');

  // Expand an assignment's details.
  await page.getByRole('button', { name: 'Othello Essay', exact: true }).click();
  await expect(page.getByText('Choose thesis and quotations').first()).toBeVisible();

  await navTo(page, 'Classes');
  await expect(page.getByRole('heading', { level: 1, name: 'Classes' })).toBeVisible();
  const english = page.getByRole('article', { name: 'English 10' });
  await expect(english).toContainText('Ms. Rivera');
  await expect(english.getByRole('link', { name: 'View assignments (3)' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Biology' })).toContainText('Mr. Chen');

  // A class's assignment link filters the Assignments view.
  await english.getByRole('link', { name: 'View assignments (3)' }).click();
  await expect(page.getByRole('combobox', { name: 'Class' })).toHaveValue('gc-class-NjI3ODk0MjE0NTQ5');
  await expect(page.getByText(/^Showing 3 of /)).toBeVisible();

  await navTo(page, 'Commitments');
  await expect(page.getByRole('heading', { level: 1, name: 'Commitments' })).toBeVisible();
  const recurring = page.getByRole('region', { name: /^Recurring commitments/ });
  await expect(recurring.getByRole('heading', { name: 'School' })).toBeVisible();
  await expect(recurring.getByRole('heading', { name: 'Fencing' })).toBeVisible();
  await expect(recurring).toContainText('Every Monday from Oct 5');
  await expect(page.getByRole('region', { name: /^One-time events/ }).getByRole('heading', { name: 'Doctor appointment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Study time: After school, Monday 3:30 PM – 9:30 PM' })).toBeVisible();
});

test('Plan unscheduled work proposes nothing when everything is scheduled', async ({ page }) => {
  await page.goto('/#/assignments');
  await page.getByRole('button', { name: 'Plan unscheduled work' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/fixed rule/i);
  await dialog.getByRole('button', { name: /^(Close|Cancel)$/ }).first().click();
  await expect(dialog).toBeHidden();
});
