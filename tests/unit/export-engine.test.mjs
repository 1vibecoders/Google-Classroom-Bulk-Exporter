import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runExport } from '../../src/engine/export-engine.js';
import { planLayout, reportText } from '../../src/engine/archive-content.js';
import { defaultScenario } from '../mock/classroom-mock.mjs';
import { expectedSnapshot, installMockFetch } from '../helpers/expected.mjs';
import { inspectZip, tempDir, unzipTest, writeBlob } from '../helpers/zip.mjs';

const OPTIONS = { includeAnnouncements: true, readDetailPages: true, googleFormat: 'office', saveAs: false };

test('layout is deterministic and collision-free', () => {
  const snapshot = expectedSnapshot(defaultScenario());
  const a = planLayout(snapshot).items.map((i) => i.folder);
  const b = planLayout(snapshot).items.map((i) => i.folder);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((f) => f.toLowerCase())).size, a.length);
  assert.ok(a.includes('English 10 - Period 3/Materials/Poetry Terms'));
  assert.ok(a.includes('English 10 - Period 3/Materials/Poetry Terms (2)'));
  assert.ok(a.includes('English 10 - Period 3/Assignments/_CON'));
  assert.ok(a.includes('English 10 - Period 3/Assignments/Essay - Unit 1'));
  assert.ok(a.includes('English 10 - Period 3/Assignments/Reading log - week 3'));
  assert.ok(a.includes('English 10 - Period 3/Questions/What is a sonnet_'));
  assert.ok(a.some((f) => f.startsWith('English 10 - Period 3/Announcements/Welcome to English 10!')));
});

