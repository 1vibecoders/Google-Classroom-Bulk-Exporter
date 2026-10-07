// End-to-end: "Export all classes" with the real extension (popup, service
// worker, content scripts, offscreen document, chrome.downloads) against a
// mock Google account with several classes, one of which fails to load.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { accountScenario } from '../mock/classroom-mock.mjs';
import { classroomTabId, launchWithExtension, openPopup, startMockServer, waitForJob } from '../helpers/extension.mjs';
import { inspectZip, unzipTest } from '../helpers/zip.mjs';

const account = accountScenario();
const [english, biology, biologyTaught, chemistry] = account.classes;
const HOME = 'https://classroom.google.com/u/1/h';
const FINISHED = ['complete', 'failed', 'cancelled'];
let mock;
let browser;
let skipReason = null;
let singleClassZip = null;

before(async () => {
  try {
    mock = await startMockServer(account);
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

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readJob(popup) {
  return popup.evaluate(async () => (await chrome.storage.session.get('gcx.job'))['gcx.job'] || null);
}

/** The archive a finished job saved, checked with unzip and inspected with Python. */
async function savedArchive(popup, job) {
  const download = await popup.evaluate(async (id) => (await chrome.downloads.search({ id }))[0], job.result.downloadId);
  assert.equal(download.state, 'complete');
  assert.ok(existsSync(download.filename), download.filename);
  assert.match(unzipTest(download.filename), /No errors detected/);
  return { zip: inspectZip(download.filename) };
}

function filesUnder(zip, folder) {
  const out = {};
  for (const e of zip.entries) if (e.name.startsWith(`${folder}/`)) out[e.name.slice(folder.length + 1)] = e;
  return out;
}

async function openClassroom(url) {
  const { context, worker, extensionId } = browser;
  const page = await context.newPage();
  await page.goto(url);
  const tabId = await classroomTabId(worker, url);
  assert.ok(tabId, 'Classroom tab found');
  const popup = await openPopup(context, worker, extensionId, tabId);
  return { page, popup };
}

/** Click "Export all classes" and wait for the class list to be shown for confirmation. */
async function listClasses(popup) {
  await popup.waitForFunction(() => !document.getElementById('all-btn').disabled, null, { timeout: 20000 });
  const before = await readJob(popup);
  await popup.click('#all-btn');
  const listed = await waitForJob(popup, (j) => j.id !== (before && before.id) && ['scanned', ...FINISHED].includes(j.phase), { timeout: 60000 });
  assert.equal(listed.phase, 'scanned', JSON.stringify(listed.error));
  await popup.waitForFunction(() => !document.getElementById('classes-buttons').hidden);
  return listed;
}

test('a single class still exports on its own, with a class manifest', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const url = `https://classroom.google.com/u/1/w/${english.course.id}/t/all`;
  const { page, popup } = await openClassroom(url);
  await popup.waitForFunction(() => !document.getElementById('export-btn').disabled, null, { timeout: 20000 });
  assert.equal(await popup.isEnabled('#all-btn'), true, 'all classes can be exported from a class page too');
  await popup.click('#export-btn');
  const done = await waitForJob(popup, (j) => FINISHED.includes(j.phase));
  assert.equal(done.phase, 'complete', JSON.stringify(done.error));
  assert.equal(done.kind, 'class');
  const { zip } = await savedArchive(popup, done);
  const manifest = JSON.parse(zip.entries.find((e) => e.name === 'English 10 - Period 3/export-manifest.json').text);
  assert.equal(manifest.kind, 'class');
  assert.deepEqual(manifest.classes.map((c) => [c.name, c.folder, c.status]), [['English 10', '.', 'partial']]);
  singleClassZip = zip;
  await popup.click('#done-btn');
  await popup.close();
  await page.close();
});

test('exports every active class of the account into one ZIP', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, popup } = await openClassroom(HOME);
  await popup.waitForFunction(() => document.getElementById('class-name').textContent === 'No class open', null, { timeout: 20000 });
  assert.equal(await popup.isEnabled('#export-btn'), false);

  // 1. The classes of the home page are listed for confirmation; the archived one is not.
  const listed = await listClasses(popup);
  assert.deepEqual(
    listed.account.classes.map((c) => [c.courseId, c.name, c.section, c.teacher, c.status]),
    [
      [english.course.id, 'English 10', 'Period 3', 'Ms. Smith', 'pending'],
      [biology.course.id, 'Biology', 'Period 1', 'Mr. Jones', 'pending'],
      [biologyTaught.course.id, 'Biology', 'Period 1', null, 'pending'],
      [chemistry.course.id, 'Chemistry', 'Period 5', 'Dr. Brown', 'pending'],
    ],
  );
  assert.equal(await popup.textContent('#classes-title'), '4 classes found');
  assert.deepEqual(await popup.$$eval('#classes-list li', (els) => els.map((e) => e.textContent)), [
    'English 10 · Period 3 — Ms. Smith',
    'Biology · Period 1 — Mr. Jones',
    'Biology · Period 1',
    'Chemistry · Period 5 — Dr. Brown',
  ]);
  assert.equal(await popup.textContent('#all-confirm-btn'), 'Export 4 classes');
  assert.equal(await popup.isVisible('#export-btn'), false, 'only the confirmation is offered');

  // 2. Export: one class after the other, with "Class k of N" progress.
  await popup.click('#all-confirm-btn');
  const shown = new Set();
  let done = null;
  const started = Date.now();
  while (Date.now() - started < 240000) {
    done = await readJob(popup);
    const line = await popup.textContent('#progress-class');
    if (line) shown.add(line);
    if (done && done.kind === 'account' && FINISHED.includes(done.phase)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(done.phase, 'complete', JSON.stringify(done.error));
  assert.equal(done.reusedScan, true, 'the confirmed list was used');
  for (const line of ['Class 1 of 4: English 10 · Period 3', 'Class 2 of 4: Biology · Period 1', 'Class 4 of 4: Chemistry · Period 5']) {
    assert.ok(shown.has(line), `"${line}" not shown; saw: ${[...shown].join(' | ')}`);
  }
  // The failing class did not stop the others.
  assert.deepEqual(
    done.account.classes.map((c) => [c.status, c.folder]),
    [
      ['partial', 'English 10 - Period 3'],
      ['exported', 'Biology - Period 1'],
      ['exported', 'Biology - Period 1 (2)'],
      ['failed', null],
    ],
  );
  assert.match(done.account.classes[3].error, /The Classwork page did not load/);
  const s = done.result.summary;
  assert.deepEqual([s.classes, s.classesExported, s.classesPartial, s.classesFailed, s.items, s.filesDownloaded, s.filesFailed], [4, 2, 1, 1, 18, 15, 1]);

  await popup.waitForFunction(() => document.getElementById('result-title').textContent === 'Export complete.');
  assert.equal(await popup.isVisible('#all-confirm-btn'), false, 'confirmation is gone');
  assert.deepEqual(await popup.$$eval('#classes-list .mark', (els) => els.map((e) => e.textContent)), ['!', '✓', '✓', '✗']);
  const lines = await popup.$$eval('#result-lines li', (els) => els.map((e) => e.textContent));
  assert.ok(lines.includes('3 of 4 classes exported'), lines.join('|'));
  assert.ok(lines.includes('1 class could not be exported'), lines.join('|'));
  assert.ok(lines.includes(`Saved: Downloads/Classroom Exports/All classes - ${today()}.zip`), lines.join('|'));
  await popup.click('#details-btn');
  const details = await popup.textContent('#details');
  assert.match(details, /Classes not exported \(1\)Chemistry · Period 5The Classwork page did not load/);
  assert.match(details, /English 10 · Assignment: Essay: Unit 1 — rubric\.pdf/);

  // 3. One archive with a folder per class. (The browser under test stores
  // downloads under generated names, so the file name is checked on the job.)
  assert.equal(done.result.archiveName, `All classes - ${today()}.zip`);
  const { zip } = await savedArchive(popup, done);
  const ROOT = `Google Classroom Export - ${today()}`;
  assert.ok(zip.entries.every((e) => e.name.startsWith(`${ROOT}/`)), 'one top-level folder');
  const top = new Set(zip.entries.map((e) => e.name.slice(ROOT.length + 1).split('/')[0]));
  assert.deepEqual([...top].sort(), ['Biology - Period 1', 'Biology - Period 1 (2)', 'English 10 - Period 3', 'export-manifest.json', 'export-report.txt', 'index.html']);
  const byName = Object.fromEntries(zip.entries.map((e) => [e.name, e]));

  const manifest = JSON.parse(byName[`${ROOT}/export-manifest.json`].text);
  assert.equal(manifest.kind, 'account');
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.accountIndex, 1);
  assert.ok(!Number.isNaN(Date.parse(manifest.exportedAt)));
  assert.deepEqual(manifest.options, { includeAnnouncements: true, readItemPages: true, googleFilesExportedAs: 'office' });
  assert.equal(manifest.extension.name, 'Google Classroom Bulk Exporter');
  assert.deepEqual(
    manifest.classes.map((c) => [c.courseId, c.name, c.section, c.teacher, c.folder, c.status, c.counts && c.counts.items]),
    [
      [english.course.id, 'English 10', 'Period 3', 'Ms. Smith', 'English 10 - Period 3', 'partial', 14],
      [biology.course.id, 'Biology', 'Period 1', 'Mr. Jones', 'Biology - Period 1', 'exported', 3],
      [biologyTaught.course.id, 'Biology', 'Period 1', null, 'Biology - Period 1 (2)', 'exported', 1],
      [chemistry.course.id, 'Chemistry', 'Period 5', 'Dr. Brown', null, 'failed', null],
    ],
  );
  assert.match(manifest.classes[3].error, /The Classwork page did not load/);
  assert.deepEqual(
    { ...manifest.totals, bytesDownloaded: 0 },
    { classes: 4, exported: 2, partial: 1, failed: 1, items: 18, filesDownloaded: 15, filesFailed: 1, linksSaved: 6, bytesDownloaded: 0 },
  );

  const report = byName[`${ROOT}/export-report.txt`].text;
  assert.match(report, /^Export Report: All classes\n/);
  assert.match(report, /\nClasses: 4 \(2 exported, 1 partially exported, 1 not exported\)\n/);
  assert.match(report, /\n4\. Chemistry \(Period 5\): failed -> not exported\n {3}Reason: The Classwork page did not load/);
  for (const heading of ['Class 1 of 4: English 10 (Period 3)', 'Class 2 of 4: Biology (Period 1)', 'Class 3 of 4: Biology (Period 1)', 'Class 4 of 4: Chemistry (Period 5)']) {
    assert.ok(report.includes(`\n${heading}\n`), heading);
  }
  assert.match(report, /- Assignment: Essay: Unit 1\n {4}File: rubric\.pdf/);
  const index = byName[`${ROOT}/index.html`].text;
  assert.match(index, /href="English%2010%20-%20Period%203\/index\.html"/);
  assert.match(index, /href="Biology%20-%20Period%201%20\(2\)\/index\.html"/);

  // Each class folder is the single-class layout: English 10 matches its own
  // export file for file (generated files differ only in their timestamps).
  const alone = filesUnder(singleClassZip, 'English 10 - Period 3');
  delete alone['export-manifest.json'];
  const inAccount = filesUnder(zip, `${ROOT}/English 10 - Period 3`);
  assert.deepEqual(Object.keys(inAccount).sort(), Object.keys(alone).sort());
  for (const [rel, entry] of Object.entries(alone)) {
    if (rel.includes('/')) assert.equal(inAccount[rel].sha1, entry.sha1, rel);
  }
  for (const folder of ['Biology - Period 1', 'Biology - Period 1 (2)']) {
    const files = filesUnder(zip, `${ROOT}/${folder}`);
    for (const f of ['class-info.json', 'class-description.txt', 'export-report.txt', 'export-report.json', 'index.html']) assert.ok(files[f], `${folder}/${f}`);
  }
  assert.ok(byName[`${ROOT}/Biology - Period 1/Assignments/Cell diagram/Attachments/cell.pdf`]);
  assert.ok(byName[`${ROOT}/Biology - Period 1/Materials/Lab safety/Attachments/Lab safety rules.url`]);
  assert.ok(byName[`${ROOT}/Biology - Period 1/Announcements/Lab coats on Thursday/description.txt`]);
  assert.ok(byName[`${ROOT}/Biology - Period 1 (2)/Assignments/Microscope worksheet/Attachments/Microscope worksheet.docx`]);
  const taught = JSON.parse(byName[`${ROOT}/Biology - Period 1 (2)/class-info.json`].text);
  assert.equal(taught.class.id, biologyTaught.course.id);

  // The archived class was never opened, and the tab is back where it started.
  const archivedId = account.archived[0].course.id;
  assert.ok(!mock.log.some((l) => l.includes(archivedId)), 'archived class not visited');
  assert.ok(!zip.entries.some((e) => e.name.includes('World History')));
  await page.waitForURL(HOME, { timeout: 15000 });
  await popup.click('#done-btn');
  await popup.close();
  await page.close();
});

test('cancel stops an account export between classes and takes the tab back', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, popup } = await openClassroom(HOME);
  await listClasses(popup);
  await popup.click('#all-confirm-btn');
  await waitForJob(popup, (j) => j.kind === 'account' && j.phase === 'discovering' && j.account.classIndex === 1, { timeout: 120000 });
  await popup.click('#cancel-btn');
  const cancelled = await waitForJob(popup, (j) => FINISHED.includes(j.phase), { timeout: 30000 });
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(cancelled.error.code, 'cancelled');
  await popup.waitForFunction(() => document.getElementById('result-title').textContent === 'Export cancelled.');
  await page.waitForURL(HOME, { timeout: 15000 });
  // Nothing resumes afterwards.
  await new Promise((r) => setTimeout(r, 2000));
  const later = await readJob(popup);
  assert.equal(later.phase, 'cancelled');
  assert.equal(later.result, null);
  await popup.close();
  await page.close();
});

