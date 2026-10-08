// The planner (a fixed rule, not AI) places unscheduled work into study time;
// the week view moves a block to another day by dragging.
import { createNew, expect, loadExample, navTo, openDialog, test, toast, dragBy } from './fixtures';

test('Plan unscheduled work adds sessions into study time', async ({ page }) => {
  await page.goto('/#/day/2026-10-07');

  let dialog = await createNew(page, 'Study time');
  await dialog.getByRole('textbox', { name: 'Label' }).fill('After school');
  await dialog.getByRole('textbox', { name: 'From' }).fill('15:30');
  await dialog.getByRole('textbox', { name: 'Until' }).fill('21:00');
  await dialog.getByRole('button', { name: 'Add study time' }).click();
  await expect(dialog).toBeHidden();

  dialog = await createNew(page, 'Assignment');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('History essay');
  await dialog.getByRole('textbox', { name: 'Due: date' }).fill('2026-10-12');
  await dialog.getByRole('textbox', { name: 'Due: time (optional)' }).fill('23:59');
  await dialog.getByRole('spinbutton', { name: 'Estimated total time' }).fill('180');
  await dialog.getByRole('button', { name: 'Add assignment' }).click();
  await expect(dialog).toBeHidden();

  await navTo(page, 'Assignments');
  const totals = page.getByRole('region', { name: 'Workload totals' });
  await expect(totals).toContainText('Not yet scheduled3 h');

  await page.getByRole('button', { name: 'Plan unscheduled work' }).click();
  const plan = openDialog(page);
  await expect(plan.getByRole('heading', { name: 'Plan unscheduled work' })).toBeVisible();
  await expect(plan).toContainText('A fixed rule, not AI');
  await expect(plan.getByRole('heading', { name: 'Proposed sessions' })).toBeVisible();
  const sessions = plan.getByRole('checkbox');
  const count = await sessions.count();
  expect(count).toBeGreaterThan(0);
  await expect(plan).toContainText(`${count} of ${count} selected · 3 h`);
  await plan.getByRole('button', { name: count === 1 ? 'Add 1 session' : `Add ${count} sessions` }).click();
  await expect(plan).toBeHidden();
  await expect(toast(page, /^Added \d+ work sessions? \(3 h\) to your schedule\./)).toBeVisible();
  await expect(totals).toContainText('Not yet scheduled0 m');

  // Nothing is left to plan.
  await page.getByRole('button', { name: 'Plan unscheduled work' }).click();
  await expect(openDialog(page).getByRole('heading', { name: 'Nothing to plan' })).toBeVisible();
  await openDialog(page).getByRole('button', { name: 'Cancel' }).click();

  // The next session is linked from the assignment and opens its day.
  await page.getByRole('link', { name: /^(Wed|Thu|Fri|Sat|Sun|Mon), Oct \d+, \d+:\d\d (AM|PM)$/ }).first().click();
  await expect(page).toHaveURL(/#\/day\/2026-10-\d\d$/);
  await expect(page.getByRole('button', { name: /^History essay, .*Planned/ }).first()).toBeVisible();
});

test('Week view: drag a block to the next day; it is pinned', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/week/2026-10-12');
  await expect(page.getByRole('heading', { level: 1, name: 'Week of Oct 12 – 18' })).toBeVisible();
  const week = page.getByRole('group', { name: 'Week of Oct 12 – 18' });
  const monday = week.getByRole('group', { name: 'Monday, October 12' });
  const tuesday = week.getByRole('group', { name: 'Tuesday, October 13' });
  const block = monday.getByRole('button', { name: /^English 10 \/ Read Othello Act 3, 6:30 – 7:20 PM/ });
  await expect(block).toBeVisible();
  await expect(tuesday.getByRole('button', { name: /^English 10 \/ Read Othello Act 3/ })).toHaveCount(0);

  const mondayBox = (await monday.boundingBox())!;
  const tuesdayBox = (await tuesday.boundingBox())!;
  await dragBy(page, block, 0, tuesdayBox.x - mondayBox.x);

  const moved = tuesday.getByRole('button', { name: /^English 10 \/ Read Othello Act 3, 6:30 – 7:20 PM/ });
  await expect(moved).toBeVisible();
  await expect(monday.getByRole('button', { name: /^English 10 \/ Read Othello Act 3/ })).toHaveCount(0);
  await expect(toast(page, /^Moved “.*Read Othello Act 3.*” to Tue, Oct 13, 6:30 – 7:20 PM\./)).toBeVisible();

  // Moving a block placed by /academic-schedule pins it, so later imports keep the new time.
  await page.waitForTimeout(500); // a click right after a drag is ignored on purpose
  await moved.click();
  const actions = openDialog(page);
  await expect(actions.getByRole('group', { name: 'Session status' }).getByRole('button', { name: 'Unpin' })).toBeVisible();
});
