import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extensionIdFromCrxId,
  extensionIdFromPrivateKey,
  generatePrivateKeyPem,
  packCrx,
  parseCrx,
  verifyCrx,
} from '../../scripts/lib/crx.mjs';
import { buildExtensionZip, extensionFiles } from '../../scripts/lib/extension-bundle.mjs';
import { tempDir } from '../helpers/zip.mjs';

const key = generatePrivateKeyPem();

test('extension IDs use the letters a-p of the CRX id', () => {
  assert.equal(extensionIdFromCrxId(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')), 'aaabacadaeafagahaiajakalamanaoap');
  assert.match(extensionIdFromPrivateKey(key), /^[a-p]{32}$/);
});

test('the extension ZIP is deterministic and has manifest.json at the root', async () => {
  const a = await buildExtensionZip();
  const b = await buildExtensionZip();
  assert.ok(a.bytes.equals(b.bytes));
  assert.equal(a.files[0], 'manifest.json');
  assert.ok(a.files.includes('src/background/service-worker.js'));
  assert.ok(a.files.every((f) => f === 'manifest.json' || f.startsWith('src/') || f.startsWith('icons/')), 'only extension files');
  assert.deepEqual(a.files, extensionFiles());
});

test('packs a CRX3 that verifies and carries the ZIP unchanged', async () => {
  const { bytes: zip } = await buildExtensionZip();
  const crx = packCrx(zip, key);
  assert.equal(crx.subarray(0, 4).toString(), 'Cr24');
  assert.equal(crx.readUInt32LE(4), 3);
  const result = verifyCrx(crx);
  assert.equal(result.extensionId, extensionIdFromPrivateKey(key));
  assert.ok(Buffer.from(result.zip).equals(zip));
  assert.ok(packCrx(zip, key).equals(crx), 'same key and ZIP give the same CRX');
});

test('the signature verifies with OpenSSL (independent check)', async () => {
  const { bytes: zip } = await buildExtensionZip();
  const parsed = parseCrx(packCrx(zip, key));
  const dir = tempDir('gcx-crx-');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(parsed.signedHeaderData.length);
  writeFileSync(join(dir, 'signed.bin'), Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'binary'), size, parsed.signedHeaderData, parsed.zip]));
  writeFileSync(join(dir, 'sig.bin'), parsed.proofs[0].signature);
  writeFileSync(join(dir, 'pub.pem'), createPublicKey({ key: parsed.proofs[0].publicKey, format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' }));
  const out = execFileSync('openssl', ['dgst', '-sha256', '-verify', join(dir, 'pub.pem'), '-signature', join(dir, 'sig.bin'), join(dir, 'signed.bin')], { encoding: 'utf8' });
  assert.match(out, /Verified OK/);
});

test('tampered or foreign CRX files are rejected', async () => {
  const { bytes: zip } = await buildExtensionZip();
  const crx = packCrx(zip, key);
  const tampered = Buffer.from(crx);
  tampered[tampered.length - 30] ^= 0xff;
  assert.throws(() => verifyCrx(tampered), /signature does not verify/);
  assert.throws(() => verifyCrx(Buffer.concat([Buffer.from('PK\x03\x04'), zip])), /Not a CRX/);
  const v2 = Buffer.from(crx);
  v2.writeUInt32LE(2, 4);
  assert.throws(() => verifyCrx(v2), /Unsupported CRX version 2/);
  assert.throws(() => packCrx(zip, 'not a key'), /./);
});
