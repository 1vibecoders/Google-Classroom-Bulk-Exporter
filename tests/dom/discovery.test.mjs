import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, urls } from '../mock/classroom-mock.mjs';
import { injectContentScripts, launchBrowser, mockContext, runStep } from '../helpers/browser.mjs';

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser.close();
});

const OPTIONS = { includeAnnouncements: true, readDetailPages: true, googleFormat: 'office' };

async function discover(scenario, { options = OPTIONS } = {}) {
  const log = [];
  const context = await mockContext(browser, scenario, log);
  const page = await context.newPage();
  const u = urls(scenario);
  try {
    await page.goto(u.classwork);
    await injectContentScripts(page);
    const classwork = await runStep(page, 'classwork', { options });
    let stream = null;
    if (options.includeAnnouncements) {
      await page.goto(u.stream);
      await injectContentScripts(page);
      stream = await runStep(page, 'stream', { options });
    }
    const details = await runStep(page, 'details', {
      options,
      classwork: classwork.result,
      stream: stream && stream.result,
      classContext: { courseId: scenario.course.id, authuser: scenario.authuser, prefix: `/u/${scenario.authuser}` },
    });
    return { classwork, stream, snapshot: details.result.snapshot, log, reports: [...classwork.reports, ...details.reports] };
  } finally {
    await context.close();
  }
}

function byTitle(snapshot, title, type) {
  const found = snapshot.items.filter((i) => i.title === title && (!type || i.type === type));
  assert.ok(found.length, `item "${title}" not found in ${snapshot.items.map((i) => i.title).join(', ')}`);
  return found;
}

function keys(item) {
  return item.resources.map((r) => r.key).sort();
}

test('discovers a class end to end (server-rendered item pages)', async () => {
  const scenario = defaultScenario();
  const { classwork, snapshot, log, reports } = await discover(scenario);

  // Class
  assert.equal(snapshot.classInfo.name, 'English 10');
  assert.equal(snapshot.classInfo.section, 'Period 3');
  assert.equal(snapshot.classInfo.authuser, 1);
  assert.deepEqual(snapshot.classInfo.bannerLines, ['Subject: English', 'Room 204']);
  assert.deepEqual(snapshot.topics.map((t) => t.name), ['Unit 1: Poetry', 'Unit 2: Macbeth']);
  assert.equal(snapshot.stats.detailStrategy, 'fetch');

  // Every classwork item was loaded despite lazy batches.
  assert.equal(classwork.result.items.length, scenario.items.length);
  const types = snapshot.items.reduce((acc, i) => ({ ...acc, [i.type]: (acc[i.type] || 0) + 1 }), {});
  assert.deepEqual(types, { assignment: 4, material: 5, question: 1, announcement: 4 });

  // Item found only through the Stream is not silently dropped.
  const late = byTitle(snapshot, 'Late addition')[0];
  assert.equal(late.type, 'material');
  assert.deepEqual(keys(late), ['drive:LATEFILE0000000000001']);

  // Assignment with more attachments than the Classwork row shows, a link in
  // the description, a comment link and the student's own work.
  const macbeth = byTitle(snapshot, 'Macbeth Act 1 Questions')[0];
  assert.equal(macbeth.type, 'assignment');
  assert.equal(macbeth.topic, 'Unit 2: Macbeth');
  assert.equal(macbeth.meta.dueText, 'Oct 10, 11:59 PM');
  assert.equal(macbeth.meta.pointsText, '100 points');
  assert.equal(macbeth.meta.postedText, 'Oct 3');
  assert.equal(macbeth.description, 'Read Act 1 carefully.\nAnswer every question in the worksheet.\nExtra notes: https://docs.google.com/document/d/DOCLINK00000000000001/edit?usp=sharing');
  assert.deepEqual(keys(macbeth), ['drive:DOCLINK00000000000001', 'drive:DOCNOTES0000000000001', 'drive:FILEPDF00000000000001', 'drive:SLIDES000000000000001']);
  const pdf = macbeth.resources.find((r) => r.id === 'FILEPDF00000000000001');
  assert.deepEqual([pdf.kind, pdf.title, pdf.typeLabel, pdf.source], ['drive-file', 'Macbeth.pdf', 'PDF', 'attachment']);
  assert.equal(macbeth.resources.find((r) => r.id === 'DOCLINK00000000000001').source, 'description-link');
  assert.equal(macbeth.classroomUrl, `https://classroom.google.com/u/1/c/${scenario.course.id}/a/${scenario.items[0].id}/details`);
  assert.ok(macbeth.sources.includes('classwork-list') && macbeth.sources.includes('item-page'));

  // "Your work" inside the item root and comment links are excluded.
  const essay = byTitle(snapshot, 'Essay: Unit 1')[0];
  assert.deepEqual(keys(essay), ['drive:FORBIDDEN000000000001', 'drive:FORM00000000000000001']);
  assert.equal(essay.description, 'Write a 2 page essay.');
  assert.equal(essay.meta.dueText, 'No due date');
  for (const item of snapshot.items) {
    for (const r of item.resources) {
      assert.ok(!/STUDENTFILE|COMMENTFILE|student-link/.test(r.url), `${item.title} picked up ${r.url}`);
    }
  }

  // Duplicate titles stay separate items; duplicate file names stay separate resources.
  const terms = byTitle(snapshot, 'Poetry Terms', 'material');
  assert.equal(terms.length, 2);
  const withNotes = terms.find((t) => t.resources.length === 2 && t.resources.every((r) => r.title === 'notes.pdf'));
  assert.ok(withNotes, 'both notes.pdf attachments kept');
  const terms1 = terms.find((t) => t.topic === 'Unit 1: Poetry');
  assert.deepEqual(terms1.resources.map((r) => r.kind).sort(), ['drive-file', 'link', 'youtube']);

  const question = byTitle(snapshot, 'What is a sonnet?')[0];
  assert.equal(question.type, 'question');
  assert.equal(question.topic, null);
  assert.equal(question.description, 'Answer in one sentence.');

  // Announcements: text, attachments, no coursework notices, no comment links.
  const welcome = snapshot.items.find((i) => i.type === 'announcement' && i.description.startsWith('Welcome'));
  assert.equal(welcome.description, 'Welcome to English 10!\nThe syllabus is attached.');
  assert.equal(welcome.title, 'Welcome to English 10!');
  assert.deepEqual(keys(welcome), ['drive:SYLLABUS0000000000001']);
  assert.equal(snapshot.items.filter((i) => i.type === 'announcement').length, 4);

  // Item pages were requested in English for metadata parsing.
  assert.ok(log.some((l) => l.includes('/details?hl=en')));
  assert.ok(reports.some((r) => /Reading classwork \d+\/\d+/.test(r.message || '')));
});

