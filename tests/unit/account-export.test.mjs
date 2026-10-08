import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AccountExport, runExport } from '../../src/engine/export-engine.js';
import {
  AccountLayout,
  ACCOUNT_ROOT_FILES,
  accountArchiveName,
  accountRootName,
  classStatus,
  exportManifest,
  manifestClass,
} from '../../src/engine/account-content.js';
import { accountScenario, defaultScenario } from '../mock/classroom-mock.mjs';
import { expectedSnapshot, installMockFetch } from '../helpers/expected.mjs';
import { inspectZip, tempDir, unzipTest, writeBlob } from '../helpers/zip.mjs';

const OPTIONS = { includeAnnouncements: true, readDetailPages: true, googleFormat: 'office', saveAs: false };
const NOW = new Date(2026, 9, 7, 9, 0, 0);
const ROOT = 'Google Classroom Export - 2026-10-07';

/** The class as the home page lists it (what the background passes to the engine). */
function ref(cls) {
  const c = cls.course;
  // A student count is shown instead of a teacher on classes the user teaches.
  const teacher = /^\d/.test(c.teacher) ? null : c.teacher;
  return { courseId: c.id, prefix: '/u/1', name: c.name, section: c.section, teacher, url: `https://classroom.google.com/u/1/c/${c.id}` };
}

/** Files of a folder in an inspected archive, relative to it: {path: entry}. */
function filesUnder(zip, folder) {
  const out = {};
  for (const e of zip.entries) if (e.name.startsWith(`${folder}/`)) out[e.name.slice(folder.length + 1)] = e;
  return out;
}

test('account archive names and class folders: sanitized, de-duplicated in order, clear of the root files', () => {
  assert.equal(accountRootName(NOW), ROOT);
  assert.equal(accountArchiveName(NOW), 'All classes - 2026-10-07.zip');
  const layout = new AccountLayout(ROOT);
  const names = [
    { name: 'Biology', section: 'Period 1' },
    { name: 'Biology', section: 'Period 1' },
    { name: 'BIOLOGY', section: 'period 1' }, // file systems compare names case-insensitively
    { name: 'Math: Algebra/Geometry', section: null },
    { name: 'export-manifest.json' },
    { name: 'Index.html' },
    { name: null },
    { name: 'A very long class name that goes on and on and on', section: 'Section 12' },
    // A name ending in ".<letters or digits>" is not a file extension.
    { name: 'Algebra 1.2' },
    { name: 'Algebra 1.2' },
    { name: 'Chem', section: 'Per.3' },
    { name: 'Chem', section: 'Per.3' },
  ].map((info) => layout.allocate(info));
  assert.deepEqual(
    names.map((f) => f.name),
    [
      'Biology - Period 1',
      'Biology - Period 1 (2)',
      'BIOLOGY - period 1 (3)',
      'Math - Algebra-Geometry',
      'export-manifest.json (2)',
      'Index.html (2)',
      'Classroom export',
      'A very long class name that goes on and on and on',
      'Algebra 1.2',
      'Algebra 1.2 (2)',
      'Chem - Per.3',
      'Chem - Per.3 (2)',
    ],
  );
  assert.equal(names[1].path, `${ROOT}/Biology - Period 1 (2)`);
  assert.ok(names.every((f) => f.name.length <= 54));
  assert.deepEqual(ACCOUNT_ROOT_FILES, ['export-manifest.json', 'index.html', 'export-report.txt']);
});

