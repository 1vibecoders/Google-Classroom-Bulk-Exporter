import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ZipWriter, normalizeZipPath } from '../../src/engine/zip-writer.js';
import { crc32, crc32OfBlob } from '../../src/engine/crc32.js';
import {
  sanitizeComponent,
  splitExtension,
  parseContentDisposition,
  chooseFileName,
  NameAllocator,
  extensionForContentType,
} from '../../src/engine/filenames.js';
import { inspectZip, tempDir, unzipTest, writeBlob } from '../helpers/zip.mjs';

test('crc32 matches known values', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  const blob = new Blob(['1234', '56789']);
  assert.equal(await crc32OfBlob(blob), 0xcbf43926);
});

async function buildSample(options) {
  const zip = new ZipWriter({ date: new Date(2026, 9, 7, 14, 30, 12), ...options });
  const big = new Uint8Array(300000).map((_, i) => (i * 7) & 0xff);
  await zip.add('Root/notes.txt', 'Hello\nWorld\n'.repeat(50), { compress: true });
  await zip.add('Root/Assignments/Résumé – ünïcödé/描述.txt', 'unicode name');
  await zip.add('Root/Assignments/x/Attachments/data.bin', new Blob([big]));
  await zip.add('Root/empty.txt', '');
  return { blob: zip.finish(), big };
}

for (const forceZip64 of [false, true]) {
  test(`zip archive is valid for python zipfile and unzip (zip64=${forceZip64})`, async () => {
    const dir = tempDir();
    const { blob, big } = await buildSample({ forceZip64 });
    const path = await writeBlob(blob, join(dir, 'sample.zip'));
    const result = inspectZip(path);
    assert.equal(result.bad, null);
    const names = result.entries.map((e) => e.name);
    assert.deepEqual(names, [
      'Root/notes.txt',
      'Root/Assignments/Résumé – ünïcödé/描述.txt',
      'Root/Assignments/x/Attachments/data.bin',
      'Root/empty.txt',
    ]);
    assert.ok(result.entries.every((e) => e.utf8));
    assert.equal(result.entries[0].compress, 8, 'text is deflated');
    assert.equal(result.entries[2].compress, 0, 'binary blob is stored');
    assert.equal(result.entries[2].sha1, createHash('sha1').update(big).digest('hex'));
    assert.equal(result.entries[0].text, 'Hello\nWorld\n'.repeat(50));
    assert.equal(result.entries[3].size, 0);
    assert.match(unzipTest(path), /No errors detected/);
  });
}

test('zip writer rejects duplicate and unsafe paths', async () => {
  const zip = new ZipWriter();
  await zip.add('a/b.txt', 'x');
  await assert.rejects(() => zip.add('a/B.txt', 'y'), /Duplicate/);
  assert.equal(normalizeZipPath('/../a//./b\\c.txt'), 'a/b/c.txt');
  assert.throws(() => normalizeZipPath('../..'), /Invalid/);
});

test('sanitizes names for Windows, macOS and Linux', () => {
  assert.equal(sanitizeComponent('Unit 1: Poetry / Part A'), 'Unit 1 - Poetry - Part A');
  assert.equal(sanitizeComponent('What is "this"? <draft>*'), "What is 'this'_ _draft__");
  assert.equal(sanitizeComponent('CON'), '_CON');
  assert.equal(sanitizeComponent('lpt1.txt'), '_lpt1.txt');
  assert.equal(sanitizeComponent('  trailing dots... '), 'trailing dots');
  assert.equal(sanitizeComponent('...'), 'untitled');
  assert.equal(sanitizeComponent('', { fallback: 'x' }), 'x');
  assert.equal(sanitizeComponent('tab\there\u0000null'), 'tab herenull');
  const long = sanitizeComponent(`${'a'.repeat(300)}.pdf`, { maxLength: 90 });
  assert.equal(long.length, 90);
  assert.ok(long.endsWith('.pdf'));
  const wide = sanitizeComponent(`${'漢'.repeat(150)}.docx`, { maxLength: 150 });
  assert.ok(new TextEncoder().encode(wide).length <= 200);
  assert.ok(wide.endsWith('.docx'));
});

test('splits extensions conservatively', () => {
  assert.deepEqual(splitExtension('report.final.pdf'), ['report.final', '.pdf']);
  assert.deepEqual(splitExtension('Chapter 4. Intro'), ['Chapter 4. Intro', '']);
  assert.deepEqual(splitExtension('.hidden'), ['.hidden', '']);
});

test('parses Content-Disposition headers', () => {
  assert.equal(parseContentDisposition('attachment; filename="a b.pdf"'), 'a b.pdf');
  assert.equal(parseContentDisposition("attachment; filename=\"R_sum_.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf"), 'Résumé.pdf');
  assert.equal(parseContentDisposition('attachment; filename=plain.txt'), 'plain.txt');
  assert.equal(parseContentDisposition('attachment; filename="q\\"uote.txt"'), 'q"uote.txt');
  // Raw UTF-8 bytes that arrived as Latin-1.
  const latin1 = Buffer.from('Ünïcode.pdf', 'utf8').toString('latin1');
  assert.equal(parseContentDisposition(`attachment; filename="${latin1}"`), 'Ünïcode.pdf');
  assert.equal(parseContentDisposition('inline'), null);
  assert.equal(parseContentDisposition(''), null);
});

test('chooses saved file names', () => {
  assert.equal(chooseFileName({ headerName: 'Macbeth.pdf', displayName: 'Other' }), 'Macbeth.pdf');
  assert.equal(chooseFileName({ displayName: 'Act 1 notes', fallbackExt: '.docx' }), 'Act 1 notes.docx');
  assert.equal(chooseFileName({ displayName: 'Unit 1.2', fallbackExt: '.pptx' }), 'Unit 1.2.pptx');
  assert.equal(chooseFileName({ displayName: 'scan', contentType: 'image/jpeg' }), 'scan.jpg');
  assert.equal(chooseFileName({ headerName: 'Résumé: draft?.pdf' }), 'Résumé - draft_.pdf');
  assert.equal(chooseFileName({}), 'attachment');
  assert.equal(extensionForContentType('application/pdf; charset=binary'), '.pdf');
});

test('allocates unique names case-insensitively and deterministically', () => {
  const a = new NameAllocator();
  assert.equal(a.allocate('dir', 'notes.pdf'), 'notes.pdf');
  assert.equal(a.allocate('dir', 'Notes.pdf'), 'Notes (2).pdf');
  assert.equal(a.allocate('dir', 'notes.pdf'), 'notes (3).pdf');
  assert.equal(a.allocate('other', 'notes.pdf'), 'notes.pdf');
  a.reserve('dir', 'description.txt');
  assert.equal(a.allocate('dir', 'Description.txt'), 'Description (2).txt');
});
