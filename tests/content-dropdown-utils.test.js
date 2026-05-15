// tests/content-dropdown-utils.test.js
// Unit tests for content/dropdown-utils.js — isCustomDropdown (pure heuristic).
// Uses VM sandbox with mocked DOM utilities.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createSandbox() {
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
  };
  sandbox.window = sandbox;
  sandbox.window.__sentinelUtils = {
    dom: {
      isVisible: () => true,
    },
    wait: {
      sleep: () => Promise.resolve(),
    },
    shadow: {
      queryDeep: () => [],
    },
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

function mockElement(attrs) {
  const el = {
    tagName: (attrs.tagName || 'DIV').toUpperCase(),
    _attrs: attrs.attrs || {},
    className: attrs.className || '',
    parentElement: attrs.parentElement || null,
    getAttribute(name) { return this._attrs[name] || null; },
    querySelectorAll(sel) { return attrs.querySelectorAllResult || []; },
  };
  if (attrs.parentElement) {
    attrs.parentElement.querySelectorAll = (sel) => attrs.parentQuerySelectorAllResult || [];
  }
  return el;
}

describe('isCustomDropdown', () => {
  let dd;
  beforeAll(() => { dd = getDd(loadModule(createSandbox())); });

  test('returns false for null', () => {
    expect(dd.isCustomDropdown(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(dd.isCustomDropdown(undefined)).toBe(false);
  });

  test('returns false for native SELECT element', () => {
    const el = mockElement({ tagName: 'SELECT' });
    expect(dd.isCustomDropdown(el)).toBe(false);
  });

  test('returns true for ARIA combobox role', () => {
    const el = mockElement({ tagName: 'DIV', attrs: { role: 'combobox' } });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns true for button role with aria-haspopup', () => {
    const el = mockElement({ tagName: 'DIV', attrs: { role: 'button', 'aria-haspopup': 'true' } });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns true for aria-haspopup="listbox"', () => {
    const el = mockElement({ tagName: 'DIV', attrs: { 'aria-haspopup': 'listbox' } });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns true for aria-haspopup="menu"', () => {
    const el = mockElement({ tagName: 'DIV', attrs: { 'aria-haspopup': 'menu' } });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns true for className containing "dropdown"', () => {
    const el = mockElement({ tagName: 'DIV', className: 'my-dropdown-trigger' });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns true for className containing "combobox"', () => {
    const el = mockElement({ tagName: 'DIV', className: 'custom-combobox-input' });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns true for className containing "select"', () => {
    const el = mockElement({ tagName: 'DIV', className: 'ui-select-trigger' });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns true for className containing "picker"', () => {
    const el = mockElement({ tagName: 'DIV', className: 'date-picker' });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns false for plain DIV without dropdown indicators', () => {
    const el = mockElement({ tagName: 'DIV', className: 'container' });
    expect(dd.isCustomDropdown(el)).toBe(false);
  });

  test('returns true when parent sibling has listbox role', () => {
    const parent = {};
    const el = mockElement({
      tagName: 'DIV',
      parentElement: parent,
      parentQuerySelectorAllResult: [{ tagName: 'DIV' }],
    });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns true when child has dropdown-menu class', () => {
    const parent = { querySelectorAll: () => [] };
    const el = mockElement({
      tagName: 'DIV',
      parentElement: parent,
      parentQuerySelectorAllResult: [],
      querySelectorAllResult: [{ tagName: 'DIV' }],
    });
    expect(dd.isCustomDropdown(el)).toBe(true);
  });

  test('returns false when no parent', () => {
    const el = mockElement({ tagName: 'DIV', className: 'button' });
    el.parentElement = null;
    expect(dd.isCustomDropdown(el)).toBe(false);
  });
});

describe('findDropdownOptions', () => {
  let dd;
  beforeAll(() => { dd = getDd(loadModule(createSandbox())); });

  test('returns empty array when no options found', () => {
    const doc = { querySelectorAll: () => [], getElementById: () => null };
    const result = dd.findDropdownOptions(doc, null);
    expect(result).toEqual([]);
  });

  test('finds options by aria-controls reference', () => {
    const optionEl = { tagName: 'DIV', _visible: true, getAttribute: () => null, innerText: 'Option 1' };
    const listbox = {
      querySelectorAll: () => [optionEl],
      getAttribute: () => null,
    };
    const doc = {
      querySelectorAll: () => [],
      getElementById: (id) => id === 'my-listbox' ? listbox : null,
    };
    const trigger = {
      getAttribute: (attr) => attr === 'aria-controls' ? 'my-listbox' : null,
    };
    const result = dd.findDropdownOptions(doc, trigger);
    expect(result).toHaveLength(1);
  });

  test('finds options doc-wide when no scoped results', () => {
    const optionEl = { tagName: 'DIV', _visible: true, getAttribute: () => null, innerText: 'Opt' };
    const doc = {
      querySelectorAll: (sel) => {
        if (sel.includes('[role="option"]')) return [optionEl];
        return [];
      },
      getElementById: () => null,
    };
    const result = dd.findDropdownOptions(doc, null);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('handles null trigger element', () => {
    const doc = { querySelectorAll: () => [], getElementById: () => null };
    const result = dd.findDropdownOptions(doc, null);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('dismissDropdown', () => {
  let dd;
  beforeAll(() => { dd = getDd(loadModule(createSandbox())); });

  test('returns false when no dropdowns are open', () => {
    const doc = {
      querySelectorAll: () => [],
      activeElement: null,
      body: { dispatchEvent: () => {} },
    };
    expect(dd.dismissDropdown(doc)).toBe(false);
  });

  test('returns true when dropdown is open', () => {
    const visibleDropdown = { _visible: true };
    const doc = {
      querySelectorAll: () => [visibleDropdown],
      activeElement: { dispatchEvent: () => {} },
      body: { dispatchEvent: () => {} },
    };
    expect(dd.dismissDropdown(doc)).toBe(true);
  });

  test('uses document.body when no activeElement', () => {
    const doc = {
      querySelectorAll: () => [],
      body: { dispatchEvent: () => {} },
    };
    expect(dd.dismissDropdown(doc)).toBe(false);
  });
});