test('class status and manifest totals', () => {
  const summary = (filesFailed) => ({ items: 3, byType: { assignment: 2, material: 1, question: 0, announcement: 0, other: 0 }, filesDownloaded: 4, filesFailed, linksSaved: 1, bytesDownloaded: 100, warnings: 0 });
  assert.equal(classStatus({ wrote: true, report: { summary: summary(0) } }), 'exported');
  assert.equal(classStatus({ wrote: true, report: { summary: summary(2) } }), 'partial');
  assert.equal(classStatus({ wrote: true, report: null, error: 'Disk full' }), 'partial');
  assert.equal(classStatus({ wrote: false, error: 'Disk full' }), 'failed');

  const classes = [
    manifestClass({ ref: { courseId: 'A', name: 'Art', teacher: 'Ms. A' }, classInfo: { courseId: 'A', name: 'Art', section: 'P1', url: 'u' }, folder: 'Art - P1', status: 'exported', report: { summary: summary(0) } }),
    manifestClass({ ref: { courseId: 'B', name: 'Band', section: 'P2' }, status: 'failed', error: 'Page did not load' }),
  ];
  assert.deepEqual(classes[0], {
    courseId: 'A',
    name: 'Art',
    section: 'P1',
    teacher: 'Ms. A',
    url: 'u',
    folder: 'Art - P1',
    status: 'exported',
    counts: { items: 3, assignment: 2, material: 1, question: 0, announcement: 0, other: 0, filesDownloaded: 4, filesFailed: 0, linksSaved: 1, bytesDownloaded: 100, warnings: 0 },
  });
  assert.deepEqual(classes[1], { courseId: 'B', name: 'Band', section: 'P2', teacher: null, url: null, folder: null, status: 'failed', counts: null, error: 'Page did not load' });
  const manifest = exportManifest({ kind: 'account', exportedAt: 'T', accountIndex: 2, options: { ...OPTIONS, googleFormat: 'pdf' }, classes, version: '9.9.9' });
  assert.deepEqual(manifest.totals, { classes: 2, exported: 1, partial: 0, failed: 1, items: 3, filesDownloaded: 4, filesFailed: 0, linksSaved: 1, bytesDownloaded: 100 });
  assert.deepEqual(manifest.options, { includeAnnouncements: true, readItemPages: true, googleFilesExportedAs: 'pdf' });
  assert.deepEqual(manifest.extension, { name: 'Google Classroom Bulk Exporter', version: '9.9.9' });
  assert.deepEqual([manifest.kind, manifest.formatVersion, manifest.accountIndex], ['account', 1, 2]);
});

test('a single-class archive has an export-manifest.json of kind "class"', async () => {
  const scenario = defaultScenario();
  const restore = installMockFetch(scenario);
  let result;
  try {
    result = await runExport({ snapshot: expectedSnapshot(scenario), options: OPTIONS, version: '1.0.0-test', now: NOW });
  } finally {
    restore();
  }
  const zip = inspectZip(await writeBlob(result.blob, join(tempDir(), result.archiveName)));
  const manifest = JSON.parse(zip.entries.find((e) => e.name === 'English 10 - Period 3/export-manifest.json').text);
  assert.equal(manifest.kind, 'class');
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.accountIndex, 1);
  assert.equal(manifest.exportedAt, NOW.toISOString());
  assert.equal(manifest.classes.length, 1);
  const [cls] = manifest.classes;
  assert.deepEqual(
    [cls.courseId, cls.name, cls.section, cls.folder, cls.status, cls.counts.items, cls.counts.filesDownloaded, cls.counts.filesFailed],
    [scenario.course.id, 'English 10', 'Period 3', '.', 'partial', 14, 13, 1],
  );
  assert.deepEqual(manifest.totals, { classes: 1, exported: 0, partial: 1, failed: 0, items: 14, filesDownloaded: 13, filesFailed: 1, linksSaved: 5, bytesDownloaded: cls.counts.bytesDownloaded });
});

