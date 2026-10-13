// A class scan sent by the browser extension (as its injected script does:
// window.postMessage until a receipt) opens the usual import preview, and a
// message the website cannot use is refused with a reason.
import { expect, loadExample, test } from './fixtures';

const SCAN = {
  createdAt: '2026-10-07T14:00:00.000Z',
  classInfo: { courseId: 'NjI3ODk0MjE0NTQ5', name: 'English 10', section: 'Period 3', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5' },
  topics: [{ id: 't1', name: 'Unit 3: Othello' }],
  items: [
    {
      id: 'NzAwMDAwMDAwMDA5',
      type: 'assignment',
      title: 'Poetry analysis',
      topic: 'Unit 3: Othello',
      description: 'One sonnet.',
      classroomUrl: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDA5/details',
      meta: { dueText: 'Oct 20, 11:59 PM', pointsText: '20 points', postedText: 'Oct 5' },
      resources: [],
    },
  ],
  warnings: [],
};

async function send(page: import('@playwright/test').Page, data: Record<string, unknown>) {
  return page.evaluate(
    (message) =>
      new Promise<Record<string, unknown>>((resolve) => {
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'received' && event.data.id === message.id) resolve(event.data);
        });
        window.postMessage(message, window.location.origin);
      }),
    { protocol: 'academic-scheduler/extension-import', version: 1, type: 'import', id: 'e2e-1', ...data },
  );
}

test('a scan from the browser extension opens the import preview', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/import');
  expect(await send(page, { snapshots: [SCAN] })).toMatchObject({ ok: true, id: 'e2e-1' });
  await expect(page.getByRole('heading', { name: 'Review the changes from “Browser extension scan: English 10”' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Schedule Import' })).toContainText('+ 1 assignment');
  await expect(page.getByText('Poetry analysis').first()).toBeVisible();
});

test('a message the website cannot use is refused with a reason and changes nothing', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/import');
  expect(await send(page, { version: 99, snapshots: [SCAN] })).toMatchObject({ ok: false, message: expect.stringContaining('Update the extension') });
  await expect(page.getByRole('heading', { level: 1, name: 'Import schedule' })).toBeVisible();
});
