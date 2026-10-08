import test from 'node:test';
import assert from 'node:assert/strict';
import { GCX } from '../helpers/content.mjs';

const { url, resources } = GCX;

test('parses Classroom page URLs', () => {
  assert.deepEqual(
    pick(url.parse('https://classroom.google.com/u/1/w/NjI3ODk0MjE0NTQ5/t/all')),
    { courseId: 'NjI3ODk0MjE0NTQ5', page: 'classwork', authuser: 1, prefix: '/u/1' },
  );
  assert.equal(url.parse('https://classroom.google.com/c/NjI3ODk0MjE0NTQ5').page, 'stream');
  assert.equal(url.parse('https://classroom.google.com/u/0/c/NjI3ODk0MjE0NTQ5/').page, 'stream');
  const item = url.parse('https://classroom.google.com/u/2/c/NjI3/a/NzAw/details');
  assert.equal(item.page, 'item');
  assert.equal(item.itemKind, 'a');
  assert.equal(item.itemType, 'assignment');
  assert.equal(item.itemId, 'NzAw');
  assert.equal(item.authuser, 2);
  assert.equal(url.parse('https://classroom.google.com/u/0/c/NjI3/m/NzAw/details').itemType, 'material');
  assert.equal(url.parse('https://classroom.google.com/u/0/c/NjI3/sa/NzAw/details').itemType, 'question');
  assert.equal(url.parse('https://classroom.google.com/u/0/c/NjI3/p/ODAw').page, 'announcement');
  assert.equal(url.parse('https://classroom.google.com/u/0/w/NjI3/tc/OTAw').topicId, 'OTAw');
  assert.equal(url.parse('https://classroom.google.com/u/0/r/NjI3/sort-last-name').page, 'people');
});

test('handles Workspace domain prefixes and to-do pages', () => {
  const p = url.parse('https://classroom.google.com/u/0/a/school.example.edu/c/NjI3');
  assert.equal(p.courseId, 'NjI3');
  assert.equal(p.prefix, '/u/0/a/school.example.edu');
  assert.equal(url.classworkUrl(p), 'https://classroom.google.com/u/0/a/school.example.edu/w/NjI3/t/all');
  const todo = url.parse('https://classroom.google.com/u/0/a/not-turned-in/all');
  assert.equal(todo.courseId, null);
  assert.equal(url.parse('https://classroom.google.com/').page, 'home');
  assert.equal(url.parse('https://classroom.google.com/u/1/h').page, 'home');
  // The redesigned home page opens a role view (Enrolled, Teaching, …).
  const view = url.parse('https://classroom.google.com/u/1/h/st');
  assert.equal(view.page, 'home');
  assert.equal(view.authuser, 1);
  assert.equal(url.parse('https://classroom.google.com/u/0/h/te/').page, 'home');
  assert.equal(url.parse('https://classroom.google.com/u/0/a/school.example.edu/h').page, 'home');
  assert.equal(url.parse('https://classroom.google.com/u/0/a/not-turned-in/all').page, 'other');
  assert.equal(url.parse('https://classroom.google.com/u/0/a/not-turned-in').page, 'other');
  assert.equal(url.parse('https://classroom.google.com/u/0/calendar/this-week/course/all').page, 'other');
  assert.equal(url.parse('https://example.com/c/NjI3').isClassroom, false);
  assert.equal(url.parse('not a url').isClassroom, false);
});

test('normalizes decimal and base64 item ids', () => {
  assert.equal(url.toUrlId('627894214549'), 'NjI3ODk0MjE0NTQ5');
  assert.equal(url.idKey('NjI3ODk0MjE0NTQ5'), '627894214549');
  assert.equal(url.idKey('627894214549'), '627894214549');
  assert.ok(url.sameId('627894214549', 'NjI3ODk0MjE0NTQ5'));
  assert.ok(!url.sameId('627894214549', 'NjI3ODk0MjE0NTQ4'));
  assert.equal(url.idKey('not-base64-digits!'), 'not-base64-digits!');
  assert.equal(url.itemUrl({ prefix: '/u/0', courseId: 'Q1' }, 'm', '700000000002'), 'https://classroom.google.com/u/0/c/Q1/m/NzAwMDAwMDAwMDAy/details');
  assert.equal(url.itemUrl({ authuser: 3, courseId: 'Q1' }, 'p', 'ODAw'), 'https://classroom.google.com/u/3/c/Q1/p/ODAw');
});