test('exports a full class archive with attachments, links and a failure report', async () => {
  const scenario = defaultScenario();
  const log = [];
  const restore = installMockFetch(scenario, log);
  const progress = [];
  let result;
  try {
    result = await runExport({
      snapshot: expectedSnapshot(scenario),
      options: OPTIONS,
      version: '1.0.0-test',
      now: new Date(2026, 9, 7, 9, 0, 0),
      onProgress: (p) => progress.push(p),
    });
  } finally {
    restore();
  }
  const { blob, archiveName, report } = result;
  assert.equal(archiveName, 'English 10 - Period 3 - 2026-10-07.zip');

  const path = await writeBlob(blob, join(tempDir(), archiveName));
  assert.match(unzipTest(path), /No errors detected/);
  const zip = inspectZip(path);
  assert.equal(zip.bad, null);
  const names = new Set(zip.entries.map((e) => e.name));
  const R = 'English 10 - Period 3';
  const expectFiles = [
    `${R}/class-info.json`,
    `${R}/class-description.txt`,
    `${R}/export-report.txt`,
    `${R}/export-report.json`,
    `${R}/index.html`,
    `${R}/Assignments/Macbeth Act 1 Questions/description.txt`,
    `${R}/Assignments/Macbeth Act 1 Questions/metadata.json`,
    `${R}/Assignments/Macbeth Act 1 Questions/Attachments/Macbeth.pdf`,
    `${R}/Assignments/Macbeth Act 1 Questions/Attachments/Act 1 notes.docx`,
    `${R}/Assignments/Macbeth Act 1 Questions/Attachments/Act 1 slides.pptx`,
    `${R}/Assignments/Macbeth Act 1 Questions/Attachments/Extra notes.docx`,
    `${R}/Materials/Poetry Terms/Attachments/terms.pdf`,
    `${R}/Materials/Poetry Terms/Attachments/How to read a sonnet.url`,
    `${R}/Materials/Poetry Terms/Attachments/Poetry Foundation.url`,
    `${R}/Materials/Poetry Terms (2)/Attachments/notes.pdf`,
    `${R}/Materials/Poetry Terms (2)/Attachments/notes (2).pdf`,
    `${R}/Materials/Lecture recording/Attachments/lecture.mp4`,
    `${R}/Assignments/Reading log - week 3/Attachments/Reading log.xlsx`,
    `${R}/Assignments/Reading log - week 3/Attachments/week3.txt`,
    `${R}/Materials/Folder of extra reading/Attachments/Extra reading.url`,
    `${R}/Assignments/_CON/Attachments/Résumé - draft_.pdf`,
    `${R}/Assignments/Essay - Unit 1/Attachments/Self assessment.url`,
    `${R}/Materials/Late addition/Attachments/late.pdf`,
    `${R}/Announcements/Welcome to English 10!/Attachments/Syllabus.pdf`,
    `${R}/Questions/What is a sonnet_/description.txt`,
  ];
  for (const f of expectFiles) assert.ok(names.has(f), `missing ${f}\n${[...names].join('\n')}`);
  assert.ok(!names.has(`${R}/Assignments/Essay - Unit 1/Attachments/rubric.pdf`), 'inaccessible file is not faked');

  const byName = Object.fromEntries(zip.entries.map((e) => [e.name, e]));
  assert.equal(byName[`${R}/Materials/Lecture recording/Attachments/lecture.mp4`].size, 3 * 1024 * 1024 + 123, 'virus-scan page was followed to the real file');

  // Report and summary
  assert.equal(report.summary.filesFailed, 1);
  assert.equal(report.failures[0].itemTitle, 'Essay: Unit 1');
  assert.equal(report.failures[0].code, 'forbidden');
  assert.equal(report.summary.linksSaved, 5);
  assert.equal(report.summary.filesDownloaded, 13);
  const reportTxt = byName[`${R}/export-report.txt`].text;
  assert.match(reportTxt, /Failed:\n {2}1 file\n\n {2}- Assignment: Essay: Unit 1\n {4}File: rubric\.pdf\n {4}Reason: Access denied/);
  assert.equal(reportTxt, reportText(report));

  // Per-item metadata ties every file to its item.
  const meta = JSON.parse(byName[`${R}/Assignments/Macbeth Act 1 Questions/metadata.json`].text);
  assert.equal(meta.type, 'assignment');
  assert.equal(meta.topic, 'Unit 2: Macbeth');
  assert.equal(meta.dueText, 'Oct 10, 11:59 PM');
  assert.equal(meta.pointsText, '100 points');
  assert.equal(meta.attachments.length, 4);
  const pdf = meta.attachments.find((a) => a.title === 'Macbeth.pdf');
  assert.deepEqual(
    { status: pdf.status, file: pdf.file, driveFileId: pdf.driveFileId, originalFilename: pdf.originalFilename },
    { status: 'downloaded', file: 'Attachments/Macbeth.pdf', driveFileId: 'FILEPDF00000000000001', originalFilename: 'Macbeth.pdf' },
  );
  assert.match(pdf.originalUrl, /^https:\/\/drive\.google\.com\/file\/d\/FILEPDF00000000000001\//);
  const notes = meta.attachments.find((a) => a.title === 'Act 1 notes');
  assert.equal(notes.exportedAs, 'Word (.docx)');
  const essayMeta = JSON.parse(byName[`${R}/Assignments/Essay - Unit 1/metadata.json`].text);
  assert.equal(essayMeta.attachments.find((a) => a.title === 'rubric.pdf').status, 'failed');
  assert.equal(essayMeta.attachments.find((a) => a.title === 'Self assessment').status, 'link');

  const desc = byName[`${R}/Assignments/Macbeth Act 1 Questions/description.txt`].text;
  assert.match(desc, /^Macbeth Act 1 Questions\n=+\n\nType: Assignment\nTopic: Unit 2: Macbeth\nDue: Oct 10, 11:59 PM\nPoints: 100 points/);
  assert.match(desc, /Instructions\n-+\nRead Act 1 carefully\./);
  assert.match(desc, /- Macbeth\.pdf \(PDF\) -> Attachments\/Macbeth\.pdf/);

  const classInfo = JSON.parse(byName[`${R}/class-info.json`].text);
  assert.equal(classInfo.class.name, 'English 10');
  assert.equal(classInfo.counts.assignment, 4);
  assert.equal(classInfo.counts.material, 5);
  assert.equal(classInfo.counts.question, 1);
  assert.equal(classInfo.counts.announcement, 4);
  assert.deepEqual(classInfo.topics, ['Unit 1: Poetry', 'Unit 2: Macbeth']);
  assert.ok(!JSON.stringify(classInfo).includes('@'), 'no e-mail addresses');

  const shortcut = byName[`${R}/Materials/Poetry Terms/Attachments/Poetry Foundation.url`].text;
  assert.equal(shortcut, '[InternetShortcut]\r\nURL=https://example.com/poems\r\n');

  // Downloads used the class account (/u/1) and nothing was fetched for links or comments.
  assert.ok(log.filter((l) => l.startsWith('drive.usercontent.google.com')).every((l) => l.includes('authuser=1')));
  assert.ok(!log.some((l) => /youtube|example\.com|FOLDER|FORM/.test(l)));

  // Progress was reported through to the end.
  const last = progress[progress.length - 1];
  assert.equal(last.phase, 'zipping');
  assert.equal(last.filesDone, last.filesTotal);
  assert.ok(progress.some((p) => p.phase === 'downloading' && p.currentFile));
});

test('cancelling stops the export', async () => {
  const scenario = defaultScenario();
  const restore = installMockFetch(scenario);
  const controller = new AbortController();
  try {
    const run = runExport({ snapshot: expectedSnapshot(scenario), options: OPTIONS, signal: controller.signal });
    controller.abort();
    await assert.rejects(run, (e) => e.code === 'cancelled');
  } finally {
    restore();
  }
});

test('google files can be exported as PDF', async () => {
  const scenario = defaultScenario();
  const restore = installMockFetch(scenario);
  try {
    const { blob } = await runExport({ snapshot: expectedSnapshot(scenario), options: { ...OPTIONS, googleFormat: 'pdf' } });
    const zip = inspectZip(await writeBlob(blob, join(tempDir(), 'pdf.zip')));
    const names = zip.entries.map((e) => e.name);
    assert.ok(names.includes('English 10 - Period 3/Assignments/Macbeth Act 1 Questions/Attachments/Act 1 notes.pdf'));
    assert.ok(names.includes('English 10 - Period 3/Assignments/Reading log - week 3/Attachments/Reading log.pdf'));
  } finally {
    restore();
  }
});
