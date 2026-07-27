#!/usr/bin/env node
/**
 * Web dashboard load gate.
 *
 * The two dashboards under web/ are plain browser pages with no build step, so
 * nothing else in CI ever parsed them. A stray character inside the 1000-line
 * inline <script> of dashboard-prime.html would ship silently and blank the
 * page at runtime. This script:
 *
 *   1. parses every web/*.html with linkedom (already a devDependency)
 *   2. extracts each inline <script> and syntax-checks it with vm.Script
 *   3. syntax-checks every web/**\/*.js the same way
 *   4. asserts each page still contains the elements its script drives
 *
 * Exit code 0 = all good, 1 = something is broken.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHTML } = require('linkedom');

const WEB_DIR = path.join(__dirname, '..', 'web');
let failures = 0;
let checks = 0;

function fail(msg) {
  failures += 1;
  console.error(`  FAIL: ${msg}`);
}

function pass(msg) {
  checks += 1;
  console.log(`  ok: ${msg}`);
}

// vm.Script compiles without executing — exactly the "does this parse" question,
// and it works on inline script text that has no file of its own.
function checkSyntax(code, label) {
  try {
    new vm.Script(code, { filename: label });
    pass(`${label} parses`);
  } catch (e) {
    fail(`${label} — ${e.message}`);
  }
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(WEB_DIR);

// ── Standalone JS files ───────────────────────────────────────────────────
console.log('Checking web/**/*.js syntax...');
for (const file of files.filter((f) => f.endsWith('.js'))) {
  checkSyntax(fs.readFileSync(file, 'utf8'), path.relative(WEB_DIR, file));
}

// ── HTML pages + their inline scripts ─────────────────────────────────────
console.log('Checking web/**/*.html...');
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const rel = path.relative(WEB_DIR, file);
  const html = fs.readFileSync(file, 'utf8');

  let document;
  try {
    ({ document } = parseHTML(html));
    pass(`${rel} parses as HTML`);
  } catch (e) {
    fail(`${rel} — HTML parse error: ${e.message}`);
    continue;
  }

  const scripts = [...document.querySelectorAll('script')];
  let inlineIndex = 0;
  for (const script of scripts) {
    const src = script.getAttribute('src');
    if (src) {
      // Verify referenced local scripts actually exist.
      if (!/^https?:/i.test(src)) {
        const target = path.resolve(path.dirname(file), src);
        if (fs.existsSync(target)) pass(`${rel} -> ${src} exists`);
        else fail(`${rel} references missing script ${src}`);
      }
      continue;
    }
    const code = script.textContent || '';
    if (!code.trim()) continue;
    inlineIndex += 1;
    checkSyntax(code, `${rel} inline script #${inlineIndex}`);
  }

  // Element-existence smoke check: every id the inline script reads via
  // getElementById must be present, or the page is quietly half-broken.
  const inline = scripts.filter((s) => !s.getAttribute('src')).map((s) => s.textContent || '').join('\n');
  const ids = new Set();
  for (const m of inline.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) ids.add(m[1]);
  for (const m of inline.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)) ids.add(m[1]);
  const missing = [...ids].filter((id) => !document.getElementById(id));
  if (missing.length) fail(`${rel} script targets missing element ids: ${missing.join(', ')}`);
  else if (ids.size) pass(`${rel} all ${ids.size} getElementById targets exist`);
}

console.log(`\n${checks} checks passed, ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);
