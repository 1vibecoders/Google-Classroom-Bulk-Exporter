// Extraction against several hand-written page structures, to make sure the
// extractor does not depend on one particular markup shape.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectContentScripts, launchBrowser, ROOT } from '../helpers/browser.mjs';

const FIXTURES = join(ROOT, 'tests/fixtures/classroom');
let browser;
let context;

before(async () => {
  browser = await launchBrowser();
  context = await browser.newContext();
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host !== 'classroom.google.com') return route.abort();
    const name = url.searchParams.get('fixture');
    const body = `<!doctype html><html><head><meta charset="utf-8"><base href="https://classroom.google.com/"></head><body>${readFileSync(join(FIXTURES, name), 'utf8')}</body></html>`;
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body });
  });
});

after(async () => {
  await browser.close();
});

async function open(fixture, path = '/u/0/c/NjI3') {
  const page = await context.newPage();
  await page.goto(`https://classroom.google.com${path}?fixture=${fixture}`);
  await injectContentScripts(page);
  return page;
}

function extract(page, mode) {
  return page.evaluate((mode) => {
    const { GCX } = globalThis;
    return GCX.extract.findItemRoots(document.body).map((r) =>
      GCX.extract.extractItem(r.el, { mode, courseId: 'NjI3', itemKey: r.key, baseUrl: document.baseURI }),
    );
  }, mode);
}

test('stream post with labelled attachment cards and a comment area', async () => {
  const page = await open('stream-post-attachment-cards.html');
  const [post] = await extract(page, 'stream');
  assert.match(post.description, /^Complete the form Feedback Form \(https:\/\/docs\.google\.com\/forms\/d\/e\/1FAIpQLSdExampleFormId\/viewform\?usp=dialog\), review the sheet Grade Sheet/);
  const byKey = Object.fromEntries(post.resources.map((r) => [r.key, r]));
  assert.equal(byKey['drive:1RevisionGuidePdfId000'].title, 'revision-guide.pdf');
  assert.equal(byKey['drive:1RevisionGuidePdfId000'].typeLabel, 'PDF');
  assert.equal(byKey['drive:1RevisionGuidePdfId000'].source, 'attachment');
  assert.equal(byKey['drive:1WeekFourDeckId000000'].kind, 'google-slides');
  assert.equal(byKey['drive:1WeekFourDeckId000000'].title, 'Week 4 deck');
  assert.equal(byKey['drive:1BigSheetIdForTesting00'].source, 'description-link');
  assert.equal(byKey['drive:1BigSheetIdForTesting00'].title, 'Grade Sheet');
  assert.ok(byKey['youtube:dQw4w9WgXcQ']);
  assert.ok(byKey['url:example.com/course-outline']);
  assert.ok(Object.keys(byKey).some((k) => k.startsWith('published:')), 'published form link kept');
  assert.equal(post.resources.length, 6);
  assert.ok(!byKey['drive:1StudentSharedFile000'], 'comment links are ignored');
  assert.equal(post.meta.postedText, 'Mar 10');
  await page.close();
});

test('item page without aria-labels or data attributes', async () => {
  const page = await open('detail-no-aria-labels.html', '/u/0/c/NjI3/a/NzEwMDAwMDAwMDAx/details');
  const [item] = await extract(page, 'detail');
  assert.equal(item.title, 'Lab report: Photosynthesis');
  assert.equal(item.description, 'Use the template below.\nSubmit as PDF.\n\nGrading: see rubric.');
  assert.deepEqual(item.resources.map((r) => [r.key, r.title, r.source]), [
    ['drive:1LabTemplateDocId0000', 'Lab template', 'attachment'],
    ['drive:1RubricPdfFileId00000', 'rubric.pdf', 'attachment'],
  ]);
  assert.equal(item.meta.pointsText, '20 points');
  assert.equal(item.meta.dueText, 'Sep 21, 8:00 AM');
  assert.equal(item.meta.postedText, 'Sep 14');
  assert.equal(item.meta.editedText, 'Sep 15');
  await page.close();
});

test('rich-text description with wrapped and keyed links', async () => {
  const page = await open('detail-rich-text.html', '/u/0/c/NjI3/m/NzIwMDAwMDAwMDA5/details');
  const [item, other] = await extract(page, 'detail');
  assert.equal(other.title, 'Reading guide');
  assert.equal(other.description, 'Due Friday at noon, please.\nBring the book.');
  assert.equal(other.meta.dueText, null, 'text inside the instructions is not metadata');
  assert.equal(other.meta.postedText, 'Oct 2');
  assert.equal(item.title, 'Week 5 materials');
  assert.equal(item.kind, null);
  assert.match(item.description, /^Read the following before Friday:\n- Chapter 5 summary\n- Primary sources \(link/);
  const byKey = Object.fromEntries(item.resources.map((r) => [r.key, r]));
  assert.equal(byKey['drive:1Chapter5Slides0000000'].source, 'attachment');
  assert.equal(byKey['drive:1PrimarySourcesId0000'].hint, 'ambiguous');
  assert.equal(byKey['drive:1KeyedFileId000000000'].resourceKey, '0-AbCdEf');
  assert.equal(item.meta.postedText, 'Oct 1');
  await page.close();
});

test('expanded Classwork row in a non-English interface', async () => {
  const page = await open('classwork-spanish-ui.html', '/u/0/w/NjI3/t/all');
  const [row] = await extract(page, 'row');
  assert.equal(row.title, 'Tarea: Ensayo');
  assert.equal(row.kind, 'a');
  assert.equal(row.detailUrl, 'https://classroom.google.com/u/0/c/NjI3/a/NzMwMDAwMDAwMDAx/details');
  assert.match(row.description, /Escribe un ensayo de 500 palabras\.\nUsa la plantilla\./);
  assert.equal(row.resources.length, 1);
  assert.equal(row.resources[0].title, 'Plantilla');
  assert.equal(row.resources[0].typeLabel, 'Documentos de Google');
  assert.equal(row.resources[0].kind, 'google-doc');
  await page.close();
});

test('topics from plain headings, page title ignored, duplicate rows collapsed', async () => {
  const page = await open('classwork-heading-topics.html', '/u/0/w/NjI3/t/all');
  const result = await page.evaluate(() => {
    const { GCX } = globalThis;
    const roots = GCX.extract.findItemRoots(document.body);
    const map = GCX.classwork.mapTopics(document, roots, { courseId: 'NjI3' });
    return {
      keys: roots.map((r) => r.key),
      duplicates: roots.map((r) => r.elements.length),
      topics: map.topics.map((t) => t.name),
      byItem: Object.fromEntries(roots.map((r) => [r.key, map.byItem.get(r.key) || null])),
      titles: roots.map((r) => GCX.extract.extractRowSummary(r.el, { courseId: 'NjI3', itemKey: r.key, baseUrl: document.baseURI }).title),
    };
  });
  assert.deepEqual(result.keys, ['740000000001', '740000000002', '740000000003', '740000000004']);
  assert.deepEqual(result.duplicates, [1, 1, 1, 2]);
  assert.deepEqual(result.topics, ['Week 1', 'Week 2']);
  assert.deepEqual(result.byItem, { 740000000001: null, 740000000002: 'Week 1', 740000000003: 'Week 1', 740000000004: 'Week 2' });
  assert.deepEqual(result.titles, ['No-topic item', 'Intro slides', 'Survey', 'Quiz 1']);
  await page.close();
});
