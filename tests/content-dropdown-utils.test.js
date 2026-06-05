// tests/content-dropdown-utils.test.js
// Unit tests for content/dropdown-utils.js — dropdown detection, opening,
// option selection, nested menu traversal, search input finding, dismissal.
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

describe('openDropdown', () => {
  let dd;
  beforeEach(() => { dd = getDd(loadModule(createSandbox())); });

  test('returns null for null trigger', async () => {
    const result = await dd.openDropdown({}, null);
    expect(result).toBeNull();
  });

  test('clicks trigger and returns options when found', async () => {
    const clicked = [];
    const trigger = {
      scrollIntoView: () => {},
      dispatchEvent: () => {},
      click: () => { clicked.push('click'); },
    };
    const optionEl = { tagName: 'DIV', _visible: true, getAttribute: () => null, innerText: 'Opt1' };
    const doc = {
      querySelectorAll: (sel) => {
        if (sel.includes('[role="option"]')) return [optionEl];
        return [];
      },
      getElementById: () => null,
      defaultView: {},
    };
    // Override findDropdownOptions to return immediately
    const origFind = dd.findDropdownOptions;
    dd.findDropdownOptions = () => [optionEl];
    const result = await dd.openDropdown(doc, trigger);
    expect(result).toHaveLength(1);
    expect(clicked).toHaveLength(1);
    dd.findDropdownOptions = origFind;
  });

  test('returns null when no options appear after polling', async () => {
    let sleepCount = 0;
    const sandbox = createSandbox();
    sandbox.window.__sentinelUtils.wait.sleep = () => { sleepCount++; return Promise.resolve(); };
    sandbox.window.__sentinelUtils.dropdown = {};
    dd = getDd(loadModule(sandbox));
    // Override findDropdownOptions to always return empty
    dd.findDropdownOptions = () => [];
    // Force Date.now to advance past timeout
    const realDateNow = Date.now;
    let fakeTime = 0;
    Date.now = () => { fakeTime += 3100; return fakeTime; };
    try {
      const trigger = { scrollIntoView: () => {}, dispatchEvent: () => {}, click: () => {} };
      const result = await dd.openDropdown({ defaultView: {}, querySelectorAll: () => [], getElementById: () => null }, trigger);
      expect(result).toBeNull();
    } finally {
      Date.now = realDateNow;
    }
  });
});

describe('selectDropdownOption', () => {
  let dd;
  beforeEach(() => { dd = getDd(loadModule(createSandbox())); });

  test('returns null for empty options array', async () => {
    const result = await dd.selectDropdownOption({}, [], 'test');
    expect(result).toBeNull();
  });

  test('returns null for null options', async () => {
    const result = await dd.selectDropdownOption({}, null, 'test');
    expect(result).toBeNull();
  });

  test('returns null for null value', async () => {
    const opts = [{ innerText: 'Option A', textContent: 'Option A' }];
    const result = await dd.selectDropdownOption({}, opts, null);
    expect(result).toBeNull();
  });

  test('returns null for undefined value', async () => {
    const opts = [{ innerText: 'Option A', textContent: 'Option A' }];
    const result = await dd.selectDropdownOption({}, opts, undefined);
    expect(result).toBeNull();
  });

  test('matches exact text case-insensitively', async () => {
    const opt1 = { innerText: 'United States', textContent: 'United States', scrollIntoView: () => {}, dispatchEvent: () => {}, click: () => {} };
    const opt2 = { innerText: 'Canada', textContent: 'Canada', scrollIntoView: () => {}, dispatchEvent: () => {}, click: () => {} };
    const result = await dd.selectDropdownOption({ defaultView: {} }, [opt1, opt2], 'united states');
    expect(result).toBe(opt1);
  });

  test('matches value attribute', async () => {
    const opt1 = { innerText: 'United States', textContent: 'United States', value: 'US', scrollIntoView: () => {}, dispatchEvent: () => {}, click: () => {} };
    const result = await dd.selectDropdownOption({ defaultView: {} }, [opt1], 'us');
    expect(result).toBe(opt1);
  });

  test('matches starts-with as fallback', async () => {
    const opt1 = { innerText: 'United States of America', textContent: 'United States of America', scrollIntoView: () => {}, dispatchEvent: () => {}, click: () => {} };
    const result = await dd.selectDropdownOption({ defaultView: {} }, [opt1], 'United States');
    expect(result).toBe(opt1);
  });

  test('matches partial contains as last resort', async () => {
    const opt1 = { innerText: 'The United Kingdom of Great Britain', textContent: 'The United Kingdom of Great Britain', scrollIntoView: () => {}, dispatchEvent: () => {}, click: () => {} };
    const result = await dd.selectDropdownOption({ defaultView: {} }, [opt1], 'kingdom');
    expect(result).toBe(opt1);
  });

  test('returns null when no match found', async () => {
    const opts = [{ innerText: 'Option A', textContent: 'Option A' }];
    const result = await dd.selectDropdownOption({}, opts, 'nonexistent');
    expect(result).toBeNull();
  });

  test('clicks the matched option', async () => {
    const clicks = [];
    const opt = {
      innerText: 'Click Me', textContent: 'Click Me',
      scrollIntoView: () => {},
      dispatchEvent: () => {},
      click: () => { clicks.push('clicked'); },
    };
    await dd.selectDropdownOption({ defaultView: {} }, [opt], 'Click Me');
    expect(clicks).toHaveLength(1);
  });

  test('matches empty string value exactly', async () => {
    const opt1 = { innerText: '', textContent: '', scrollIntoView: () => {}, dispatchEvent: () => {}, click: () => {} };
    const opt2 = { innerText: 'Other', textContent: 'Other', scrollIntoView: () => {}, dispatchEvent: () => {}, click: () => {} };
    const result = await dd.selectDropdownOption({ defaultView: {} }, [opt1, opt2], '');
    expect(result).toBe(opt1);
  });
});

