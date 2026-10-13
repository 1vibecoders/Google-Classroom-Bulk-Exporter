// Sending scans to the Academic Scheduler website: which addresses are
// accepted, what is sent, and the injected delivery that repeats until the
// page confirms this exact message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOCUMENT_BYTES, PROTOCOL, collectDocuments, deliver, sendableSnapshot, siteOrigin } from '../../src/background/scheduler-bridge.js';

test('accepts https addresses and this computer only', () => {
  assert.equal(siteOrigin(' https://my-site.vercel.app/#/import '), 'https://my-site.vercel.app');
  assert.equal(siteOrigin('http://localhost:5173/'), 'http://localhost:5173');
  assert.equal(siteOrigin('http://example.com'), null);
  assert.equal(siteOrigin('https://user:pw@example.com'), null);
  assert.equal(siteOrigin('javascript:alert(1)'), null);
  assert.equal(siteOrigin('my-site.vercel.app'), null);
});

test('sends only what the website uses', () => {
  const sent = sendableSnapshot({
    createdAt: '2026-10-12T14:00:00.000Z',
    optionsKey: 'x',
    classInfo: { courseId: 'NjI3', authuser: 1, prefix: '/u/1', name: 'English 10', section: 'P3', url: 'https://classroom.google.com/c/NjI3', bannerLines: ['Room 4'] },
    topics: [{ id: 't1', name: 'Unit 3' }],
    items: [
      {
        key: 'k',
        id: 'NzAw',
        type: 'assignment',
        title: 'Essay',
        topic: 'Unit 3',
        description: 'Write it.',
        classroomUrl: 'https://classroom.google.com/c/NjI3/a/NzAw/details',
        meta: { dueText: 'Oct 16, 11:59 PM', pointsText: '100 points', postedText: 'Oct 1', editedText: null, statusText: null },
        resources: [{ kind: 'drive-file', id: 'abc', resourceKey: 'rk', url: 'https://drive.google.com/file/d/abc/view', title: 'Rubric', authuser: 1, source: 'detail' }],
        sources: ['classwork'],
        warnings: [],
      },
    ],
    warnings: ['w'],
  });
  assert.deepEqual(sent, {
    createdAt: '2026-10-12T14:00:00.000Z',
    classInfo: { courseId: 'NjI3', name: 'English 10', section: 'P3', url: 'https://classroom.google.com/c/NjI3' },
    topics: [{ id: 't1', name: 'Unit 3' }],
    items: [
      {
        id: 'NzAw',
        type: 'assignment',
        title: 'Essay',
        topic: 'Unit 3',
        description: 'Write it.',
        classroomUrl: 'https://classroom.google.com/c/NjI3/a/NzAw/details',
        meta: { dueText: 'Oct 16, 11:59 PM', pointsText: '100 points', postedText: 'Oct 1' },
        resources: [
          { kind: 'drive-file', title: 'Rubric', url: 'https://drive.google.com/file/d/abc/view', id: 'abc', source: 'detail', resourceKey: 'rk', authuser: 1, hint: null, published: false },
        ],
      },
    ],
    warnings: ['w'],
  });
});

test('downloads attached documents once, as files the website can read, and reports the rest', async () => {
  const res = (kind, id, title, source = 'attachment') => ({ kind, id, title, source, url: `https://drive.google.com/file/d/${id}/view`, authuser: 0 });
  const snapshots = [
    {
      classInfo: { courseId: 'NjI3' },
      items: [
        { id: 'NzAw', type: 'assignment', resources: [res('google-doc', 'doc1', 'Essay guide'), res('drive-file', 'pdf1', 'Rubric.pdf'), res('drive-file', 'img1', 'Map.png')] },
        { id: 'NzAx', type: 'material', resources: [res('google-doc', 'doc1', 'Essay guide'), res('drive-file', 'big1', 'Scan.pdf'), res('drive-file', 'gone1', 'Old'), res('google-doc', 'link1', 'Linked', 'description')] },
      ],
    },
  ];
  const files = {
    doc1: { type: 'application/zip', size: 4 },
    pdf1: { type: 'application/pdf', size: 3 },
    img1: { type: 'image/png', size: 3 },
    big1: { type: 'application/pdf', size: MAX_DOCUMENT_BYTES + 1 },
  };
  const tried = [];
  const download = async (url) => {
    const id = /\/d\/([^/]+)\/|[?&]id=([^&]+)/.exec(url).slice(1).find(Boolean);
    tried.push(id);
    const f = files[id];
    if (!f) throw new Error('not found');
    return { blob: new Blob([new Uint8Array(Math.min(f.size, 4)).fill(65)]), size: f.size, contentType: f.type };
  };
  const docs = await collectDocuments(snapshots, { download });
  const byId = Object.fromEntries(docs.map((d) => [d.fileId, d]));
  assert.deepEqual(Object.keys(byId).sort(), ['big1', 'doc1', 'gone1', 'img1', 'pdf1']);
  assert.equal(byId.doc1.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(byId.doc1.data, 'QUFBQQ==');
  assert.equal(byId.doc1.itemId, 'NzAw');
  assert.equal(byId.pdf1.status, 'file');
  assert.equal(byId.img1.status, 'unsupported');
  assert.equal(byId.big1.status, 'too_large');
  assert.equal(byId.gone1.status, 'inaccessible');
  assert.ok(!tried.includes('link1'));
});

function fakePage(origin, answer) {
  const page = new EventTarget();
  const posted = [];
  page.postMessage = (data, target) => {
    posted.push({ data, target });
    const reply = answer(data, posted.length);
    if (!reply) return;
    setTimeout(() => {
      const event = new Event('message');
      Object.assign(event, { data: reply, origin, source: page });
      page.dispatchEvent(event);
    }, 0);
  };
  globalThis.window = page;
  globalThis.location = { origin };
  return posted;
}

test('delivery repeats until the page confirms this message, ignoring other replies', async () => {
  const message = { protocol: PROTOCOL, version: 1, type: 'import', id: 'm1', snapshots: [] };
  const posted = fakePage('https://site.example', (data, n) =>
    n === 1 ? { protocol: PROTOCOL, type: 'received', id: 'other', ok: true } : { protocol: PROTOCOL, type: 'received', id: data.id, ok: true },
  );
  assert.deepEqual(await deliver(message, 'https://site.example'), { ok: true });
  assert.equal(posted.length, 2);
  assert.ok(posted.every((p) => p.target === 'https://site.example'));
});

test('delivery refuses a tab on another website and reports the page’s refusal', async () => {
  fakePage('https://other.example', () => null);
  assert.equal((await deliver({ protocol: PROTOCOL, id: 'm2' }, 'https://site.example')).ok, false);
  fakePage('https://site.example', (data) => ({ protocol: PROTOCOL, type: 'received', id: data.id, ok: false, message: 'Not a scan.' }));
  assert.deepEqual(await deliver({ protocol: PROTOCOL, id: 'm3' }, 'https://site.example'), { ok: false, message: 'Not a scan.' });
});