test('falls back to a hidden frame when item pages are rendered by scripts', async () => {
  const scenario = defaultScenario({ detailMode: 'csr' });
  const { snapshot } = await discover(scenario, { options: { ...OPTIONS, includeAnnouncements: false } });
  assert.equal(snapshot.stats.detailStrategy, 'frame');
  const macbeth = byTitle(snapshot, 'Macbeth Act 1 Questions')[0];
  assert.equal(macbeth.resources.length, 4, 'third attachment only visible on the item page was found');
  assert.ok(macbeth.sources.includes('item-page-frame'));
  assert.equal(snapshot.items.filter((i) => i.type === 'announcement').length, 0);
});

test('works from the Classwork list alone when item pages are disabled', async () => {
  const scenario = defaultScenario({ collapsedRows: false });
  const { snapshot } = await discover(scenario, { options: { ...OPTIONS, includeAnnouncements: false, readDetailPages: false } });
  assert.equal(snapshot.stats.detailStrategy, 'skipped');
  assert.equal(snapshot.items.length, scenario.items.length);
  const macbeth = byTitle(snapshot, 'Macbeth Act 1 Questions')[0];
  // Only what the list shows: two attachments plus the description link.
  assert.equal(macbeth.resources.length, 3);
  assert.equal(macbeth.meta.dueText, 'Oct 10, 11:59 PM');
  for (const item of snapshot.items) assert.ok(item.type !== 'other', `${item.title} has a known type`);
});

test('reports an empty class without failing', async () => {
  const scenario = defaultScenario({ items: [], streamOnlyItems: [], announcements: [] });
  const { snapshot } = await discover(scenario);
  assert.equal(snapshot.items.length, 0);
  assert.equal(snapshot.classInfo.name, 'English 10');
  assert.ok(snapshot.warnings.some((w) => /No classwork was found/.test(w)));
});

test('recovers when clicking a row opens the item page instead of expanding it', async () => {
  const scenario = defaultScenario({ rowNavigates: true });
  const { snapshot } = await discover(scenario, { options: { ...OPTIONS, includeAnnouncements: false } });
  assert.ok(snapshot.warnings.some((w) => /open the item page instead of expanding/.test(w)));
  assert.equal(snapshot.items.length, scenario.items.length);
  const macbeth = byTitle(snapshot, 'Macbeth Act 1 Questions')[0];
  assert.equal(macbeth.resources.length, 4, 'details came from the item page');
  assert.equal(macbeth.type, 'assignment');
});

test('stops with a clear error when the user navigates away mid-scan', async () => {
  const scenario = defaultScenario({ bootDelayMs: 1500 });
  const context = await mockContext(browser, scenario);
  const page = await context.newPage();
  try {
    await page.goto(urls(scenario).classwork);
    await injectContentScripts(page);
    const error = await page.evaluate(async () => {
      const run = globalThis.GCX.discovery.runStep('classwork', {}, { signal: new AbortController().signal, report: () => {} });
      history.pushState({}, '', location.href.replace('/w/', '/r/').replace('/t/all', '/sort-last-name'));
      try {
        await run;
        return null;
      } catch (err) {
        return { code: err.code, message: err.message };
      }
    });
    assert.equal(error && error.code, 'navigated-away');
  } finally {
    await context.close();
  }
});
