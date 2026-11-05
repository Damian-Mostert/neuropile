#!/usr/bin/env node
'use strict';

// Generates docs/llms-full.txt by concatenating every doc file into one
// document. This is the "llmsFull" target: a single file an agent can fetch
// to get the whole picture without making four separate reads.
//
//   node scripts/gen-llms-full.js
//
// Runs as part of `npm run build` and is checked by the prepublish guard, so
// the file in the published tarball always matches the docs it came from.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const docsDir = path.join(root, 'docs');

const ORDER = [
  'getting-started.md',
  'api.md',
  'patterns.md',
  'gotchas.md',
  'concepts.md',
];

const missing = ORDER.filter(name => !fs.existsSync(path.join(docsDir, name)));
if (missing.length > 0) {
  console.error(`  gen-llms-full: missing doc files: ${missing.join(', ')}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const parts = [
  `# ${pkg.name} v${pkg.version} - full documentation`,
  '',
  `> Complete documentation for the ${pkg.name} package, concatenated into a`,
  '> single file. This is the "llmsFull" target for agents that want everything',
  '> in one read.',
  '',
  `Package: npmjs.com/package/${pkg.name}`,
  `Repository: ${(pkg.repository && pkg.repository.url) || 'unknown'}`,
  '',
];

for (const name of ORDER) {
  const body = fs.readFileSync(path.join(docsDir, name), 'utf8').trim();
  parts.push('---', '', `# ${name.replace(/\.md$/, '')}`, '', body, '');
}

const output = parts.join('\n');
const outPath = path.join(docsDir, 'llms-full.txt');

const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
if (existing === output) {
  console.log('  gen-llms-full: up to date');
  process.exit(0);
}

fs.writeFileSync(outPath, output, 'utf8');
console.log(`  gen-llms-full: wrote ${path.relative(root, outPath)} (${output.length} bytes)`);
