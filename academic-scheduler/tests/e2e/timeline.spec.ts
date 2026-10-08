// Day view: click empty time to add work there, then change its length by
// dragging its bottom edge.
import { dayTimeline, expect, openDialog, test, toast } from './fixtures';

test('click empty time to add work, then resize it from the bottom edge', async ({ page }) => {
  await page.goto('/#/day/2026-10-08');
  const timeline = dayTimeline(page, 'Thursday, October 8');
  const column = timeline.getByRole('group', { name: 'Thursday, October 8', exact: true });

  // Click just below the "7 PM" line.
  const tick = page.locator('.tl-tick', { hasText: /^7 PM$/ });
  await tick.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const tickBox = (await tick.boundingBox())!;
  const columnBox = (await column.boundingBox())!;
  await page.mouse.click(columnBox.x + columnBox.width / 2, tickBox.y + tickBox.height / 2 + 2);

  const editor = openDialog(page);
  await expect(editor.getByRole('heading', { name: 'Schedule work' })).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Date' })).toHaveValue('2026-10-08');
  await expect(editor.getByRole('textbox', { name: 'Start' })).toHaveValue('19:00');
  await expect(editor.getByRole('textbox', { name: 'End' })).toHaveValue('20:00');
  await editor.getByRole('textbox', { name: 'Title' }).fill('Practice piano');
  await editor.getByRole('button', { name: 'Add to schedule' }).click();
  await expect(editor).toBeHidden();

  const block = (times: string) => timeline.getByRole('button', { name: new RegExp(`^Practice piano, ${times}`) });
  await expect(block('7:00 – 8:00 PM, 1 h, Planned')).toBeVisible();

  // Drag the bottom edge 28 px down: 30 minutes longer (56 px per hour).
  await block('7:00 – 8:00 PM').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const handle = column.locator('.tl-resize').first();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + 2.8 * i);
  await page.mouse.up();
  await expect(block('7:00 – 8:30 PM, 1 h 30 m, Planned')).toBeVisible();
  await expect(toast(page, 'Moved “Practice piano” to Thu, Oct 8, 7:00 – 8:30 PM.')).toBeVisible();
});