test('classifies Drive, Docs and other links', () => {
  const drive = resources.classify('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=classroom_web&authuser=1&resourcekey=0-xyz');
  assert.equal(drive.kind, 'drive-file');
  assert.equal(drive.id, '1AbCdEfGhIjKlMnOp');
  assert.equal(drive.resourceKey, '0-xyz');
  assert.equal(drive.authuser, 1);
  assert.equal(drive.key, 'drive:1AbCdEfGhIjKlMnOp');

  assert.equal(resources.classify('https://drive.google.com/u/2/file/d/1AbCdEfGhIjKlMnOp/view').authuser, 2);
  assert.equal(resources.classify('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp').hint, 'ambiguous');
  assert.equal(resources.classify('https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOp&export=download').kind, 'drive-file');
  assert.equal(resources.classify('https://drive.google.com/drive/folders/1FolderIdAbcdef').kind, 'drive-folder');
  assert.equal(resources.classify('https://drive.google.com/drive/u/0/folders/1FolderIdAbcdef').kind, 'drive-folder');
  assert.equal(resources.classify('https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp'), null);

  const doc = resources.classify('https://docs.google.com/document/d/1DocIdAbcdefghij/edit?usp=sharing');
  assert.equal(doc.kind, 'google-doc');
  assert.equal(doc.key, 'drive:1DocIdAbcdefghij');
  assert.equal(resources.classify('https://docs.google.com/spreadsheets/u/1/d/1SheetIdAbcdefgh/edit#gid=0').kind, 'google-sheet');
  assert.equal(resources.classify('https://docs.google.com/presentation/d/1SlidesIdAbcdefg/edit').kind, 'google-slides');
  assert.equal(resources.classify('https://docs.google.com/drawings/d/1DrawIdAbcdefghi/edit').kind, 'google-drawing');
  assert.equal(resources.classify('https://docs.google.com/forms/d/e/1FAIpQLSdExample/viewform').kind, 'google-form');
  const published = resources.classify('https://docs.google.com/document/d/e/2PACX-1vPublishedId/pub');
  assert.equal(published.published, true);
  assert.equal(resources.classify('https://colab.research.google.com/drive/1ColabIdAbcdefgh').hint, 'ipynb');

  assert.equal(resources.classify('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(resources.classify('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5').key, 'youtube:dQw4w9WgXcQ');
  assert.equal(resources.classify('https://classroom.google.com/u/0/c/NjI3').kind, 'classroom');
  assert.equal(resources.classify('https://example.com/a/b/?utm_source=x#frag').key, 'url:example.com/a/b');
  assert.equal(resources.classify('mailto:teacher@example.com'), null);
  assert.equal(resources.classify('javascript:void(0)'), null);
  assert.equal(resources.classify('#'), null);
});

test('unwraps Google redirect links', () => {
  const r = resources.classify('https://www.google.com/url?q=https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view&sa=D');
  assert.equal(r.kind, 'drive-file');
  assert.equal(r.id, '1AbCdEfGhIjKlMnOp');
});

test('prefers the most specific descriptor for the same file', () => {
  const a = resources.classify('https://drive.google.com/open?id=1DocIdAbcdefghij');
  const b = resources.classify('https://docs.google.com/document/d/1DocIdAbcdefghij/edit');
  assert.equal(a.key, b.key);
  assert.equal(resources.preferDescriptor(a, b).kind, 'google-doc');
  assert.equal(resources.preferDescriptor(b, a).kind, 'google-doc');
});

test('parses metadata lines and attachment labels', () => {
  const meta = GCX.extract.parseMeta(['Due Oct 10, 11:59 PM', '100 points', 'Ms. Smith • Oct 3 (Edited Oct 4)']);
  assert.equal(meta.dueText, 'Oct 10, 11:59 PM');
  assert.equal(meta.pointsText, '100 points');
  assert.equal(meta.postedText, 'Oct 3');
  assert.equal(meta.editedText, 'Oct 4');
  assert.equal(GCX.extract.parseMeta(['No due date']).dueText, 'No due date');
  assert.equal(GCX.extract.parseMeta(['Posted Sep 5']).postedText, 'Sep 5');
  assert.deepEqual(GCX.extract.parseAttachmentLabel('Attachment: PDF: CNN q.pdf'), { name: 'CNN q.pdf', typeLabel: 'PDF' });
  assert.deepEqual(GCX.extract.parseAttachmentLabel('Attachment: Google Docs: Unit 1: Intro'), { name: 'Unit 1: Intro', typeLabel: 'Google Docs' });
  assert.equal(GCX.extract.cleanDescription('Posted Oct 3\nRead chapter 4.\nDue Friday is fine\nView instructions'), 'Read chapter 4.\nDue Friday is fine');
});

function pick(p) {
  return { courseId: p.courseId, page: p.page, authuser: p.authuser, prefix: p.prefix };
}