test('an account archive holds every class in its own single-class folder, with manifest, index and combined report', async () => {
  const account = accountScenario();
  const [english, biology, biologyTaught, chemistry] = account.classes;
  const log = [];
  const restore = installMockFetch(account, log);
  let single;
  let result;
  const progress = [];
  try {
    single = await runExport({ snapshot: expectedSnapshot(english), options: OPTIONS, version: '1.0.0-test', now: NOW });
    const archive = new AccountExport({ accountIndex: 1, options: OPTIONS, version: '1.0.0-test', now: NOW });
    const outcomes = [];
    for (const [i, cls] of [english, biology, biologyTaught].entries()) {
      outcomes.push(await archive.addClass(i, { snapshot: expectedSnapshot(cls), ref: ref(cls) }, { onProgress: (p) => progress.push({ i, ...p }) }));
    }
    // A class the engine cannot write (here: a malformed snapshot) is recorded, not thrown.
    const broken = { ...expectedSnapshot(biology), classInfo: { courseId: 'BROKEN', authuser: 1, name: 'Broken' }, items: [{ type: 'assignment', title: 'x', resources: 'not a list' }] };
    outcomes.push(await archive.addClass(4, { snapshot: broken, ref: { courseId: 'BROKEN', name: 'Broken' } }));
    assert.deepEqual(
      outcomes.map((o) => [o.status, o.folder]),
      [
        ['partial', 'English 10 - Period 3'],
        ['exported', 'Biology - Period 1'],
        ['exported', 'Biology - Period 1 (2)'],
        ['failed', null],
      ],
    );
    assert.match(outcomes[3].error, /not a function/);
    assert.equal(outcomes[0].counts.filesFailed, 1);

    // Chemistry's scan failed in the tab, so it was never added.
    const classes = [english, biology, biologyTaught, chemistry].map((cls) => ref(cls));
    classes[3].error = 'The Classwork page did not load or could not be recognized (Google may have changed Classroom).';
    classes.push({ courseId: 'BROKEN', name: 'Broken', section: null, teacher: null, url: null });
    result = await archive.finish(classes, { warnings: ['Stopped loading the class list after many attempts; some classes may be missing.'] });
  } finally {
    restore();
  }

  assert.equal(result.archiveName, 'All classes - 2026-10-07.zip');
  const path = await writeBlob(result.blob, join(tempDir(), result.archiveName));
  assert.match(unzipTest(path), /No errors detected/);
  const zip = inspectZip(path);
  assert.equal(zip.bad, null);
  assert.ok(zip.entries.every((e) => e.name.startsWith(`${ROOT}/`)), 'one top-level folder');
  const top = new Set(zip.entries.map((e) => e.name.slice(ROOT.length + 1).split('/')[0]));
  assert.deepEqual([...top].sort(), ['Biology - Period 1', 'Biology - Period 1 (2)', 'English 10 - Period 3', 'export-manifest.json', 'export-report.txt', 'index.html']);
  const byName = Object.fromEntries(zip.entries.map((e) => [e.name, e]));

  // The English folder is exactly the single-class archive's folder (which
  // alone has export-manifest.json); only the report's archive name differs.
  const singleZip = inspectZip(await writeBlob(single.blob, join(tempDir(), single.archiveName)));
  const alone = filesUnder(singleZip, 'English 10 - Period 3');
  const inAccount = filesUnder(zip, `${ROOT}/English 10 - Period 3`);
  delete alone['export-manifest.json'];
  assert.deepEqual(Object.keys(inAccount).sort(), Object.keys(alone).sort());
  for (const [rel, entry] of Object.entries(alone)) {
    if (rel === 'export-report.json') continue;
    assert.equal(inAccount[rel].sha1, entry.sha1, rel);
  }
  for (const folder of ['Biology - Period 1', 'Biology - Period 1 (2)']) {
    const files = filesUnder(zip, `${ROOT}/${folder}`);
    for (const f of ['class-info.json', 'class-description.txt', 'export-report.txt', 'export-report.json', 'index.html']) assert.ok(files[f], `${folder}/${f}`);
    assert.ok(!files['export-manifest.json'], 'class folders have no manifest of their own');
  }
  assert.ok(byName[`${ROOT}/Biology - Period 1/Assignments/Cell diagram/Attachments/cell.pdf`]);
  assert.ok(byName[`${ROOT}/Biology - Period 1 (2)/Assignments/Microscope worksheet/Attachments/Microscope worksheet.docx`]);
  assert.equal(JSON.parse(byName[`${ROOT}/Biology - Period 1 (2)/class-info.json`].text).class.id, biologyTaught.course.id);

  // export-manifest.json
  const manifest = JSON.parse(byName[`${ROOT}/export-manifest.json`].text);
  assert.equal(manifest.kind, 'account');
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.accountIndex, 1);
  assert.equal(manifest.exportedAt, NOW.toISOString());
  assert.deepEqual(manifest.options, { includeAnnouncements: true, readItemPages: true, googleFilesExportedAs: 'office' });
  assert.deepEqual(manifest.extension, { name: 'Google Classroom Bulk Exporter', version: '1.0.0-test' });
  assert.deepEqual(
    manifest.classes.map((c) => [c.courseId, c.name, c.section, c.teacher, c.folder, c.status, c.counts && c.counts.items]),
    [
      [english.course.id, 'English 10', 'Period 3', 'Ms. Smith', 'English 10 - Period 3', 'partial', 14],
      [biology.course.id, 'Biology', 'Period 1', 'Mr. Jones', 'Biology - Period 1', 'exported', 3],
      [biologyTaught.course.id, 'Biology', 'Period 1', null, 'Biology - Period 1 (2)', 'exported', 1],
      [chemistry.course.id, 'Chemistry', 'Period 5', 'Dr. Brown', null, 'failed', null],
      ['BROKEN', 'Broken', null, null, null, 'failed', null],
    ],
  );
  assert.match(manifest.classes[3].error, /Classwork page did not load/);
  assert.match(manifest.classes[4].error, /not a function/);
  assert.ok(!('error' in manifest.classes[1]));
  assert.deepEqual(manifest.totals, {
    classes: 5,
    exported: 2,
    partial: 1,
    failed: 2,
    items: 18,
    filesDownloaded: 15,
    filesFailed: 1,
    linksSaved: 6,
    bytesDownloaded: manifest.classes.reduce((n, c) => n + (c.counts ? c.counts.bytesDownloaded : 0), 0),
  });

  // The report returned to the popup tags entries with their class.
  const report = result.report;
  assert.equal(report.kind, 'account');
  assert.deepEqual([report.summary.classes, report.summary.classesExported, report.summary.classesPartial, report.summary.classesFailed], [5, 2, 1, 2]);
  assert.equal(report.summary.byType.assignment, 6);
  assert.deepEqual(report.failures.map((f) => [f.className, f.file]), [['English 10', 'rubric.pdf']]);
  assert.ok(report.links.some((l) => l.className === 'Biology' && l.title === 'Lab safety rules'));
  assert.equal(report.warnings[0].message, 'Stopped loading the class list after many attempts; some classes may be missing.');

  // Combined export-report.txt: overall summary, class list, then each class's own report.
  const text = byName[`${ROOT}/export-report.txt`].text;
  assert.match(text, /^Export Report: All classes\n=+\n\nGoogle account: \/u\/1\/\nExported: 2026-10-07T/);
  assert.match(text, /\nClasses: 5 \(2 exported, 1 partially exported, 2 not exported\)\n/);
  assert.match(text, /\nFiles downloaded: 15 \(/);
  assert.match(text, /\n1\. English 10 \(Period 3\): partial -> English 10 - Period 3\/\n2\. Biology \(Period 1\): exported -> Biology - Period 1\/\n3\. Biology \(Period 1\): exported -> Biology - Period 1 \(2\)\/\n4\. Chemistry \(Period 5\): failed -> not exported\n {3}Reason: The Classwork page did not load/);
  assert.match(text, /\nClass 1 of 5: English 10 \(Period 3\)\n-+\nFolder: English 10 - Period 3\/\nStatus: partial\n\nClass: English 10 \(Period 3\)\n/);
  assert.match(text, /Failed:\n {2}1 file\n\n {2}- Assignment: Essay: Unit 1\n {4}File: rubric\.pdf/);
  assert.match(text, /\nClass 4 of 5: Chemistry \(Period 5\)\n-+\nStatus: failed\nError: The Classwork page did not load/);

  // index.html links to each class folder's own index.
  const index = byName[`${ROOT}/index.html`].text;
  assert.match(index, /<a href="English%2010%20-%20Period%203\/index\.html">English 10<\/a>/);
  assert.match(index, /<a href="Biology%20-%20Period%201%20\(2\)\/index\.html">Biology<\/a>/);
  assert.match(index, /<h3>Chemistry<\/h3><p class="meta">Period 5 · Dr\. Brown<\/p><p class="failed">Not exported: The Classwork page did not load/);
  assert.match(index, /href="export-manifest\.json"/);

  // Progress was reported per class; downloads used the account (/u/1).
  assert.ok(progress.some((p) => p.i === 2 && p.phase === 'downloading'));
  assert.ok(log.filter((l) => l.startsWith('drive.usercontent.google.com')).every((l) => l.includes('authuser=1')));
});

test('cancelling while a class downloads stops the account export', async () => {
  const account = accountScenario();
  const restore = installMockFetch(account);
  const controller = new AbortController();
  try {
    const archive = new AccountExport({ accountIndex: 1, options: OPTIONS, now: NOW });
    const run = archive.addClass(0, { snapshot: expectedSnapshot(account.classes[0]), ref: ref(account.classes[0]) }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(run, (e) => e.code === 'cancelled');
    assert.equal(archive.added.size, 0);
  } finally {
    restore();
  }
});
