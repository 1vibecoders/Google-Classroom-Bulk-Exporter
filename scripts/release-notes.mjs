#!/usr/bin/env node
// Write dist/RELEASE_NOTES.md and dist/SHA256SUMS.txt for the artifacts in
// dist/ (run after package.mjs and pack-crx.mjs). Usage: release-notes.mjs <tag>
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, PACKAGE_NAME, readManifest } from './lib/extension-bundle.mjs';

const tag = process.argv[2] || `v${readManifest().version}`;
const manifest = readManifest();
const zipName = `${PACKAGE_NAME}-${manifest.version}.zip`;
const crxName = `${PACKAGE_NAME}-${manifest.version}.crx`;
for (const name of [zipName, crxName]) {
  if (!existsSync(join(DIST, name))) throw new Error(`dist/${name} is missing; run npm run package and npm run pack:crx first.`);
}
const crxInfo = JSON.parse(readFileSync(join(DIST, 'crx-info.json'), 'utf8'));

const assets = [zipName, crxName];
const sums = assets.map((f) => `${createHash('sha256').update(readFileSync(join(DIST, f))).digest('hex')}  ${f}`);
writeFileSync(join(DIST, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

const keyNote =
  crxInfo.keySource === 'generated'
    ? `> **Note:** this CRX was signed with a one-time key because the repository has no \`CRX_PRIVATE_KEY\` secret yet, so a later release's CRX will have a different extension ID (Chrome treats it as a separate extension). The ZIP is not affected.\n`
    : '';

const notes = `## ${manifest.name} ${tag}

${manifest.description}

### Downloads

| File | Use it to |
| --- | --- |
| \`${zipName}\` | **Load unpacked** (works in every Chromium browser), upload to the Chrome Web Store, or pack yourself. \`manifest.json\` is at the root of the ZIP. |
| \`${crxName}\` | Install the **packed**, signed extension where off-store CRX installs are allowed (see below). Extension ID: \`${crxInfo.extensionId}\` |
| \`SHA256SUMS.txt\` | Check the downloads: \`sha256sum -c SHA256SUMS.txt\` |

${keyNote}
### Install the ZIP (load unpacked) — recommended

1. Download \`${zipName}\` and extract it to a folder you will keep (Chrome loads the extension from that folder).
2. Open \`chrome://extensions\`, turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder (the one that contains \`manifest.json\`).

To update, extract the new ZIP over the same folder and click the reload icon on the extension card.

### Install the CRX (packed)

Chrome only installs \`.crx\` files from outside the Chrome Web Store in some setups:

- **Linux:** open \`chrome://extensions\`, turn on **Developer mode** and drag the \`.crx\` file onto the page.
- **Managed devices (any OS):** deploy it with the \`ExtensionInstallForcelist\` policy and an update manifest that points to the \`.crx\` (extension ID above).
- **Windows / macOS (regular Chrome):** Chrome disables extensions installed from a \`.crx\` that are not in the Chrome Web Store. Use the ZIP with **Load unpacked** instead.

### Checksums (SHA-256)

\`\`\`
${sums.join('\n')}
\`\`\`

Everything runs locally in your browser; see the README for permissions, privacy and known limitations.
`;
writeFileSync(join(DIST, 'RELEASE_NOTES.md'), notes);
console.log(`Wrote dist/RELEASE_NOTES.md and dist/SHA256SUMS.txt (${assets.length} assets).`);
