#!/usr/bin/env node
// Build dist/google-classroom-bulk-exporter-<version>.zip containing only the
// files the extension needs (manifest, icons, src), e.g. for the Chrome Web
// Store or for sharing. Uses the extension's own ZIP writer.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ZipWriter } from '../src/engine/zip-writer.js';

const root = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

const files = [join(root, 'manifest.json'), ...walk(join(root, 'icons')), ...walk(join(root, 'src'))];
const zip = new ZipWriter({ date: new Date() });
for (const file of files) {
  const rel = relative(root, file);
  await zip.add(rel, new Uint8Array(readFileSync(file)), { compress: true });
}
const blob = zip.finish();
mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', `google-classroom-bulk-exporter-${manifest.version}.zip`);
writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log(`Wrote ${relative(root, out)} (${files.length} files, ${blob.size} bytes)`);
