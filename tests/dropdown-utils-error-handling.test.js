// tests/dropdown-utils-error-handling.test.js
// Tests for error handling paths in content/dropdown-utils.js — verifies
// graceful degradation when DOM operations throw (detached elements, etc.).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createSandbox(overrides = {}) {
  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    setTimeout: (fn, ms) => fn(),
    clearTimeout: () => {},
    KeyboardEvent: class KeyboardEvent { constructor(type, opts) { Object.assign(this, opts); } },
    MouseEvent: class MouseEvent { constructor(type, opts) { Object.assign(this, opts); } },
    Event: class Event { constructor(type, opts) { Object.assign(this, opts); } },
    InputEvent: class InputEvent { constructor(type, opts) { Object.assign(this, opts); } },
    Promise,
    ...overrides,
  };
  sandbox.window = sandbox;
  sandbox.window.__sentinelUtils = {
    dom: { isVisible: () => true },
    wait: { sleep: () => Promise.resolve() },
    shadow: { queryDeep: () => [] },
    dropdown: {},
  };
  return sandbox;
}

function loadModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../content/dropdown-utils.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'dropdown-utils.js' });
  script.runInContext(sandbox);
  return sandbox;
}

function getDd(sandbox) {
  return sandbox.window.__sentinelUtils.dropdown;
}