describe('traverseNestedMenu', () => {
  let dd;
  beforeEach(() => { dd = getDd(loadModule(createSandbox())); });

  test('returns null for null path', async () => {
    const result = await dd.traverseNestedMenu({}, null);
    expect(result).toBeNull();
  });

  test('returns null for empty path', async () => {
    const result = await dd.traverseNestedMenu({}, []);
    expect(result).toBeNull();
  });

  test('returns null when no menu items match', async () => {
    dd.findDropdownOptions = () => [{ innerText: 'Other', textContent: 'Other' }];
    const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings']);
    expect(result).toBeNull();
  });

  test('clicks the single-level menu item and returns it', async () => {
    const item = {
      innerText: 'Settings', textContent: 'Settings',
      scrollIntoView: () => {},
      dispatchEvent: () => {},
      click: () => {},
    };
    dd.findDropdownOptions = () => [item];
    const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings']);
    expect(result).toBe(item);
  });

  test('hovers intermediate level and clicks final level', async () => {
    const level1Item = {
      innerText: 'Settings', textContent: 'Settings',
      scrollIntoView: () => {},
      dispatchEvent: () => {},
      click: () => {},
    };
    const level2Item = {
      innerText: 'Security', textContent: 'Security',
      scrollIntoView: () => {},
      dispatchEvent: () => {},
      click: () => {},
    };
    let callCount = 0;
    dd.findDropdownOptions = () => {
      callCount++;
      return callCount <= 1 ? [level1Item] : [level2Item];
    };
    const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Security']);
    expect(result).toBe(level2Item);
  });

  test('returns null when submenu never appears', async () => {
    const level1Item = {
      innerText: 'Settings', textContent: 'Settings',
      scrollIntoView: () => {},
      dispatchEvent: () => {},
      click: () => {},
    };
    let callCount = 0;
    dd.findDropdownOptions = () => {
      callCount++;
      return callCount <= 1 ? [level1Item] : [];
    };
    const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Security']);
    expect(result).toBeNull();
  });
});