/** Save changes to the persisted job, as if time had passed. */
function editJob(popup, changes) {
  return popup.evaluate(async (changes) => {
    const job = (await chrome.storage.session.get('gcx.job'))['gcx.job'];
    if (changes.listedAgo != null) job.account.listedAt = Date.now() - changes.listedAgo;
    if (changes.silentFor != null) job.lastActivity = Date.now() - changes.silentFor;
    await chrome.storage.session.set({ 'gcx.job': job });
  }, changes);
}

test('a class list that is out of date or of another account is not exported without a new confirmation', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, popup } = await openClassroom(HOME);
  const first = await listClasses(popup);

  // Confirming a list older than 15 minutes lists the classes again.
  await editJob(popup, { listedAgo: 16 * 60 * 1000 });
  await popup.click('#all-confirm-btn');
  const again = await waitForJob(popup, (j) => j.id !== first.id && ['scanned', ...FINISHED].includes(j.phase), { timeout: 60000 });
  assert.equal(again.phase, 'scanned', JSON.stringify(again.error));
  assert.equal(again.mode, 'scan');
  assert.equal(again.account.classes.length, 4);
  assert.equal(again.result, null, 'nothing was exported');
  await popup.waitForFunction(() => !document.getElementById('classes-buttons').hidden);
  await popup.close();

  // Once the tab shows another account, the list is no longer offered.
  await page.goto('https://classroom.google.com/u/0/h');
  const tabId = await classroomTabId(browser.worker, 'https://classroom.google.com/u/0/h');
  const other = await openPopup(browser.context, browser.worker, browser.extensionId, tabId);
  await other.waitForFunction(() => document.getElementById('class-name').textContent === 'No class open', null, { timeout: 20000 });
  assert.equal(await other.isVisible('#classes'), false);
  assert.equal(await other.isVisible('#all-confirm-btn'), false);
  assert.equal(await other.isEnabled('#all-btn'), true);
  await other.close();
  await page.close();
});

