#!/usr/bin/env node
// Build dist/google-classroom-bulk-exporter-<version>.crx (a packed, signed
// extension) from the same files as the release ZIP.
//
// Signing key (an RSA private key in PEM; it fixes the extension ID):
//   --key <file>            read the key from a file, or
//   CRX_PRIVATE_KEY=<pem>   read it from the environment (CI secret), or
//   --generate-key <file>   create a new key, save it to <file>, and use it.
// Keep the key private and reuse it for every release: a different key gives
// a different extension ID, and Chrome treats that as another extension.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { extensionIdFromPrivateKey, generatePrivateKeyPem, packCrx, verifyCrx } from './lib/crx.mjs';
import { buildExtensionZip, DIST, PACKAGE_NAME, readManifest, ROOT } from './lib/extension-bundle.mjs';

function option(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

let keyPem = null;
let keySource = null;
const keyFile = option('--key');
const generateTo = option('--generate-key');
if (keyFile) {
  keyPem = readFileSync(keyFile, 'utf8');
  keySource = 'file';
} else if (process.env.CRX_PRIVATE_KEY && process.env.CRX_PRIVATE_KEY.trim()) {
  keyPem = process.env.CRX_PRIVATE_KEY;
  keySource = 'secret';
} else if (generateTo) {
  if (existsSync(generateTo)) throw new Error(`${generateTo} already exists; refusing to overwrite a key.`);
  keyPem = generatePrivateKeyPem();
  writeFileSync(generateTo, keyPem, { mode: 0o600 });
  keySource = 'generated';
  console.log(`Generated a new signing key: ${generateTo} (keep it private).`);
} else {
  console.error('No signing key: pass --key <file>, set CRX_PRIVATE_KEY, or pass --generate-key <file>.');
  process.exit(2);
}

const manifest = readManifest();
const { bytes: zip, files } = await buildExtensionZip();
const crx = packCrx(zip, keyPem);
const { extensionId } = verifyCrx(crx);
if (extensionId !== extensionIdFromPrivateKey(keyPem)) throw new Error('Packed CRX does not match its key.');

mkdirSync(DIST, { recursive: true });
const out = option('--out') || join(DIST, `${PACKAGE_NAME}-${manifest.version}.crx`);
writeFileSync(out, crx);
writeFileSync(join(DIST, 'crx-info.json'), `${JSON.stringify({ extensionId, keySource, version: manifest.version, file: relative(DIST, out) }, null, 2)}\n`);
console.log(`Wrote ${relative(ROOT, out)} (${files.length} files, ${crx.length} bytes)`);
console.log(`Extension ID: ${extensionId}`);
