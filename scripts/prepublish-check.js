#!/usr/bin/env node
'use strict';

// Pre-publish guard. Runs before `npm publish` (via the prepublishOnly hook)
// and fails the publish if something is obviously wrong.
//
// This protects against the mistakes that are expensive on a public registry:
// a mismatched version, a stray example file, a broken README reference, or a
// repository URL that points at the wrong project.
//
// It is safe to run at any time:  node scripts/prepublish-check.js

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const problems = [];
const warnings = [];

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

// ── Version sanity ───────────────────────────────────────────────────────────
const pkg = readPkg();
const version = String(pkg.version || '');

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  problems.push(`version "${version}" is not a valid semver string.`);
}

// ── Required metadata ────────────────────────────────────────────────────────
for (const field of ['name', 'version', 'description', 'license', 'author', 'repository']) {
  if (!pkg[field]) problems.push(`package.json is missing "${field}".`);
}

// ── The repository URL should point at this project ──────────────────────────
const repoUrl = pkg.repository && pkg.repository.url;
if (repoUrl) {
  if (!/neuropile/i.test(repoUrl)) {
    problems.push(
      `repository.url points somewhere unexpected: ${repoUrl}\n` +
      '    It should reference the neuropile repository.',
    );
  }
  if (/\/tree\//.test(repoUrl) || /\/cpp/.test(repoUrl)) {
    problems.push(
      `repository.url looks like a subdirectory URL: ${repoUrl}\n` +
      '    Point it at the repository root.',
    );
  }
}

// ── Files listed in package.json must exist ──────────────────────────────────
for (const entry of pkg.files || []) {
  if (!fs.existsSync(path.join(root, entry))) {
    problems.push(`package.json "files" lists "${entry}", which does not exist.`);
  }
}

// ── The entry points must exist ──────────────────────────────────────────────
for (const entry of ['index.js', 'index.mjs', 'index.d.ts']) {
  if (!fs.existsSync(path.join(root, entry))) {
    problems.push(`missing entry point "${entry}".`);
  }
}

// ── The version the addon reports must match package.json ────────────────────
try {
  const mod = require(path.join(root, 'index.js'));
  if (mod.VERSION !== version) {
    problems.push(`VERSION export is "${mod.VERSION}" but package.json says "${version}".`);
  }
  if (mod.nativeModule && mod.nativeModule.version !== version) {
    warnings.push(
      `the compiled addon reports "${mod.nativeModule.version}" but package.json says "${version}".\n` +
      '    Run "npm run build" so the addon picks up the new version.',
    );
  }
} catch (err) {
  warnings.push(`could not load index.js to verify the version: ${err.message}`);
}

// ── README sanity ────────────────────────────────────────────────────────────
const readmePath = path.join(root, 'README.md');
if (!fs.existsSync(readmePath)) {
  problems.push('README.md is missing.');
} else {
  const readme = fs.readFileSync(readmePath, 'utf8');
  if (readme.length < 500) {
    problems.push('README.md looks suspiciously short.');
  }
  if (!readme.includes('# neuropile')) {
    warnings.push('README.md does not start with a "# neuropile" heading.');
  }
}

// ── The generated llms-full.txt must match the docs it came from ────────────
try {
  const { execFileSync } = require('node:child_process');
  const before = fs.existsSync(path.join(root, 'docs', 'llms-full.txt'))
    ? fs.readFileSync(path.join(root, 'docs', 'llms-full.txt'), 'utf8')
    : null;
  execFileSync('node', [path.join(root, 'scripts', 'gen-llms-full.js')], {
    cwd: root,
    stdio: 'pipe',
  });
  const after = fs.readFileSync(path.join(root, 'docs', 'llms-full.txt'), 'utf8');
  if (before !== after) {
    warnings.push('docs/llms-full.txt was out of date and has been regenerated. Commit it.');
  }
} catch (err) {
  warnings.push(`could not regenerate docs/llms-full.txt: ${err.message}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
if (warnings.length > 0) {
  console.warn('\n  prepublish: warnings');
  for (const warning of warnings) console.warn(`    - ${warning}`);
  console.warn('');
}

if (problems.length > 0) {
  console.error('\n  prepublish: FAILED');
  for (const problem of problems) console.error(`    - ${problem}`);
  console.error('\n  Not publishing.\n');
  process.exit(1);
}

console.log(`  prepublish: OK (${pkg.name}@${version})`);