test('leaving Classroom while an earlier class downloads stops the export and keeps the tab where the user went', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, popup } = await openClassroom(HOME);
  await listClasses(popup);
  account.downloadDelayMs = 1500;
  try {
    await popup.click('#all-confirm-btn');
    await waitForJob(popup, (j) => j.kind === 'account' && j.phase === 'downloading' && j.account.classIndex === 0, { timeout: 120000 });
    const requestsBefore = mock.log.length;
    await page.goto('https://example.com/');
    const failed = await waitForJob(popup, (j) => FINISHED.includes(j.phase), { timeout: 30000 });
    assert.equal(failed.phase, 'failed');
    assert.equal(failed.error.code, 'navigated-away');
    assert.match(failed.error.message, /left Classroom/);
    // The next class was not opened in the tab.
    await new Promise((r) => setTimeout(r, 2000));
    assert.match(page.url(), /^https:\/\/example\.com\//);
    assert.ok(!mock.log.slice(requestsBefore).some((l) => l.includes(`/w/${biology.course.id}/`)), 'Biology was not opened');
  } finally {
    account.downloadDelayMs = 0;
  }
  await popup.close();
  await page.close();
});

test('a class scan that went silent is scanned again and the export goes on', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { page, popup } = await openClassroom(HOME);
  await listClasses(popup);
  await popup.click('#all-confirm-btn');
  await waitForJob(popup, (j) => j.kind === 'account' && j.phase === 'discovering' && j.account.classIndex === 1, { timeout: 120000 });
  const tabId = await classroomTabId(browser.worker, 'https://classroom.google.com/u/1/');

  // Stop the scan in the tab behind the background's back, as if the worker
  // had been suspended before the step reached the tab, and let time pass.
  const toTab = (type) => popup.evaluate(({ tabId, type }) => chrome.tabs.sendMessage(tabId, { target: 'content', type }, { frameId: 0 }).catch(() => null), { tabId, type });
  let quiet = null;
  for (let i = 0; i < 40 && !quiet; i++) {
    await toTab('cs/cancel');
    await new Promise((r) => setTimeout(r, 750));
    const ping = await toTab('cs/ping');
    const job = await readJob(popup);
    if (ping && ping.jobId === null && job.phase === 'discovering' && job.account.classIndex === 1 && !job.nav) {
      await new Promise((r) => setTimeout(r, 1000));
      const later = await readJob(popup);
      if (later.updatedAt === job.updatedAt) quiet = later;
    }
  }
  assert.ok(quiet, 'the scan of class 2 was stopped');
  await editJob(popup, { silentFor: 120000 });

  // The next look at the job (the popup's, or the archive builder's watchdog) resumes it.
  await popup.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'popup/get-state' }));
  const done = await waitForJob(popup, (j) => FINISHED.includes(j.phase), { timeout: 180000 });
  assert.equal(done.phase, 'complete', JSON.stringify(done.error));
  assert.equal(done.account.restarted, 1);
  assert.deepEqual(
    done.account.classes.map((c) => c.status),
    ['partial', 'exported', 'exported', 'failed'],
  );
  await page.waitForURL(HOME, { timeout: 15000 });
  await popup.close();
  await page.close();
});
