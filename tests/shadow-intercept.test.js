// tests/shadow-intercept.test.js
// Tests for content/shadow-intercept.js — shadow DOM interception

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('shadow-intercept', () => {
  test('installs attachShadow patch and captures shadow roots', () => {
    // Create a sandbox that mimics the browser environment
    const sandbox = {
      window: {},
      console,
      Error,
      WeakMap: globalThis.WeakMap,
      Set: globalThis.Set,
      Element: class {
        constructor() {
          this._shadowRoot = null;
        }
        attachShadow(init) {
          // Original implementation would create a real shadow root
          this._shadowRoot = { mode: init.mode, host: this };
          return this._shadowRoot;
        }
      },
    };

    // Make window the global scope
    sandbox.window = sandbox;
    sandbox.window.__sentinelShadowIntercepted = false;

    // Load and execute the shadow-intercept module
    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../content/shadow-intercept.js'), 'utf8');
    const script = new vm.Script(source, { filename: 'shadow-intercept.js' });
    script.runInContext(sandbox);

    // Verify globals were set up
    expect(sandbox.window.__sentinelShadowIntercepted).toBe(true);
    expect(sandbox.window.__sentinelCapturedRoots).toBeInstanceOf(sandbox.WeakMap);
    expect(sandbox.window.__sentinelShadowRoots).toBeInstanceOf(sandbox.Set);

    // Create an element and attach a shadow root
    const el = new sandbox.Element();
    const sr = el.attachShadow({ mode: 'open' });

    // Verify the shadow root was captured
    expect(sandbox.window.__sentinelCapturedRoots.get(el)).toBe(sr);
    expect(sandbox.window.__sentinelShadowRoots.has(sr)).toBe(true);
  });

  test('does not install patch twice', () => {
    const sandbox = {
      window: {},
      console,
      Error,
      WeakMap: globalThis.WeakMap,
      Set: globalThis.Set,
      Element: class {
        constructor() { this._shadowRoot = null; }
        attachShadow(init) {
          this._shadowRoot = { mode: init.mode, host: this };
          return this._shadowRoot;
        }
      },
    };

    sandbox.window = sandbox;
    sandbox.window.__sentinelShadowIntercepted = false;

    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../content/shadow-intercept.js'), 'utf8');
    const script = new vm.Script(source, { filename: 'shadow-intercept.js' });

    // Run the script twice
    script.runInContext(sandbox);
    const firstIntercepted = sandbox.window.__sentinelShadowIntercepted;

    script.runInContext(sandbox);
    const secondIntercepted = sandbox.window.__sentinelShadowIntercepted;

    // Should still be true (not reset)
    expect(firstIntercepted).toBe(true);
    expect(secondIntercepted).toBe(true);
  });

  test('handles storage errors gracefully during attachShadow', () => {
    const sandbox = {
      window: {},
      console,
      Error,
      WeakMap: globalThis.WeakMap,
      Set: globalThis.Set,
      Element: class {
        constructor() { this._shadowRoot = null; }
        attachShadow(init) {
          this._shadowRoot = { mode: init.mode, host: this };
          return this._shadowRoot;
        }
      },
    };

    sandbox.window = sandbox;
    sandbox.window.__sentinelShadowIntercepted = false;

    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../content/shadow-intercept.js'), 'utf8');
    const script = new vm.Script(source, { filename: 'shadow-intercept.js' });
    script.runInContext(sandbox);

    // Make the WeakMap.set method throw
    const originalSet = sandbox.window.__sentinelCapturedRoots.set;
    sandbox.window.__sentinelCapturedRoots.set = function() {
      throw new Error('Storage error');
    };

    // Create an element and attach a shadow root
    const el = new sandbox.Element();
    // Should not throw - error is caught inside the patch
    expect(() => el.attachShadow({ mode: 'open' })).not.toThrow();

    // Shadow root should still be returned
    const sr = el._shadowRoot;
    expect(sr).toBeDefined();
    expect(sr.mode).toBe('open');

    // Restore original set method
    sandbox.window.__sentinelCapturedRoots.set = originalSet;
  });

  test('captures closed shadow roots', () => {
    const sandbox = {
      window: {},
      console,
      Error,
      WeakMap: globalThis.WeakMap,
      Set: globalThis.Set,
      Element: class {
        constructor() { this._shadowRoot = null; }
        attachShadow(init) {
          this._shadowRoot = { mode: init.mode, host: this };
          return this._shadowRoot;
        }
      },
    };

    sandbox.window = sandbox;
    sandbox.window.__sentinelShadowIntercepted = false;

    vm.createContext(sandbox);
    const source = readFileSync(join(__dirname, '../content/shadow-intercept.js'), 'utf8');
    const script = new vm.Script(source, { filename: 'shadow-intercept.js' });
    script.runInContext(sandbox);

    // Create an element with a closed shadow root
    const el = new sandbox.Element();
    const sr = el.attachShadow({ mode: 'closed' });

    // Verify the closed shadow root was captured
    expect(sandbox.window.__sentinelCapturedRoots.get(el)).toBe(sr);
    expect(sandbox.window.__sentinelShadowRoots.has(sr)).toBe(true);
  });
});
