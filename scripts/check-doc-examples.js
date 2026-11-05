'use strict';

// Extracts the JS code blocks from the docs and runs the self-contained ones
// to check they actually work. Run from the repo root:
//   node scripts/check-doc-examples.js
//
// Blocks that need a test harness (assert), that are ES modules, or that
// start a server are adapted before running. A block that fails is a bug in
// the documentation.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const docs = ['docs/getting-started.md', 'docs/patterns.md', 'docs/gotchas.md', 'docs/api.md'];

let failures = 0;
let ran = 0;
let skipped = 0;

for (const rel of docs) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const md = fs.readFileSync(file, 'utf8');

  // Match both LF and CRLF code fences. The docs are edited on Windows,
  // so some blocks arrive with carriage returns, and a pattern that only
  // matched LF silently found nothing at all.
  const blocks = [...md.matchAll(/```js\r?\n([\s\S]*?)```/g)].map(m => m[1]);

  blocks.forEach((raw, i) => {
    const label = `${rel} block ${i + 1}`;

    // Only consider blocks that actually use the package.
    if (!/require\(['"](neuropile|\.\/index\.js)['"]\)/.test(raw)) {
      skipped++;
      return;
    }
    if (!/const\s*\{[^}]*\}\s*=\s*require/.test(raw)) {
      skipped++;
      return;
    }

    let code = raw;
    let ext = '.js';

    // Blocks that use assert need the import.
    if (/\bassert\./.test(code) && !/require\('node:assert/.test(code)) {
      code = `const assert = require('node:assert/strict');\n${code}`;
    }

    // ES module blocks (import statements) need the .mjs extension.
    if (/^\s*import\s/m.test(code)) {
      ext = '.mjs';
    }

    // The package cannot require itself by name, so point those at the
    // local entry point instead.
    code = code.replace(/require\(['"]neuropile['"]\)/g, "require('./index.js')");

    // Fragments that assume an existing `brain` get one.
    if (/\bbrain\b/.test(code) && !/const\s+brain\s*=/.test(code)) {
      code = `const { Brain } = require('./index.js');\nconst brain = new Brain({ sizeGB: 0.01 });\n${code}`;
    }

    // Top-level await needs an async wrapper.
    if (/^\s*await\s/m.test(code) && !/async\s+function|async\s*\(|=>\s*\{/.test(code)) {
      code = `;(async () => {\n${code}\n})();`;
    }

    // Blocks that open a server would hang; close it right after listening.
    if (/server\.listen\(/.test(code) && !/server\.close/.test(code)) {
      code += '\nserver.close();\n';
    }

    const tmp = path.join(root, `.doc-example-${process.pid}-${i}${ext}`);
    fs.writeFileSync(tmp, code, 'utf8');
    ran++;

    // Some snippets write files. Note what exists first so we only remove
    // what the snippet created.
    const before = new Set(fs.readdirSync(root));

    try {
      execFileSync('node', [tmp], {
        cwd: root,
        stdio: 'pipe',
        timeout: 120000,
        env: { ...process.env, NODE_PATH: root },
      });
      console.log(`  ok   ${label}`);
    } catch (err) {
      failures++;
      const stderr = (err.stderr || '').toString();
      console.error(`  FAIL ${label}`);
      console.error(`       ${stderr.split('\n').slice(0, 8).join('\n       ')}`);
    } finally {
      fs.unlinkSync(tmp);
      // Clean up any files the snippet created.
      for (const name of fs.readdirSync(root)) {
        if (!before.has(name) && !name.startsWith('.doc-example-')) {
          try {
            fs.rmSync(path.join(root, name), { recursive: true, force: true });
          } catch {
            // Ignore cleanup failures.
          }
        }
      }
    }
  });
}

console.log(`\n  doc examples: ${ran} run, ${failures} failed, ${skipped} skipped`);
process.exit(failures > 0 ? 1 : 0);
