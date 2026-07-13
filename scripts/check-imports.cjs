#!/usr/bin/env node
/**
 * Import Resolution Checker
 * Verifies that every named import resolves to a real export.
 * Prevents service worker crashes from missing exports.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['background', 'content', 'popup-modules'];
let errors = 0;
let checked = 0;

function getExports(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const exports = new Set();

  // export function/const/let/var/class/async function NAME
  const re1 = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re1.exec(code)) !== null) exports.add(m[1]);

  // export { foo, bar as baz }
  // Strip single-line comments before parsing to handle export blocks with
  // inline comments (e.g. "// Internal helpers" lines between export names)
  const re2 = /export\s*\{([^}]+)\}/g;
  while ((m = re2.exec(code)) !== null) {
    const cleaned = m[1].replace(/\/\/[^\n]*/g, '');
    const parts = cleaned.split(',');
    for (const p of parts) {
      const name = p.trim().split(/\s+as\s+/)[0].trim();
      if (name && /^[A-Za-z_$]/.test(name)) exports.add(name);
    }
  }

  if (/export\s+default\b/.test(code)) exports.add('default');
  return exports;
}

function getImports(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  const re = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (/import\s+type\s+\{/.test(m[0])) continue;
    const parts = m[1].split(',');
    const names = [];
    for (const p of parts) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      names.push(trimmed.split(/\s+as\s+/)[0].trim());
    }
    imports.push({ named: names, from: m[2] });
  }
  return imports;
}

function checkDir(dir) {
  const fullDir = path.join(ROOT, dir);
  if (!fs.existsSync(fullDir)) return;
  const entries = fs.readdirSync(fullDir);
  // (audit) Recurse into subdirectories (e.g. background/skills, background/platforms)
  // — previously skipped, exempting ~30 files from the missing-export check.
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__pycache__') continue;
    if (fs.statSync(path.join(fullDir, entry)).isDirectory()) {
      checkDir(path.join(dir, entry));
    }
  }
  const files = entries.filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .filter(f => !fs.statSync(path.join(fullDir, f)).isDirectory());

  for (const file of files) {
    const filePath = path.join(fullDir, file);
    const imports = getImports(filePath);

    for (const imp of imports) {
      if (!imp.from.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(filePath), imp.from);
      const targetFile = resolved.endsWith('.js') ? resolved : resolved + '.js';

      if (!fs.existsSync(targetFile)) {
        console.error(`FAIL ${path.relative(ROOT, filePath)}: Cannot resolve '${imp.from}'`);
        errors++;
        continue;
      }

      const available = getExports(targetFile);
      for (const name of imp.named) {
        checked++;
        if (!available.has(name)) {
          console.error(`FAIL ${path.relative(ROOT, filePath)}: imports '${name}' from '${imp.from}' but it is not exported`);
          errors++;
        }
      }
    }
  }
}

console.log('Checking import resolution...');
for (const dir of DIRS) checkDir(dir);
console.log(`Checked ${checked} named imports.`);

if (errors > 0) {
  console.error(`FAIL: ${errors} unresolvable import(s). SW will crash.`);
  process.exit(1);
} else {
  console.log('PASS: All named imports resolve.');
  process.exit(0);
}