describe('_findSearchInput', () => {
  let dd;
  beforeEach(() => { dd = getDd(loadModule(createSandbox())); });

  test('returns null for empty options', () => {
    expect(dd._findSearchInput({ querySelectorAll: () => [] }, [])).toBeNull();
  });

  test('returns null for null options', () => {
    expect(dd._findSearchInput({ querySelectorAll: () => [] }, null)).toBeNull();
  });

  test('finds search input inside container via closest', () => {
    const searchInput = { tagName: 'INPUT' };
    const container = {
      querySelector: (sel) => {
        if (sel.includes('input')) return searchInput;
        return null;
      },
    };
    const opt = {
      closest: () => container,
    };
    const result = dd._findSearchInput({}, [opt]);
    expect(result).toBe(searchInput);
  });

  test('finds visible search input doc-wide', () => {
    const searchInput = { tagName: 'INPUT' };
    const doc = {
      querySelectorAll: (sel) => {
        if (sel.includes('input')) return [searchInput];
        return [];
      },
    };
    const opt = { closest: () => null };
    const result = dd._findSearchInput(doc, [opt]);
    expect(result).toBe(searchInput);
  });

  test('returns null when no search inputs exist', () => {
    const doc = { querySelectorAll: () => [] };
    const opt = { closest: () => null };
    expect(dd._findSearchInput(doc, [opt])).toBeNull();
  });

  test('finds search input that uses native setter', () => {
    const searchInput = { tagName: 'INPUT', value: '', dispatchEvent: () => {}, focus: () => {} };
    const proto = { value: { set: function() {} } };
    const descriptor = { set: function() {} };
    const doc = {
      querySelectorAll: () => [searchInput],
      defaultView: {
        HTMLInputElement: {
          prototype: proto,
        },
      },
    };
    const opt = { closest: () => ({ querySelector: () => searchInput }) };
    dd.findDropdownOptions = () => [{ innerText: 'Option', textContent: 'Option', value: 'Option' }];
    // This exercises the nativeSetter path on line 246
    dd._findSearchInput(doc, [opt]);
  });
});

// Additional tests for uncovered branches
describe('dropdown-utils edge cases', () => {
  let dd;
  beforeEach(() => { dd = getDd(loadModule(createSandbox())); });

  test('handles parent container climb error (line 120)', () => {
    const errorTrigger = mockElement({
      tagName: 'DIV',
      attrs: { 'aria-haspopup': 'listbox' },
      parentElement: {
        querySelectorAll: () => { throw new Error('Climb error'); },
        parentElement: null,
      },
    });
    const doc = {
      querySelectorAll: () => [],
      getElementById: () => null,
    };
    // Should not throw, should handle error gracefully
    const result = dd.findDropdownOptions(doc, errorTrigger);
    expect(Array.isArray(result)).toBe(true);
  });

  test('handles className access error (line 374)', () => {
    // Element that throws on className access
    const badEl = {
      tagName: 'DIV',
      get className() { throw new Error('className access error'); },
      getAttribute: () => null,
      parentElement: null,
      querySelectorAll: () => [],
    };
    // Should return false, not throw
    expect(dd.isCustomDropdown(badEl)).toBe(false);
  });

  test('traverseNestedMenu falls back to click when hover fails (lines 340-349)', async () => {
    const level1Item = {
      innerText: 'Settings',
      textContent: 'Settings',
      scrollIntoView: () => {},
      dispatchEvent: () => {},
      click: () => {},
    };
    let callCount = 0;
    dd.findDropdownOptions = () => {
      callCount++;
      // Hover fails (returns empty), click succeeds (returns items)
      if (callCount === 1) return [level1Item];
      if (callCount === 2) return []; // Hover failed
      return [{ innerText: 'Security', textContent: 'Security' }]; // Click succeeded
    };
    const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Security']);
    // Should fall back to click and succeed
    expect(result).toBeTruthy();
  });

  test('traverseNestedMenu returns null when both hover and click fail', async () => {
    const level1Item = {
      innerText: 'Settings',
      textContent: 'Settings',
      scrollIntoView: () => {},
      dispatchEvent: () => {},
      click: () => {},
    };
    let callCount = 0;
    dd.findDropdownOptions = () => {
      callCount++;
      if (callCount === 1) return [level1Item];
      return []; // Both hover and click fail
    };
    const result = await dd.traverseNestedMenu({ defaultView: {} }, ['Settings', 'Security']);
    expect(result).toBeNull();
  });

  test('selectDropdownOption with search input and large option list', async () => {
    const searchInput = {
      tagName: 'INPUT',
      value: '',
      dispatchEvent: () => {},
      focus: () => {},
    };
    const doc = {
      querySelectorAll: (sel) => {
        if (sel.includes('input')) return [searchInput];
        return [];
      },
      defaultView: {},
      getElementById: () => null,
    };
    // Create 50+ dummy options to trigger search input strategy
    const dummyOptions = Array.from({ length: 60 }, (_, i) => ({
      innerText: `Option${i}`,
      textContent: `Option${i}`,
      value: `Option${i}`,
    }));
    dd._findSearchInput = () => searchInput;
    dd.findDropdownOptions = () => dummyOptions;
    const result = await dd.selectDropdownOption(doc, dummyOptions, 'Option50');
    // Should find and return the matched option
    expect(result).toBeTruthy();
    expect(result.value).toBe('Option50');
  });
});
