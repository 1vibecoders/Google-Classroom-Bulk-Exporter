#!/usr/bin/env node
// Fail unless the release tag (e.g. v1.2.0) matches the version in
// manifest.json and package.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, ROOT } from './lib/extension-bundle.mjs';

const tag = process.argv[2] || '';
const manifestVersion = readManifest().version;
const packageVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const problems = [];
if (!/^v\d+(\.\d+){0,3}$/.test(tag)) problems.push(`Tag "${tag}" is not of the form v1.2.3.`);
if (tag !== `v${manifestVersion}`) problems.push(`Tag ${tag} does not match manifest.json version ${manifestVersion}.`);
if (packageVersion !== manifestVersion) problems.push(`package.json version ${packageVersion} differs from manifest.json version ${manifestVersion}.`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Releasing version ${manifestVersion}.`);
