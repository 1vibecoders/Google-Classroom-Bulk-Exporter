#!/usr/bin/env node
// Build dist/google-classroom-bulk-exporter-<version>.zip containing only the
// files the extension needs (manifest, icons, src), with manifest.json at the
// root: extract it and use "Load unpacked", upload it to the Chrome Web Store,
// or pack it into a CRX.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildExtensionZip, DIST, PACKAGE_NAME, readManifest, ROOT } from './lib/extension-bundle.mjs';

const manifest = readManifest();
const { bytes, files } = await buildExtensionZip();
mkdirSync(DIST, { recursive: true });
const out = join(DIST, `${PACKAGE_NAME}-${manifest.version}.zip`);
writeFileSync(out, bytes);
console.log(`Wrote ${relative(ROOT, out)} (${files.length} files, ${bytes.length} bytes)`);
