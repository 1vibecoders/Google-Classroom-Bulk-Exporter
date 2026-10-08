// Build a schedule by hand (class, assignment, event, study time, work block),
// drag the block, mark it done and export; the exported file is a valid
// schedule that imports again without changes.
import { readFileSync } from 'node:fs';
import { createNew, dayTimeline, dragBy, expect, navTo, openDialog, test, toast } from './fixtures';
import { validateDocument } from '../../src/lib/validate';

test('create items by hand, drag a block, mark it done and export', async ({ page }) => {
  await page.goto('/#/day/2026-10-08');
  await expect(page.getByRole('heading', { level: 1, name: 'Thursday, October 8' })).toBeVisible();

  // Class.
  let dialog = await createNew(page, 'Class');
  await dialog.getByRole('textbox', { name: 'Class name' }).fill('Chemistry');
  await dialog.getByRole('textbox', { name: 'Teacher' }).fill('Dr. Lee');
  await dialog.getByRole('button', { name: 'Add class' }).click();
  await expect(dialog).toBeHidden();

  // Assignment in that class.
  dialog = await createNew(page, 'Assignment');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Lab report');
  await dialog.getByRole('combobox', { name: 'Class' }).selectOption({ label: 'Chemistry' });
  await dialog.getByRole('textbox', { name: 'Due: date' }).fill('2026-10-09');
  await dialog.getByRole('textbox', { name: 'Due: time (optional)' }).fill('23:59');
  await dialog.getByRole('spinbutton', { name: 'Estimated total time' }).fill('90');
  await dialog.getByRole('button', { name: 'Add assignment' }).click();
  await expect(dialog).toBeHidden();

  // A one-time busy event.
  dialog = await createNew(page, 'Event or commitment');
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Soccer practice');
  await dialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Activity' });
  await dialog.getByRole('textbox', { name: 'Date' }).fill('2026-10-08');
  await dialog.getByRole('textbox', { name: 'Start time' }).fill('15:00');
  await dialog.getByRole('textbox', { name: 'End time' }).fill('16:30');
  await dialog.getByRole('button', { name: 'Add event' }).click();
  await expect(dialog).toBeHidden();

  // Weekday study time.
  dialog = await createNew(page, 'Study time');
  await dialog.getByRole('textbox', { name: 'Label' }).fill('After school');
  await dialog.getByRole('textbox', { name: 'From' }).fill('15:00');
  await dialog.getByRole('textbox', { name: 'Until' }).fill('21:00');
  await dialog.getByRole('button', { name: 'Add study time' }).click();
  await expect(dialog).toBeHidden();

  // A work block for the assignment.
  dialog = await createNew(page, 'Scheduled work block');
  await dialog.getByRole('combobox', { name: 'Assignment' }).selectOption({ label: 'Chemistry · Lab report (Oct 9)' });
  await dialog.getByRole('textbox', { name: 'Date' }).fill('2026-10-08');
  await dialog.getByRole('textbox', { name: 'Start' }).fill('18:00');
  await dialog.getByRole('textbox', { name: 'End' }).fill('19:00');
  await dialog.getByRole('button', { name: 'Add to schedule' }).click();
  await expect(dialog).toBeHidden();

  const timeline = dayTimeline(page, 'Thursday, October 8');
  await expect(timeline.getByRole('button', { name: /^Soccer practice, Activity, 3:00 – 4:30 PM, busy/ })).toBeVisible();
  const block = timeline.getByRole('button', { name: /^Chemistry \/ Lab report, 6:00 – 7:00 PM, 1 h, Planned/ });
  await expect(block).toBeVisible();
  await expect(timeline.getByText(/^Available/).first()).toBeVisible();
  const summary = page.getByRole('region', { name: 'Day summary' });
  await expect(summary).toContainText('Free study time4 h 30 m');
  await expect(summary).toContainText('Planned work1 h');

  // Drag the block 30 minutes later (56 px per hour in the Day view).
  await dragBy(page, block, 28);
  const moved = timeline.getByRole('button', { name: /^Chemistry \/ Lab report, 6:30 – 7:30 PM, 1 h, Planned/ });
  await expect(moved).toBeVisible();

  // Mark it done from the "In order" list.
  await page.getByRole('list', { name: 'Schedule for Thursday, October 8, in order' }).getByRole('checkbox', { name: 'Done: Chemistry / Lab report' }).check();
  await expect(timeline.getByRole('button', { name: /^Chemistry \/ Lab report, 6:30 – 7:30 PM, 1 h, Done/ })).toBeVisible();

  // The other views show the new items.
  await navTo(page, 'Classes');
  await expect(page.getByRole('article', { name: 'Chemistry' })).toContainText('Dr. Lee');
  await navTo(page, 'Assignments');
  await expect(page.getByRole('heading', { level: 3, name: 'Lab report' })).toBeVisible();
  await navTo(page, 'Commitments');
  await expect(page.getByRole('heading', { level: 3, name: 'Soccer practice' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'After school' })).toBeVisible();

  // Export.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('banner').getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^schedule-.*\.json$/);
  const file = await download.path();
  const text = readFileSync(file, 'utf8');
  const exported = JSON.parse(text);
  await expect(toast(page, /^Schedule exported\./)).toBeVisible();

  const result = validateDocument(exported, { today: '2026-10-07' });
  expect(result.errors).toEqual([]);
  expect(exported.schemaVersion).toBe('1.0');
  expect(exported.meta.exportId).toMatch(/^u-exp-/);
  expect(exported.classes.map((c: { name: string }) => c.name)).toEqual(['Chemistry']);
  expect(exported.assignments).toHaveLength(1);
  expect(exported.assignments[0]).toMatchObject({ title: 'Lab report', due: '2026-10-09T23:59:00', estimatedMinutes: 90 });
  expect(exported.scheduleBlocks).toHaveLength(1);
  expect(exported.scheduleBlocks[0]).toMatchObject({ start: '2026-10-08T18:30:00', end: '2026-10-08T19:30:00', status: 'done' });
  expect(exported.events.map((e: { title: string }) => e.title)).toEqual(['Soccer practice']);
  expect(exported.availability).toHaveLength(1);

  // Importing the exported file changes nothing.
  await page.goto('/#/import');
  await page.locator('input[type="file"]').setInputFiles({ name: 'exported.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByText('No changes.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Schedule Import' }).getByRole('button', { name: 'Import' })).toBeDisabled();
});

test('quick actions, keyboard moves, drag with Undo, and delete with confirmation', async ({ page }) => {
  await page.goto('/#/day/2026-10-08');
  const dialog = await createNew(page, 'Scheduled work block');
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Review flashcards');
  await dialog.getByRole('textbox', { name: 'Start' }).fill('16:00');
  await dialog.getByRole('textbox', { name: 'End' }).fill('16:30');
  await dialog.getByRole('button', { name: 'Add to schedule' }).click();
  await expect(dialog).toBeHidden();

  const timeline = dayTimeline(page, 'Thursday, October 8');
  const block = (name: string) => timeline.getByRole('button', { name: new RegExp(`^Review flashcards, ${name}`) });
  await expect(block('4:00 – 4:30 PM, 30 m, Planned')).toBeVisible();

  // Click → quick actions: move 15 minutes later, then skip.
  await block('4:00 – 4:30 PM').click();
  const actions = openDialog(page);
  await expect(actions.getByRole('heading', { name: 'Review flashcards' })).toBeVisible();
  await actions.getByRole('button', { name: '15 min later' }).click();
  await expect(actions).toContainText('4:15 – 4:45 PM');
  await actions.getByRole('group', { name: 'Session status' }).getByRole('button', { name: 'Skip' }).click();
  await expect(block('4:15 – 4:45 PM, 30 m, Skipped')).toBeVisible();
  if (await actions.isVisible()) await actions.getByRole('button', { name: 'Close' }).first().click();
  await expect(actions).toBeHidden();

  // Keyboard: Alt+Down moves the focused block 15 minutes later.
  await block('4:15 – 4:45 PM').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(block('4:30 – 5:00 PM')).toBeVisible();
  await expect(block('4:30 – 5:00 PM')).toBeFocused();

  // Drag 1 hour later (56 px), then undo from the notification.
  await dragBy(page, block('4:30 – 5:00 PM'), 56);
  await expect(block('5:30 – 6:00 PM')).toBeVisible();
  await toast(page, 'Moved “Review flashcards” to Thu, Oct 8, 5:30 – 6:00 PM.').getByRole('button', { name: 'Undo' }).click();
  await expect(block('4:30 – 5:00 PM')).toBeVisible();

  // A click right after a drag is ignored on purpose (it is the end of the
  // drag, not a click), so wait out that short window before clicking.
  await page.waitForTimeout(500);
  await block('4:30 – 5:00 PM').click();
  await openDialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this work block?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete block' }).click();
  await expect(timeline.getByRole('button', { name: /^Review flashcards/ })).toHaveCount(0);
  await expect(toast(page, 'Deleted “Review flashcards”.')).toBeVisible();
});
