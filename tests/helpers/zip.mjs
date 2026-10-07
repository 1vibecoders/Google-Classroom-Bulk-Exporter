// Verify ZIP archives with independent tools (Python's zipfile and Info-ZIP).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const INSPECT = `
import json, sys, zipfile, hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
    bad = z.testzip()
    out = {"bad": bad, "entries": []}
    for info in z.infolist():
        data = z.read(info)
        out["entries"].append({
            "name": info.filename,
            "size": info.file_size,
            "compress": info.compress_type,
            "utf8": bool(info.flag_bits & 0x800),
            "sha1": hashlib.sha1(data).hexdigest(),
            "text": data.decode("utf-8", "replace") if info.filename.endswith((".txt", ".json", ".url", ".html")) else None,
        })
    print(json.dumps(out))
`;

export function tempDir(prefix = 'gcx-test-') {
  const base = process.env.GCX_TMP || tmpdir();
  return mkdtempSync(join(base, prefix));
}

export async function writeBlob(blob, path) {
  writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
  return path;
}

/** Inspect an archive with Python's zipfile (CRC-checked). */
export function inspectZip(path) {
  const out = execFileSync('python3', ['-I', '-c', INSPECT, path], { encoding: 'utf8' });
  return JSON.parse(out);
}

/** Run Info-ZIP's integrity test; throws on failure. */
export function unzipTest(path) {
  return execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
}
