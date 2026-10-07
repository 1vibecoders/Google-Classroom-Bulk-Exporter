// The account's class list, read from the mock Classroom home page by the real
// content scripts (the first step of "Export all classes").
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { accountScenario } from '../mock/classroom-mock.mjs';
import { injectContentScripts, launchBrowser, mockContext, runStep } from '../helpers/browser.mjs';

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser.close();
});

async function listClasses(account, { path = '/u/1/h' } = {}) {
  const context = await mockContext(browser, account);
  const page = await context.newPage();
  try {
    await page.goto(`https://classroom.google.com${path}`);
    await injectContentScripts(page);
    return await runStep(page, 'classes', { account: { authuser: account.authuser } });
  } finally {
    await context.close();
  }
}

test('lists the active classes of the account in home-page order', async () => {
  const account = accountScenario();
  const { result, reports } = await listClasses(account);
  // All four cards, although only two are rendered before scrolling.
  assert.deepEqual(
    result.classes.map((c) => [c.name, c.section, c.teacher]),
    [
      ['English 10', 'Period 3', 'Ms. Smith'],
      ['Biology', 'Period 1', 'Mr. Jones'],
      ['Biology', 'Period 1', null], // the user's own class: "28 students" is not a teacher
      ['Chemistry', 'Period 5', 'Dr. Brown'],
    ],
  );
  assert.deepEqual(
    result.classes.map((c) => c.courseId),
    account.classes.map((c) => c.course.id),
  );
  const english = result.classes[0];
  assert.equal(english.prefix, '/u/1');
  assert.equal(english.url, `https://classroom.google.com/u/1/c/${account.classes[0].course.id}`);
  // The archived class is only on the archived classes page.
  assert.ok(!result.classes.some((c) => c.name === 'World History'));
  assert.deepEqual(result.warnings, []);
  assert.ok(reports.some((r) => r.message === '4 classes found.'));
});

test('fails with a helpful message when the account has no active classes', async () => {
  const account = accountScenario({ classes: [] });
  await assert.rejects(listClasses(account), /No classes were found on the Classroom home page/);
});
