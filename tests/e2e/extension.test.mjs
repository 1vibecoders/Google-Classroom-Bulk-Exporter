// End-to-end: the real extension (service worker, popup, content scripts,
// offscreen document, chrome.downloads) exporting the mock Classroom.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { defaultScenario, urls } from '../mock/classroom-mock.mjs';
import { classroomTabId, launchWithExtension, openPopup, startMockServer, waitForJob } from '../helpers/extension.mjs';
import { inspectZip, unzipTest } from '../helpers/zip.mjs';

const scenario = defaultScenario();
const u = urls(scenario);
let mock;
let browser;
let skipReason = null;

before(async () => {
  try {
    mock = await startMockServer(scenario);
  } catch (err) {
    skipReason = `cannot listen on 127.0.0.1:443 (${err.code}); run as a user allowed to bind port 443`;
    return;
  }
  browser = await launchWithExtension();
});

after(async () => {
  if (browser) await browser.context.close();
  if (mock) await mock.close();
});

test('exports a class from the popup into a ZIP in Downloads', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { context, worker, extensionId } = browser;
  const page = await context.newPage();
  await page.goto(u.stream);
  const tabId = await classroomTabId(worker, u.stream);
  assert.ok(tabId, 'Classroom tab found');

  const popup = await openPopup(context, worker, extensionId, tabId);
  await popup.waitForFunction(() => document.getElementById('class-name').textContent.includes('English 10'), null, { timeout: 20000 });
  assert.equal(await popup.textContent('#class-name'), 'English 10 · Period 3');
  assert.equal(await popup.isEnabled('#export-btn'), true);

  // Scan first: counts appear without downloading anything.
  await popup.click('#scan-btn');
  const scanned = await waitForJob(popup, (j) => ['scanned', 'failed'].includes(j.phase));
  assert.equal(scanned.phase, 'scanned', JSON.stringify(scanned.error));
  assert.deepEqual(
    { a: scanned.counts.assignment, m: scanned.counts.material, q: scanned.counts.question, p: scanned.counts.announcement, files: scanned.counts.files, links: scanned.counts.links },
    { a: 4, m: 5, q: 1, p: 4, files: 14, links: 5 },
  );
  await popup.waitForFunction(() => !document.getElementById('counts').hidden);
  assert.equal(await popup.textContent('#c-assignment'), '4');
  assert.equal(await popup.textContent('#c-files'), '14');
  // The tab was taken back to where the user started.
  await page.waitForURL(u.stream, { timeout: 15000 });

  // Export reuses the fresh scan.
  const downloadsBefore = mock.log.filter((l) => l.startsWith('drive.usercontent')).length;
  assert.equal(downloadsBefore, 0, 'scan does not download files');
  await popup.click('#export-btn');
  const done = await waitForJob(popup, (j) => ['complete', 'failed', 'cancelled'].includes(j.phase));
  assert.equal(done.phase, 'complete', JSON.stringify(done.error));
  assert.equal(done.reusedScan, true);
  assert.equal(done.result.summary.filesDownloaded, 13);
  assert.equal(done.result.summary.filesFailed, 1);
  assert.equal(done.result.summary.linksSaved, 5);
  assert.equal(done.result.failures[0].file, 'rubric.pdf');

  await popup.waitForFunction(() => document.getElementById('result-title').textContent === 'Export complete.');
  const lines = await popup.$$eval('#result-lines li', (els) => els.map((e) => e.textContent));
  assert.ok(lines.includes('14 items processed'), lines.join('|'));
  assert.ok(lines.some((l) => /^13 files downloaded/.test(l)), lines.join('|'));
  assert.ok(lines.includes('1 file could not be downloaded'), lines.join('|'));
  await popup.click('#details-btn');
  assert.match(await popup.textContent('#details'), /Assignment: Essay: Unit 1 — rubric\.pdf/);

  // The archive was saved through chrome.downloads and is valid.
  const download = await popup.evaluate(async (id) => (await chrome.downloads.search({ id }))[0], done.result.downloadId);
  assert.equal(download.state, 'complete');
  assert.ok(existsSync(download.filename), download.filename);
  assert.match(unzipTest(download.filename), /No errors detected/);
  const zip = inspectZip(download.filename);
  const names = new Set(zip.entries.map((e) => e.name));
  for (const f of [
    'English 10 - Period 3/class-info.json',
    'English 10 - Period 3/export-report.txt',
    'English 10 - Period 3/Assignments/Macbeth Act 1 Questions/Attachments/Macbeth.pdf',
    'English 10 - Period 3/Assignments/Macbeth Act 1 Questions/Attachments/Act 1 slides.pptx',
    // Two materials share a title; the one listed first on the page keeps it.
    'English 10 - Period 3/Materials/Poetry Terms/Attachments/notes (2).pdf',
    'English 10 - Period 3/Materials/Poetry Terms (2)/Attachments/terms.pdf',
    'English 10 - Period 3/Materials/Late addition/Attachments/late.pdf',
    'English 10 - Period 3/Announcements/Welcome to English 10!/Attachments/Syllabus.pdf',
  ]) {
    assert.ok(names.has(f), `missing ${f}`);
  }
  assert.ok(![...names].some((n) => /my answers|essay draft/.test(n)), 'student work not exported');
  await popup.close();
});

test('stops cleanly when the user navigates away during the scan', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { context, worker, extensionId } = browser;
  const page = await context.newPage();
  await page.goto(u.classwork);
  const tabId = await classroomTabId(worker, u.classwork);
  const popup = await openPopup(context, worker, extensionId, tabId);
  await popup.waitForFunction(() => !document.getElementById('export-btn').disabled, null, { timeout: 20000 });
  await popup.click('#done-btn').catch(() => {});
  await popup.click('#export-btn');
  await waitForJob(popup, (j) => j.phase === 'discovering' && j.discovery && /Reading classwork|Loading/.test(j.discovery.message || ''));
  await page.goto('https://classroom.google.com/u/1/h');
  const failed = await waitForJob(popup, (j) => ['failed', 'complete'].includes(j.phase), { timeout: 30000 });
  assert.equal(failed.phase, 'failed');
  assert.match(failed.error.message, /navigated away|left the class/);
  await popup.waitForFunction(() => !document.getElementById('error').hidden);
  await popup.close();
});
