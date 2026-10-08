// Cross-check the CRX packer against Chromium's own "Pack extension".
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extensionIdFromPrivateKey, generatePrivateKeyPem, packCrx, parseCrx, verifyCrx } from '../../scripts/lib/crx.mjs';
import { buildExtensionZip, ROOT } from '../../scripts/lib/extension-bundle.mjs';
import { chromiumPath } from '../helpers/browser.mjs';
import { tempDir } from '../helpers/zip.mjs';

test('our CRX matches the key, id and header layout of a Chromium-packed CRX', async (t) => {
  const chrome = chromiumPath();
  if (!chrome || !existsSync(chrome)) return t.skip('Chromium not found');
  const dir = tempDir('gcx-crx-chromium-');
  const ext = join(dir, 'ext');
  for (const part of ['manifest.json', 'icons', 'src']) cpSync(join(ROOT, part), join(ext, part), { recursive: true });
  const key = generatePrivateKeyPem();
  writeFileSync(join(dir, 'key.pem'), key);
  execFileSync(chrome, ['--headless=new', '--no-sandbox', `--user-data-dir=${join(dir, 'profile')}`, `--pack-extension=${ext}`, `--pack-extension-key=${join(dir, 'key.pem')}`], { stdio: 'pipe', timeout: 60000 });
  const reference = readFileSync(join(dir, 'ext.crx'));

  // Chromium's file passes our verifier and has the id we derive from the key.
  const ref = verifyCrx(reference);
  assert.equal(ref.extensionId, extensionIdFromPrivateKey(key));

  const { bytes: zip } = await buildExtensionZip();
  const ours = parseCrx(packCrx(zip, key));
  const theirs = parseCrx(reference);
  assert.equal(ours.version, theirs.version);
  assert.equal(ours.proofs.length, theirs.proofs.length);
  assert.ok(ours.proofs[0].publicKey.equals(theirs.proofs[0].publicKey));
  assert.ok(ours.crxId.equals(theirs.crxId));
  assert.ok(ours.signedHeaderData.equals(theirs.signedHeaderData));
});
