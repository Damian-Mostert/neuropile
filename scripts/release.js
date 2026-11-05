#!/usr/bin/env node
'use strict';

// Release helper. Bumps the version, commits, tags, and pushes — which
// triggers the publish workflow on GitHub.
//
//   npm run release            # patch bump  (0.1.1 -> 0.1.2)
//   npm run release -- minor   # minor bump  (0.1.1 -> 0.2.0)
//   npm run release -- major   # major bump  (0.1.1 -> 1.0.0)
//
// The push triggers .github/workflows/publish.yml, which compares the new
// version against the npm registry and publishes only if it is not there yet.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
}

function fail(message) {
  console.error(`\n  release: ${message}\n`);
  process.exit(1);
}

const bump = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) {
  fail(`unknown bump type "${bump}". Use patch, minor, or major.`);
}

// Refuse to run with a dirty tree, so the tag always matches the commit.
const status = run('git', ['status', '--porcelain'], { capture: true }).trim();
if (status) {
  fail('the working tree is dirty. Commit or stash your changes first.');
}

// Refuse to run if the current version is already published, because npm will
// reject a duplicate version and the tag would be meaningless.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const current = pkg.version;

let alreadyPublished = false;
try {
  const info = run('npm', ['view', `${pkg.name}@${current}`, 'version'], { capture: true });
  alreadyPublished = info.trim() === current;
} catch {
  // A 404 means the version is not on the registry, which is what we want.
  alreadyPublished = false;
}

if (alreadyPublished) {
  fail(`${pkg.name}@${current} is already published. Bump the version before releasing.`);
}

// Bump. `npm version` updates package.json, package-lock.json, and creates
// the commit and tag in one step.
run('npm', ['version', bump, '--no-git-tag-version']);

const updated = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const next = updated.version;
const tag = `v${next}`;

const existingTag = run('git', ['tag', '-l', tag], { capture: true }).trim();
if (existingTag) {
  fail(`tag ${tag} already exists. Choose a different version.`);
}

console.log(`\n  release: ${pkg.name} ${current} -> ${next}`);
console.log(`  release: committing and tagging ${tag}\n`);

run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', `release: ${next}`]);
run('git', ['tag', '-a', tag, '-m', `${pkg.name} ${next}`]);

console.log(`\n  release: pushing ${tag} to origin.`);
console.log('  release: the publish workflow will run automatically.\n');

run('git', ['push', 'origin', 'HEAD']);
run('git', ['push', 'origin', tag]);

console.log(`\n  release: done. ${pkg.name}@${next} is on its way to npm.\n`);
console.log('  Watch it at: https://github.com/Damian-Mostert/neuropile/actions\n');
