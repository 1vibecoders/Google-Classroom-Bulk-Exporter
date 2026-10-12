// The files that make up the extension and the ZIP built from them. Shared by
// the packaging, CRX and release scripts so every artifact has the same content.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipWriter } from '../../src/engine/zip-writer.js';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DIST = join(ROOT, 'dist');
export const PACKAGE_NAME = 'google-classroom-bulk-exporter';

export function readManifest() {
  return JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
}

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

/** Paths (relative to the repository root) included in the extension. */
export function extensionFiles() {
  const walked = [...walk(join(ROOT, 'icons')), ...walk(join(ROOT, 'src'))];
  return ['manifest.json', ...walked.map((p) => relative(ROOT, p).split(sep).join('/'))];
}

/**
 * ZIP of the extension with manifest.json at the root: it can be extracted and
 * loaded unpacked, uploaded to the Chrome Web Store, or packed into a CRX.
 * Timestamps are fixed so the same sources always give the same bytes.
 */
export async function buildExtensionZip({ date = new Date(2026, 0, 1) } = {}) {
  const files = extensionFiles();
  const zip = new ZipWriter({ date });
  for (const rel of files) {
    await zip.add(rel, new Uint8Array(readFileSync(join(ROOT, rel))), { compress: true });
  }
  const blob = zip.finish();
  return { bytes: Buffer.from(await blob.arrayBuffer()), files };
}
