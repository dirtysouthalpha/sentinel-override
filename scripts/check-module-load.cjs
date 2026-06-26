#!/usr/bin/env node
/**
 * CI Check: Module Loader Validation
 * Catches runtime ReferenceErrors (stray characters, bare identifiers) that
 * node --check misses because it only validates syntax, not runtime evaluation.
 *
 * This would have caught ALL three stray-n crashes (v21.5.17, v21.6.1) instantly.
 */

const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');

let failed = false;

// Track all loaded module URLs to avoid double-loading
const loaded = new Set();

// Read all background JS files
const bgDir = join(__dirname, '..', 'background');
const bgFiles = readdirSync(bgDir).filter(f => f.endsWith('.js'));

// Write a temporary ESM loader script
const loaderCode = `
const noop = () => {};
function makeMock() {
  const fn = function() { return makeMock(); };
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;
      if (prop in target && target[prop] !== undefined) return target[prop];
      return makeMock();
    },
    apply() { return makeMock(); },
    construct() { return makeMock(); }
  });
}

globalThis.chrome = makeMock();
globalThis.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: () => 'test-uuid-' + Math.random() },
  writable: true, configurable: true
});
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', webdriver: false, plugins: { length: 1, item: () => ({name:'test'}) }, languages: ['en-US'] },
  writable: true, configurable: true
});
globalThis.location = { href: 'about:blank', hostname: 'localhost' };
globalThis.document = {
  addEventListener: noop, getElementById: () => null, querySelector: () => null,
  querySelectorAll: () => [], createElement: () => ({ style: {}, appendChild: noop, addEventListener: noop, setAttribute: noop }),
  body: { appendChild: noop, addEventListener: noop }
};
globalThis.window = globalThis;

const modules = ${JSON.stringify(bgFiles)};
const errors = [];

for (const mod of modules) {
  try {
    await import(\`./background/\${mod}\`);
  } catch (e) {
    if (e instanceof ReferenceError) {
      errors.push({ file: mod, error: e.message, stack: e.stack?.split('\\n').slice(0, 4).join(' | ') });
    }
    // Ignore TypeError from missing chrome APIs — those are expected in Node
  }
}

if (errors.length > 0) {
  console.error('\\n❌ MODULE LOADER CHECK FAILED — ReferenceErrors found:');
  for (const e of errors) {
    console.error('  ' + e.file + ': ' + e.error);
    if (e.stack) console.error('    ' + e.stack);
  }
  process.exit(1);
} else {
  console.log('✅ Module loader check passed — ' + modules.length + ' modules evaluated, 0 ReferenceErrors');
}
process.exit(0);
`;

const { writeFileSync } = require('fs');
writeFileSync(join(__dirname, '_loader-check.mjs'), loaderCode);

const { execSync } = require('child_process');
try {
  execSync('node --input-type=module < scripts/_loader-check.mjs', {
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  });
} catch (e) {
  failed = true;
} finally {
  require('fs').unlinkSync(join(__dirname, '_loader-check.mjs'));
}

process.exit(failed ? 1 : 0);
