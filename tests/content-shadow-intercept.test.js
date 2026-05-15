// tests/content-shadow-intercept.test.js
// Unit tests for content/shadow-intercept.js — attachShadow patch, captured roots.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createSandbox() {
  const mapSetLog = [];
  const setAddLog = [];
  const sandbox = {
    window: {},
    Element: {
      prototype: {
        attachShadow: function (init) {
          return { host: this, mode: init?.mode || 'open' };
        }
      }
    }
  };
  sandbox.window = sandbox;
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../content/shadow-intercept.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'shadow-intercept.js' });
  script.runInContext(sandbox);
  return sandbox;
}

describe('shadow-intercept.js', () => {
  test('sets __sentinelShadowIntercepted flag on first load', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    expect(sandbox.window.__sentinelShadowIntercepted).toBe(true);
  });

  test('creates __sentinelCapturedRoots as WeakMap-like', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    expect(sandbox.window.__sentinelCapturedRoots).toBeDefined();
    expect(typeof sandbox.window.__sentinelCapturedRoots.set).toBe('function');
    expect(typeof sandbox.window.__sentinelCapturedRoots.get).toBe('function');
  });

  test('creates __sentinelShadowRoots as Set-like', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    expect(sandbox.window.__sentinelShadowRoots).toBeDefined();
    expect(typeof sandbox.window.__sentinelShadowRoots.add).toBe('function');
  });

  test('skips re-initialization on second load', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    const firstRoots = sandbox.window.__sentinelShadowRoots;
    loadModule(sandbox);
    // Should be the same object — not re-created
    expect(sandbox.window.__sentinelShadowRoots).toBe(firstRoots);
  });

  test('patches Element.prototype.attachShadow', () => {
    const sandbox = createSandbox();
    const original = sandbox.Element.prototype.attachShadow;
    loadModule(sandbox);
    expect(sandbox.Element.prototype.attachShadow).not.toBe(original);
  });

  test('patched attachShadow still returns a shadow root', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    const fakeElement = { name: 'div' };
    const root = sandbox.Element.prototype.attachShadow.call(fakeElement, { mode: 'open' });
    expect(root).toBeDefined();
    expect(root.mode).toBe('open');
  });

  test('patched attachShadow stores root in __sentinelCapturedRoots', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    const fakeElement = { name: 'div' };
    const root = sandbox.Element.prototype.attachShadow.call(fakeElement, { mode: 'open' });
    expect(sandbox.window.__sentinelCapturedRoots.get(fakeElement)).toBe(root);
  });

  test('patched attachShadow adds root to __sentinelShadowRoots', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    const fakeElement = { name: 'span' };
    const root = sandbox.Element.prototype.attachShadow.call(fakeElement, { mode: 'closed' });
    expect(sandbox.window.__sentinelShadowRoots.has(root)).toBe(true);
  });

  test('captures multiple shadow roots from different elements', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    const el1 = { name: 'div' };
    const el2 = { name: 'section' };
    const root1 = sandbox.Element.prototype.attachShadow.call(el1, { mode: 'open' });
    const root2 = sandbox.Element.prototype.attachShadow.call(el2, { mode: 'open' });
    expect(sandbox.window.__sentinelCapturedRoots.get(el1)).toBe(root1);
    expect(sandbox.window.__sentinelCapturedRoots.get(el2)).toBe(root2);
    expect(sandbox.window.__sentinelShadowRoots.has(root1)).toBe(true);
    expect(sandbox.window.__sentinelShadowRoots.has(root2)).toBe(true);
  });

  test('handles missing init gracefully', () => {
    const sandbox = createSandbox();
    loadModule(sandbox);
    const fakeElement = { name: 'div' };
    // Should not throw even if init is undefined
    const root = sandbox.Element.prototype.attachShadow.call(fakeElement);
    expect(root).toBeDefined();
    expect(sandbox.window.__sentinelCapturedRoots.get(fakeElement)).toBe(root);
  });
});
