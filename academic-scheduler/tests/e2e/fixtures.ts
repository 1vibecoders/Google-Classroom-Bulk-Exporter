// Shared Playwright setup for the end-to-end tests.
//
// - The clock starts at Wednesday, October 7, 2026, 10:00 AM (New York time,
//   the time zone set in playwright.config.ts), the "today" the shipped
//   examples were written for, and then runs normally. So "today", "in 5
//   days" and "has this session passed?" never depend on when the tests run.
// - Every console error, console warning and uncaught page error fails the test.
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const NOW = new Date('2026-10-07T10:00:00-04:00');
export const EXAMPLE_FILE = fileURLToPath(new URL('../../examples/complete-schedule.json', import.meta.url));

export const test = base.extend<{ consoleProblems: string[] }>({
  consoleProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
      await page.clock.install({ time: NOW });
      await use(problems);
      expect(problems, 'console errors, warnings and page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The dialog that is open (native <dialog open>). */
export function openDialog(page: Page): Locator {
  return page.locator('dialog[open]');
}

/** Open the header's "+ New" menu and pick an item. */
export async function createNew(page: Page, item: 'Assignment' | 'Scheduled work block' | 'Class' | 'Event or commitment' | 'Study time'): Promise<Locator> {
  await page.getByRole('button', { name: 'Create new' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  const dialog = openDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Settings → "Load example schedule" → confirm. */
export async function loadExample(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Load example schedule' }).click();
  const dialog = openDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Load the example schedule?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Load example' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Example schedule loaded (week of Oct 12, 2026).')).toBeVisible();
}

/** Click a main navigation link (Day, Week, Assignments, Classes, Commitments). */
export async function navTo(page: Page, name: 'Day' | 'Week' | 'Assignments' | 'Classes' | 'Commitments'): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
}

/**
 * Drag an element vertically by `dy` pixels with the mouse, in small steps.
 * The element is first scrolled to the middle of the window so that the
 * timeline's auto-scroll (near the window's edges) does not kick in.
 */
export async function dragBy(page: Page, target: Locator, dy: number, dx = 0): Promise<void> {
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = await target.boundingBox();
  if (!box) throw new Error('dragBy: the element is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(10, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
  await page.mouse.up();
}

/** One notification (toast) whose text contains `text`. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('.toasts > *').filter({ hasText: text });
}

/** The Day view's timeline column for one day. */
export function dayTimeline(page: Page, longDate: string): Locator {
  return page.getByRole('group', { name: `Timeline for ${longDate}` });
}
