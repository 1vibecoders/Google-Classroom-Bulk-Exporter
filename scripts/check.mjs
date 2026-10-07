#!/usr/bin/env node
// Static checks for the unpacked extension:
//   - every file referenced by manifest.json / injected by the background exists
//   - every JavaScript file parses (node --check)
//   - no remote code: no <script src="http..."> and no import from URLs
//   - no eval/new Function
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const referenced = new Set([
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  manifest.action && manifest.action.default_popup,
  manifest.background && manifest.background.service_worker,
  'src/offscreen/offscreen.html',
]);
const bridge = readFileSync(join(root, 'src/background/tab-bridge.js'), 'utf8');
for (const m of bridge.matchAll(/'(src\/[^']+\.js)'/g)) referenced.add(m[1]);
for (const file of referenced) {
  if (file && !existsSync(join(root, file))) problems.push(`Missing file referenced by the extension: ${file}`);
}

const sources = walk(join(root, 'src'));
for (const file of sources.filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`Syntax error in ${rel}:\n${err.stderr}`);
  }
  if (/\beval\s*\(|new Function\s*\(/.test(text)) problems.push(`Dynamic code evaluation in ${rel}`);
  if (/import\s[^;]*from\s+['"]https?:/.test(text) || /import\(\s*['"]https?:/.test(text)) problems.push(`Remote import in ${rel}`);
}
for (const file of sources.filter((f) => f.endsWith('.html'))) {
  const text = readFileSync(file, 'utf8');
  if (/<script[^>]+src=["']https?:/i.test(text)) problems.push(`Remote script in ${relative(root, file)}`);
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(text)) problems.push(`Inline script (blocked by the extension CSP) in ${relative(root, file)}`);
}

const permissions = manifest.permissions || [];
for (const p of ['tabs', '<all_urls>', 'cookies', 'webRequest']) {
  if (permissions.includes(p) || (manifest.host_permissions || []).includes(p)) problems.push(`Unexpected broad permission: ${p}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${referenced.size} referenced files present, ${sources.length} source files checked.`);