describe('dropdown-utils error handling', () => {
  describe('openDropdown', () => {
    test('handles scrollIntoView throwing', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      dd.findDropdownOptions = () => [{ innerText: 'Opt', textContent: 'Opt' }];
      const trigger = {
        scrollIntoView: () => { throw new Error('detached'); },
        dispatchEvent: () => {},
        click: () => {},
      };
      const result = await dd.openDropdown({ defaultView: {}, querySelectorAll: () => [], getElementById: () => null }, trigger);
      expect(result).toHaveLength(1);
    });

    test('handles dispatchEvent throwing during click sequence', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      dd.findDropdownOptions = () => [{ innerText: 'Opt', textContent: 'Opt' }];
      let dispatchCount = 0;
      const trigger = {
        scrollIntoView: () => {},
        dispatchEvent: () => {
          dispatchCount++;
          if (dispatchCount > 1) throw new Error('dispatch failed');
        },
        click: () => {},
      };
      const result = await dd.openDropdown({ defaultView: {}, querySelectorAll: () => [], getElementById: () => null }, trigger);
      // Should still return options despite dispatch failure
      expect(result).toHaveLength(1);
    });
  });

  describe('selectDropdownOption', () => {
    test('handles scrollIntoView throwing on matched element', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const opt = {
        innerText: 'Test', textContent: 'Test',
        scrollIntoView: () => { throw new Error('detached'); },
        dispatchEvent: () => {},
        click: () => {},
      };
      const result = await dd.selectDropdownOption({ defaultView: {} }, [opt], 'Test');
      expect(result).toBe(opt);
    });

    test('handles dispatchEvent throwing on matched element', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const opt = {
        innerText: 'Test', textContent: 'Test',
        scrollIntoView: () => {},
        dispatchEvent: () => { throw new Error('dispatch failed'); },
        click: () => {},
      };
      const result = await dd.selectDropdownOption({ defaultView: {} }, [opt], 'Test');
      // Should return the element even though dispatch/click sequence failed
      expect(result).toBe(opt);
    });
  });

  describe('traverseNestedMenu', () => {
    test('handles scrollIntoView throwing on final item', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const item = {
        innerText: 'Settings', textContent: 'Settings',
        scrollIntoView: () => { throw new Error('detached'); },
        dispatchEvent: () => {},
        click: () => {},
      };
      dd.findDropdownOptions = () => [item];
      const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings']);
      expect(result).toBe(item);
    });

    test('handles dispatchEvent throwing on hover', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const level1 = {
        innerText: 'Settings', textContent: 'Settings',
        scrollIntoView: () => {},
        dispatchEvent: () => { throw new Error('dispatch failed'); },
        click: () => {},
      };
      const level2 = {
        innerText: 'Network', textContent: 'Network',
        scrollIntoView: () => {},
        dispatchEvent: () => {},
        click: () => {},
      };
      let callCount = 0;
      dd.findDropdownOptions = () => {
        callCount++;
        return callCount <= 1 ? [level1] : [level2];
      };
      const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Network']);
      expect(result).toBe(level2);
    });

    test('handles click fallback dispatch throwing', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const level1 = {
        innerText: 'Settings', textContent: 'Settings',
        scrollIntoView: () => {},
        dispatchEvent: () => { throw new Error('dispatch failed'); },
        click: () => {},
      };
      let callCount = 0;
      dd.findDropdownOptions = () => {
        callCount++;
        // First call returns level1, subsequent calls return empty (no submenu)
        return callCount <= 1 ? [level1] : [];
      };
      const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Security']);
      expect(result).toBeNull();
    });
  });

  describe('dismissDropdown', () => {
    test('handles null doc gracefully', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      expect(dd.dismissDropdown(null)).toBe(false);
    });

    test('handles querySelectorAll throwing', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const doc = { querySelectorAll: () => { throw new Error('bad'); } };
      expect(dd.dismissDropdown(doc)).toBe(false);
    });

    test('handles activeElement dispatchEvent throwing', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const doc = {
        querySelectorAll: () => [],
        activeElement: { dispatchEvent: () => { throw new Error('dispatch failed'); } },
        body: { dispatchEvent: () => {} },
      };
      expect(dd.dismissDropdown(doc)).toBe(false);
    });

    test('handles doc with no body or activeElement', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const doc = {
        querySelectorAll: () => [],
      };
      expect(dd.dismissDropdown(doc)).toBe(false);
    });
  });

  describe('isCustomDropdown', () => {
    test('handles querySelectorAll throwing on parent', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const el = {
        tagName: 'DIV',
        _attrs: {},
        className: '',
        parentElement: { querySelectorAll: () => { throw new Error('detached'); } },
        getAttribute: () => null,
        querySelectorAll: () => [],
      };
      // Should return false without crashing
      expect(dd.isCustomDropdown(el)).toBe(false);
    });

    test('handles querySelectorAll throwing on element itself', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const el = {
        tagName: 'DIV',
        _attrs: {},
        className: '',
        parentElement: null,
        getAttribute: () => null,
        querySelectorAll: () => { throw new Error('detached'); },
      };
      expect(() => dd.isCustomDropdown(el)).not.toThrow();
    });
  });

  describe('_findSearchInput', () => {
    test('handles closest throwing on option', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));
      const opt = { closest: () => { throw new Error('detached'); } };
      const doc = { querySelectorAll: () => [] };
      expect(dd._findSearchInput(doc, [opt])).toBeNull();
    });
  });

  describe('findDropdownOptions - large list search strategy', () => {
    test('uses search input strategy when list has 50+ options and no initial match', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      // Create 60 options with names that won't match the search value
      const options = Array.from({ length: 60 }, (_, i) => ({
        innerText: `Option ${i}`,
        textContent: `Option ${i}`,
        parentElement: null,
      }));

      let focusCalled = false;
      let searchValue = '';

      const searchInput = {
        focus: () => { focusCalled = true; },
        get value() { return searchValue; },
        set value(v) { searchValue = v; },
        dispatchEvent: () => {},
        tagName: 'INPUT',
      };

      dd._findSearchInput = () => searchInput;

      // Mock findDropdownOptions to return the filtered options after search
      let callCount = 0;
      dd.findDropdownOptions = () => {
        callCount++;
        // First call returns the original 60 options, second call returns filtered results
        return callCount === 1 ? options : [{ innerText: 'Target Option', textContent: 'Target Option' }];
      };

      const doc = {
        querySelectorAll: () => [],
        defaultView: {
          HTMLInputElement: { prototype: { value: {} } },
          Object: { getPropertyDescriptor: () => ({ set: () => {} }) },
        },
      };

      // Test with a value that won't match the initial options
      const result = await dd.selectDropdownOption(doc, options, 'Target Option');
      expect(focusCalled).toBe(true);
      expect(result).toBeDefined();
    });

    test('handles search input native setter error gracefully', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      const options = Array.from({ length: 60 }, (_, i) => ({
        innerText: `Option ${i}`,
        textContent: `Option ${i}`,
        parentElement: null,
      }));

      const searchInput = {
        focus: () => {},
        value: '',
        dispatchEvent: () => {},
        tagName: 'INPUT',
      };

      dd._findSearchInput = () => searchInput;
      dd.findDropdownOptions = () => options;

      const doc = {
        querySelectorAll: () => [],
        defaultView: {
          HTMLInputElement: { prototype: { value: {} } },
          Object: { getPropertyDescriptor: () => null }, // No descriptor
        },
      };

      const result = await dd.selectDropdownOption(doc, options, 'Option 25');
      expect(result).toBeDefined();
    });
  });

  describe('traverseNestedMenu - submenu hover and fallback', () => {
    test('uses hover strategy when not at final level', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      const level1 = {
        innerText: 'Settings',
        textContent: 'Settings',
        scrollIntoView: () => {},
        dispatchEvent: () => {},
      };

      const level2 = {
        innerText: 'Network',
        textContent: 'Network',
        scrollIntoView: () => {},
        dispatchEvent: () => {},
        click: () => {},
      };

      let callCount = 0;
      dd.findDropdownOptions = () => {
        callCount++;
        return callCount === 1 ? [level1] : [level2];
      };

      const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Network']);
      expect(result).toBe(level2);
    });

    test('falls back to click when hover does not reveal submenu', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      const level1 = {
        innerText: 'Settings',
        textContent: 'Settings',
        scrollIntoView: () => {},
        dispatchEvent: () => {},
        click: () => {},
      };

      let callCount = 0;
      dd.findDropdownOptions = () => {
        callCount++;
        // Always return level1, simulating no submenu appearing
        return [level1];
      };

      const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Network']);
      expect(result).toBeNull(); // Should return null when submenu never appears
    });

    test('handles scrollIntoView error during hover', async () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      const level1 = {
        innerText: 'Settings',
        textContent: 'Settings',
        scrollIntoView: () => { throw new Error('detached'); },
        dispatchEvent: () => {},
        click: () => {},
      };

      const level2 = {
        innerText: 'Network',
        textContent: 'Network',
        scrollIntoView: () => {},
        dispatchEvent: () => {},
        click: () => {},
      };

      let callCount = 0;
      dd.findDropdownOptions = () => {
        callCount++;
        return callCount === 1 ? [level1] : [level2];
      };

      const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Network']);
      expect(result).toBe(level2);
    });
  });

  describe('isCustomDropdown - edge cases', () => {
    test('handles SVG className baseVal access error', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      // Create an object that throws when accessing baseVal
      const classNameProxy = new Proxy({}, {
        get: (target, prop) => {
          if (prop === 'baseVal') {
            throw new Error('SVG error');
          }
          return undefined;
        },
      });

      const el = {
        tagName: 'svg',
        className: classNameProxy,
        parentElement: null,
        getAttribute: () => null,
        querySelectorAll: () => [],
      };

      expect(() => dd.isCustomDropdown(el)).not.toThrow();
      expect(dd.isCustomDropdown(el)).toBe(false);
    });

    test('returns false for element without dropdown indicators', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      const el = {
        tagName: 'DIV',
        className: 'regular-element',
        parentElement: null,
        getAttribute: () => null,
        querySelectorAll: () => [],
      };

      expect(dd.isCustomDropdown(el)).toBe(false);
    });
  });

  describe('findDropdownOptions - parent container climb', () => {
    test('handles error during parent container climb', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      const trigger = {
        parentElement: {
          querySelectorAll: () => [],
          parentElement: {
            querySelectorAll: () => { throw new Error('climb error'); },
            parentElement: null,
          },
        },
      };

      const doc = {
        querySelectorAll: () => [],
      };

      expect(() => dd.findDropdownOptions(doc, trigger)).not.toThrow();
    });

    test('limits parent container climb depth', () => {
      const sandbox = createSandbox();
      const dd = getDd(loadModule(sandbox));

      // Create a deep chain
      let current = { querySelectorAll: () => [] };
      for (let i = 0; i < 20; i++) {
        current = { querySelectorAll: () => [], parentElement: current };
      }

      const trigger = { parentElement: current };
      const doc = { querySelectorAll: () => [] };

      const result = dd.findDropdownOptions(doc, trigger);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
