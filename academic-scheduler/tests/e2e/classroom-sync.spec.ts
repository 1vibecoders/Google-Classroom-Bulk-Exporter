// Google Classroom sync in the browser, against a mocked backend: the
// allowance is shown, a sync opens the import preview with only the real
// changes, and a refusal from the server is shown without changing anything.
import { expect, loadExample, navTo, test } from './fixtures';

const ALLOWANCE = { limit: 3, remaining: 2, nextAvailableAt: null, running: false };

const BATCH = {
  batchVersion: 1,
  sourceType: 'classroom_api',
  importedAt: '2026-10-07T10:00:00',
  timezone: 'America/New_York',
  courses: [{ id: 'gc-class-NjI3ODk0MjE0NTQ5', sourceId: 'NjI3ODk0MjE0NTQ5', name: 'English 10', state: 'present' }],
  assignments: [
    { id: 'gc-NzAwMDAwMDAwMDAx', classId: 'gc-class-NjI3ODk0MjE0NTQ5', sourceId: 'NzAwMDAwMDAwMDAx', title: 'Othello Essay', due: '2026-10-16T23:59:00', state: 'present' },
    { id: 'gc-NzAwMDAwMDAwMDA5', classId: 'gc-class-NjI3ODk0MjE0NTQ5', sourceId: 'NzAwMDAwMDAwMDA5', title: 'Poetry analysis', due: '2026-10-20T23:59:00', state: 'present' },
  ],
  counts: { new: 1, changed: 0, unchanged: 1, missing: 0 },
  warnings: ['The coursework of “Biology” could not be read (Google refused access). Its items were left as they were.'],
};

test('a sync opens the import preview with the new Classroom work', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: { signedIn: true, email: 'student@example.com', allowance: ALLOWANCE } }));
  let body: unknown = null;
  await page.route('**/api/sync', (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { batch: BATCH, allowance: { ...ALLOWANCE, remaining: 1 } } });
  });
  await loadExample(page);
  const card = page.getByRole('region', { name: 'Google Classroom sync' });
  await expect(card).toContainText('Signed in as student@example.com. 2 of 3 syncs left in the last 24 hours.');

  await card.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('heading', { name: 'Review the changes from “Google Classroom sync”' })).toBeVisible();
  expect(body).toEqual({ timezone: 'America/New_York' });
  const summary = page.getByRole('region', { name: 'Schedule Import' });
  await expect(summary).toContainText('+ 1 assignment');
  await expect(page.getByText('Poetry analysis').first()).toBeVisible();
  // Sync warnings are listed with the file's warnings.
  await page.getByText(/warnings? about the file/).click();
  await expect(page.getByText('The coursework of “Biology” could not be read')).toBeVisible();
});

test('synced announcements and turned-in work show up after the import', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: { signedIn: true, email: 'student@example.com', allowance: ALLOWANCE } }));
  const batch = structuredClone(BATCH);
  Object.assign(batch.courses[0], {
    announcements: [{ text: 'Essay conferences are on Thursday.', postedAt: '2026-10-06T08:15:00', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/p/1' }],
  });
  Object.assign(batch.assignments[1], { topic: 'Poetry', turnedIn: true });
  await page.route('**/api/sync', (route) => route.fulfill({ json: { batch, allowance: { ...ALLOWANCE, remaining: 1 } } }));
  await loadExample(page);
  await page.getByRole('region', { name: 'Google Classroom sync' }).getByRole('button', { name: 'Sync now' }).click();
  await page.getByRole('region', { name: 'Schedule Import' }).getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('region', { name: 'Schedule imported' })).toBeVisible();

  await navTo(page, 'Classes');
  const english = page.getByRole('article', { name: 'English 10' });
  await english.getByText('Announcements (1)').click();
  await expect(english.getByText('Essay conferences are on Thursday.')).toBeVisible();
  await expect(english.getByRole('link', { name: 'Open in Classroom' })).toHaveAttribute('href', 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/p/1');
});

test('a refused sync is explained and changes nothing', async ({ page }) => {
  const used = { ...ALLOWANCE, remaining: 0, nextAvailableAt: '2026-10-08T09:00:00.000Z' };
  await page.route('**/api/me', (route) => route.fulfill({ json: { signedIn: true, email: 'student@example.com', allowance: used } }));
  await loadExample(page);
  const card = page.getByRole('region', { name: 'Google Classroom sync' });
  await expect(card).toContainText('No syncs left: the next one is available');
  await expect(card.getByRole('button', { name: 'Sync now' })).toBeDisabled();
});

test('without a sync backend the card says so and the rest of the site works', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html>' }));
  await loadExample(page);
  await expect(page.getByRole('region', { name: 'Google Classroom sync' })).toContainText('needs the online version of this website');
});
