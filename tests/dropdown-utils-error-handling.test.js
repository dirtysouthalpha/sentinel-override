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
});
