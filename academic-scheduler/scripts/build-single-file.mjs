// After `vite build`: write dist/academic-scheduler.html, a single
// self-contained file (scripts and styles inlined) that works offline when
// opened directly from disk — no server, no network.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
let html = await readFile(join(dist, 'index.html'), 'utf8');

const scriptTags = [...html.matchAll(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g)];
const styleTags = [...html.matchAll(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g)];
if (!scriptTags.length) throw new Error('build-single-file: no module script found in dist/index.html');

for (const [tag, file] of styleTags) {
  const css = (await readFile(join(dist, file), 'utf8')).replace(/<\/style/gi, '<\\/style');
  html = html.replace(tag, () => `<style>\n${css}\n</style>`);
}
// Module scripts run after parsing, so moving them to the end of <body> keeps
// the same behavior for an inline copy.
let bodyScripts = '';
for (const [tag, file] of scriptTags) {
  const js = (await readFile(join(dist, file), 'utf8')).replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, '');
  bodyScripts += `<script type="module">\n${js}\n</script>\n`;
}
html = html.replace('</body>', () => `${bodyScripts}</body>`);

if (/(src|href)="\.\/assets\//.test(html)) throw new Error('build-single-file: an asset reference was left un-inlined');
await writeFile(join(dist, 'academic-scheduler.html'), html);
console.log(`build-single-file: wrote dist/academic-scheduler.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB)`);
