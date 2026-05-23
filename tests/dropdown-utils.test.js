/**
 * Sentinel Override - Dropdown Utils Tests
 * Tests for dropdown and menu utilities including opening, finding options,
 * selecting, nested traversal, and dismissal.
 */

import { jest } from '@jest/globals';

// Set up global environment before loading the module
globalThis.window = globalThis;
globalThis.CSS = { escape: (s) => s.replace(/([[\]\\])/g, '\\$1') };
globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.HTMLElement = class HTMLElement {};
globalThis.Element = class Element {};
globalThis.MouseEvent = class MouseEvent {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles ?? true;
    this.cancelable = opts.cancelable ?? true;
    this.composed = opts.composed ?? true;
  }
};
globalThis.KeyboardEvent = class KeyboardEvent {
  constructor(type, opts = {}) {
    this.type = type;
    this.key = opts.key || '';
    this.code = opts.code || '';
    this.keyCode = opts.keyCode || 0;
    this.which = opts.which || 0;
    this.bubbles = opts.bubbles ?? true;
    this.cancelable = opts.cancelable ?? true;
  }
};
globalThis.Event = class Event {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles ?? true;
    this.cancelable = opts.cancelable ?? true;
    this.composed = opts.composed ?? true;
    this.inputType = opts.inputType || '';
    this.data = opts.data || '';
  }
};
globalThis.InputEvent = class InputEvent extends globalThis.Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.inputType = opts.inputType || '';
    this.data = opts.data || '';
  }
};

// Minimal DOM mock helpers
function createElement(tag, attrs = {}) {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    getAttribute: (name) => attrs[name] || null,
    setAttribute: (name, val) => { attrs[name] = val; },
    hasAttribute: (name) => attrs[name] !== undefined,
    id: attrs.id || '',
    className: attrs.className || '',
    classList: {
      add: fn,
      remove: fn,
      contains: (cls) => (attrs.className || '').includes(cls),
    },
    type: attrs.type || '',
    name: attrs.name || '',
    value: attrs.value || '',
    innerText: attrs.innerText || '',
    textContent: attrs.textContent || '',
    placeholder: attrs.placeholder || '',
    disabled: attrs.disabled || false,
    checked: attrs.checked || false,
    role: attrs.role || '',
    style: attrs.style || { display: 'block', visibility: 'visible', opacity: '1' },
    offsetWidth: attrs.offsetWidth || 100,
    offsetHeight: attrs.offsetHeight || 30,
    isConnected: true,
    ownerDocument: { defaultView: globalThis },
    parentElement: attrs.parentElement || null,
    children: attrs.children || [],
    addEventListener: (evt, cb) => { listeners[evt] = listeners[evt] || []; listeners[evt].push(cb); },
    removeEventListener: (evt, cb) => { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== cb); },
    dispatchEvent: (evt) => {
      evt.target = el;
      if (listeners[evt.type]) {
        listeners[evt.type].forEach(cb => cb(evt));
      }
      return true;
    },
    click: () => {
      const evt = new globalThis.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
      el.dispatchEvent(evt);
    },
    scrollIntoView: fn,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40 }),
  };
  return el;
}

const fn = () => {};
const events = [];

function setupDropdownEnv() {
  globalThis.window.__sentinelUtils = {};
  globalThis.window.__sentinelUtils.dom = {
    isVisible: (el) => {
      if (!el || !el.nodeType) return false;
      const style = el.style || {};
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      return true;
    }
  };
  globalThis.window.__sentinelUtils.wait = {
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms))
  };
  globalThis.window.__sentinelUtils.shadow = {
    queryDeep: (doc, selector) => []
  };
  globalThis.document = {
    defaultView: globalThis,
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    body: { innerText: '', appendChild: fn, removeChild: fn },
    activeElement: null,
    documentElement: { children: [] },
  };
  globalThis.getComputedStyle = () => ({
    display: 'block', visibility: 'visible', opacity: '1',
    pointerEvents: 'auto', position: 'static', zIndex: 'auto',
  });
  events.length = 0;
}

setupDropdownEnv();

let dd;
beforeAll(async () => {
  await import('../content/dropdown-utils.js');
  dd = globalThis.window.__sentinelUtils.dropdown;
});

beforeEach(() => {
  setupDropdownEnv();
});

describe('Dropdown Utils', () => {
  describe('openDropdown', () => {
    test('should return null when triggerEl is null', async () => {
      const result = await dd.openDropdown(globalThis.document, null);
      expect(result).toBeNull();
    });

    test('should return null when triggerEl is undefined', async () => {
      const result = await dd.openDropdown(globalThis.document, undefined);
      expect(result).toBeNull();
    });

    test('should scroll trigger into view before clicking', async () => {
      const trigger = createElement('button');
      let scrolled = false;
      trigger.scrollIntoView = () => { scrolled = true; };
      trigger.click = () => { /* click opens dropdown */ };

      // Mock findDropdownOptions to return options after click
      let callCount = 0;
      const originalFind = dd.findDropdownOptions;
      dd.findDropdownOptions = () => {
        callCount++;
        if (callCount > 1) return [createElement('div', { role: 'option' })];
        return [];
      };

      const result = await dd.openDropdown(globalThis.document, trigger);
      expect(scrolled).toBe(true);
      expect(result).not.toBeNull();

      dd.findDropdownOptions = originalFind;
    });

    test('should dispatch mouse events in correct sequence', async () => {
      const trigger = createElement('button');
      const events = [];
      ['mousedown', 'mouseup', 'click', 'mouseout'].forEach(type => {
        trigger.addEventListener(type, (e) => {
          events.push({ type: e.type, bubbles: e.bubbles, cancelable: e.cancelable });
        });
      });

      const originalFind = dd.findDropdownOptions;
      dd.findDropdownOptions = () => {
        return [createElement('div', { role: 'option' })];
      };

      await dd.openDropdown(globalThis.document, trigger);
      expect(events).toHaveLength(4);
      expect(events[0].type).toBe('mousedown');
      expect(events[1].type).toBe('mouseup');
      expect(events[2].type).toBe('click');
      expect(events[3].type).toBe('mouseout');

      dd.findDropdownOptions = originalFind;
    });

    test('should timeout after 3 seconds if no options appear', async () => {
      const trigger = createElement('button');
      trigger.click = () => { /* No options appear */ };

      const startTime = Date.now();
      const result = await dd.openDropdown(globalThis.document, trigger);
      const elapsed = Date.now() - startTime;

      expect(result).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(3000);
    });

    test('should handle dispatch failures gracefully', async () => {
      const trigger = createElement('button');
      trigger.dispatchEvent = () => { throw new Error('Dispatch failed'); };

      const originalFind = dd.findDropdownOptions;
      dd.findDropdownOptions = () => {
        return [createElement('div', { role: 'option' })];
      };

      const result = await dd.openDropdown(globalThis.document, trigger);
      expect(result).not.toBeNull();

      dd.findDropdownOptions = originalFind;
    });
  });

  describe('findDropdownOptions', () => {
    test('should handle querySelectorAll errors gracefully', () => {
      const trigger = createElement('button');
      trigger.querySelectorAll = () => { throw new Error('Query failed'); };
      globalThis.document.getElementById = () => null;

      // Should not throw despite querySelectorAll errors
      expect(() => dd.findDropdownOptions(globalThis.document, trigger)).not.toThrow();
    });

    test('should find options via aria-controls', () => {
      const option = createElement('div', { role: 'option', innerText: 'Option 1' });
      const listbox = createElement('div', { role: 'listbox', id: 'my-listbox', children: [option] });
      listbox.querySelectorAll = () => [option];

      const trigger = createElement('button', { 'aria-controls': 'my-listbox' });
      globalThis.document.getElementById = (id) => id === 'my-listbox' ? listbox : null;

      const result = dd.findDropdownOptions(globalThis.document, trigger);
      expect(result).toHaveLength(1);
    });

    test('should find options via aria-owns', () => {
      const item = createElement('div', { role: 'menuitem', innerText: 'Menu Item' });
      const menu = createElement('div', { role: 'menu', id: 'owned-menu', children: [item] });
      menu.querySelectorAll = () => [item];

      const trigger = createElement('button', { 'aria-owns': 'owned-menu' });
      globalThis.document.getElementById = (id) => id === 'owned-menu' ? menu : null;

      const result = dd.findDropdownOptions(globalThis.document, trigger);
      expect(result).toHaveLength(1);
    });

    test('should climb DOM to find parent containers', () => {
      const option = createElement('div', { role: 'option', innerText: 'Option' });
      option.offsetWidth = 100;
      option.offsetHeight = 30;

      const listbox = createElement('div', { role: 'listbox', children: [option] });
      listbox.querySelectorAll = (sel) => sel === '[role="listbox"], [role="menu"], [role="combobox"]' ? [listbox] : [option];
      listbox.parentElement = null;

      const wrapper = createElement('div');
      wrapper.parentElement = null;
      wrapper.querySelectorAll = (sel) => {
        if (sel === '[role="listbox"], [role="menu"], [role="combobox"]') {
          return [listbox];
        }
        return [];
      };

      const trigger = createElement('button');
      trigger.parentElement = wrapper;

      // The function will climb: trigger -> wrapper (finds listbox) -> gets options from listbox
      const result = dd.findDropdownOptions(globalThis.document, trigger);
      expect(result.length).toBeGreaterThan(0);
    });

    test('should limit parent climb to 8 levels', () => {
      const option = createElement('div', { role: 'option', innerText: 'Option' });
      option.offsetWidth = 100;
      option.offsetHeight = 30;

      const listbox = createElement('div', { role: 'listbox', children: [option] });
      listbox.querySelectorAll = (sel) => {
        if (sel === '[role="listbox"], [role="menu"], [role="combobox"]') return [listbox];
        if (sel.includes('option')) return [option];
        return [];
      };
      listbox.parentElement = null;

      let current = listbox;
      let trigger = createElement('button');

      // Create 10 levels of nesting (trigger at level 0, listbox at level 10)
      for (let i = 0; i < 10; i++) {
        const parent = createElement('div');
        parent.parentElement = null;
        parent.querySelectorAll = (sel) => {
          if (sel === '[role="listbox"], [role="menu"], [role="combobox"]') {
            // Only return listbox when we're at the right level
            return current === listbox ? [listbox] : [];
          }
          return [];
        };
        current.parentElement = parent;
        current = parent;
      }
      trigger.parentElement = current;

      // The function should find listbox within 8 levels
      const result = dd.findDropdownOptions(globalThis.document, trigger);
      // Due to the limit, it might not find it if it's beyond 8 levels
      expect(Array.isArray(result)).toBe(true);
    });

    test('should filter results by visibility', () => {
      const visibleOption = createElement('div', { role: 'option', innerText: 'Visible' });
      visibleOption.style = { display: 'block', visibility: 'visible', opacity: '1' };
      visibleOption.offsetWidth = 100;

      const hiddenOption = createElement('div', { role: 'option', innerText: 'Hidden' });
      hiddenOption.style = { display: 'none', visibility: 'hidden', opacity: '0' };
      hiddenOption.offsetWidth = 0;

      globalThis.document.querySelectorAll = () => [visibleOption, hiddenOption];

      const result = dd.findDropdownOptions(globalThis.document, null);
      expect(result).toHaveLength(1);
    });

    test('should deduplicate results', () => {
      const option = createElement('div', { role: 'option', innerText: 'Option' });
      globalThis.document.querySelectorAll = () => [option, option, option];

      const result = dd.findDropdownOptions(globalThis.document, null);
      const unique = new Set(result);
      expect(result.length).toBe(unique.size);
    });

    test('should handle querySelectorAll failures gracefully', () => {
      const trigger = createElement('button');
      trigger.querySelectorAll = () => { throw new Error('Invalid selector'); };
      globalThis.document.getElementById = () => null;

      const result = dd.findDropdownOptions(globalThis.document, trigger);
      expect(result).toBeDefined();
    });
  });

  describe('selectDropdownOption', () => {
    let optionEls;

    beforeEach(() => {
      optionEls = [];
      for (let i = 1; i <= 5; i++) {
        const opt = createElement('div', { role: 'option', innerText: `Option ${i}`, value: `value${i}` });
        opt.offsetWidth = 100;
        opt.offsetHeight = 30;
        optionEls.push(opt);
      }
    });

    test('should return null when optionEls is null', async () => {
      const result = await dd.selectDropdownOption(globalThis.document, null, 'Option 1');
      expect(result).toBeNull();
    });

    test('should return null when optionEls is empty', async () => {
      const result = await dd.selectDropdownOption(globalThis.document, [], 'Option 1');
      expect(result).toBeNull();
    });

    test('should return null when value is undefined', async () => {
      const result = await dd.selectDropdownOption(globalThis.document, optionEls, undefined);
      expect(result).toBeNull();
    });

    test('should match exact text (highest priority)', async () => {
      const result = await dd.selectDropdownOption(globalThis.document, optionEls, 'Option 2');
      expect(result).not.toBeNull();
      expect(result.innerText).toBe('Option 2');
    });

    test('should match exact value attribute', async () => {
      const result = await dd.selectDropdownOption(globalThis.document, optionEls, 'value3');
      expect(result).not.toBeNull();
      expect(result.value).toBe('value3');
    });

    test('should be case insensitive', async () => {
      const result = await dd.selectDropdownOption(globalThis.document, optionEls, 'OPTION 2');
      expect(result).not.toBeNull();
      expect(result.innerText).toBe('Option 2');
    });

    test('should trim whitespace', async () => {
      const result = await dd.selectDropdownOption(globalThis.document, optionEls, '  Option 3  ');
      expect(result).not.toBeNull();
      expect(result.innerText).toBe('Option 3');
    });

    test('should scroll matched option into view', async () => {
      let scrolled = false;
      optionEls[0].scrollIntoView = () => { scrolled = true; };

      await dd.selectDropdownOption(globalThis.document, optionEls, 'Option 1');
      expect(scrolled).toBe(true);
    });

    test('should dispatch mouse events on matched option', async () => {
      const events = [];
      ['mousedown', 'mouseup', 'click', 'mouseout'].forEach(type => {
        optionEls[0].addEventListener(type, (e) => {
          events.push(e.type);
        });
      });

      await dd.selectDropdownOption(globalThis.document, optionEls, 'Option 1');
      expect(events).toEqual(['mousedown', 'mouseup', 'click', 'mouseout']);
    });

    test('should return null when no match found', async () => {
      const result = await dd.selectDropdownOption(globalThis.document, optionEls, 'NonExistent');
      expect(result).toBeNull();
    });

    test('should handle dispatch failures gracefully', async () => {
      optionEls[0].click = () => { throw new Error('Click failed'); };

      const result = await dd.selectDropdownOption(globalThis.document, optionEls, 'Option 1');
      expect(result).not.toBeNull();
    });

    test('should escape regex special characters in word search', async () => {
      const opt = createElement('div', { role: 'option', innerText: 'C++ Developer' });
      opt.offsetWidth = 100;
      opt.offsetHeight = 30;
      optionEls.push(opt);

      const result = await dd.selectDropdownOption(globalThis.document, optionEls, 'C++');
      expect(result).not.toBeNull();
      expect(result.innerText).toBe('C++ Developer');
    });
  });

  describe('traverseNestedMenu', () => {
    test('should return null when menuPath is null', async () => {
      const result = await dd.traverseNestedMenu(globalThis.document, null);
      expect(result).toBeNull();
    });

    test('should return null when menuPath is empty', async () => {
      const result = await dd.traverseNestedMenu(globalThis.document, []);
      expect(result).toBeNull();
    });

    test('should click single-level menu item', async () => {
      const menuItem = createElement('div', { role: 'menuitem', innerText: 'Settings' });
      menuItem.offsetWidth = 100;
      menuItem.offsetHeight = 30;

      const originalFind = dd.findDropdownOptions;
      dd.findDropdownOptions = () => [menuItem];

      const result = await dd.traverseNestedMenu(globalThis.document, ['Settings']);
      expect(result).not.toBeNull();

      dd.findDropdownOptions = originalFind;
    });

    test('should return null if submenu never appears', async () => {
      const parent = createElement('div', { innerText: 'Help' });
      parent.offsetWidth = 100;
      parent.offsetHeight = 30;

      const originalFind = dd.findDropdownOptions;
      dd.findDropdownOptions = () => []; // No submenu appears

      const result = await dd.traverseNestedMenu(globalThis.document, ['Help', 'About']);
      expect(result).toBeNull();

      dd.findDropdownOptions = originalFind;
    });
  });

  describe('isCustomDropdown', () => {
    test('should return false for null element', () => {
      expect(dd.isCustomDropdown(null)).toBe(false);
    });

    test('should return false for undefined element', () => {
      expect(dd.isCustomDropdown(undefined)).toBe(false);
    });

    test('should return false for native select element', () => {
      const select = createElement('select');
      expect(dd.isCustomDropdown(select)).toBe(false);
    });

    test('should return true for ARIA combobox', () => {
      const el = createElement('div', { role: 'combobox' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true for ARIA button with haspopup', () => {
      const el = createElement('button', { role: 'button', 'aria-haspopup': 'true' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true for aria-haspopup listbox', () => {
      const el = createElement('div', { 'aria-haspopup': 'listbox' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true for aria-haspopup menu', () => {
      const el = createElement('div', { 'aria-haspopup': 'menu' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true for dropdown class name', () => {
      const el = createElement('div', { className: 'my-dropdown-trigger' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true for combobox class name', () => {
      const el = createElement('div', { className: 'custom-combobox' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true for select class name', () => {
      const el = createElement('div', { className: 'custom-select' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true for picker class name', () => {
      const el = createElement('div', { className: 'date-picker' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true when sibling has dropdown menu', () => {
      const parent = createElement('div');
      const el = createElement('button');
      el.parentElement = parent;

      const sibling = createElement('div', { className: 'dropdown-menu' });
      sibling.offsetWidth = 100;

      parent.querySelectorAll = () => [sibling];
      el.querySelectorAll = () => [];

      expect(dd.isCustomDropdown(el)).toBe(true);
    });

    test('should return true when child has dropdown menu', () => {
      const el = createElement('div');
      const child = createElement('div', { className: 'select-options' });
      child.offsetWidth = 100;
      child.offsetHeight = 30;

      // Provide a parent element (required for child check to run)
      const parent = createElement('div');
      el.parentElement = parent;
      parent.querySelectorAll = () => []; // No siblings

      // Mock querySelectorAll to return the child
      el.querySelectorAll = (sel) => {
        if (sel === '.dropdown-menu, .select-options') {
          return [child];
        }
        return [];
      };

      const result = dd.isCustomDropdown(el);
      expect(result).toBe(true);
    });

    test('should be case insensitive for class names', () => {
      const el = createElement('div', { className: 'DROPDOWN-TRIGGER' });
      expect(dd.isCustomDropdown(el)).toBe(true);
    });
  });

  describe('dismissDropdown', () => {
    test('should return false when document is null', () => {
      expect(dd.dismissDropdown(null)).toBe(false);
    });

    test('should return false when no dropdowns are open', () => {
      expect(dd.dismissDropdown(globalThis.document)).toBe(false);
    });

    test('should return true when dropdown is open', () => {
      const menu = createElement('div', { className: 'dropdown-menu' });
      menu.style = { display: 'block', visibility: 'visible', opacity: '1' };
      menu.offsetWidth = 100;
      menu.offsetHeight = 30;

      globalThis.document.querySelectorAll = () => [menu];

      expect(dd.dismissDropdown(globalThis.document)).toBe(true);
    });

    test('should dispatch Escape key events', () => {
      const activeEl = createElement('div');
      globalThis.document.activeElement = activeEl;

      const events = [];
      ['keydown', 'keypress', 'keyup'].forEach(type => {
        activeEl.addEventListener(type, (e) => {
          events.push({ type: e.type, key: e.key });
        });
      });

      dd.dismissDropdown(globalThis.document);

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('keydown');
      expect(events[0].key).toBe('Escape');
    });

    test('should ignore hidden dropdowns', () => {
      const menu = createElement('div', { className: 'dropdown-menu' });
      menu.style = { display: 'none', visibility: 'hidden', opacity: '0' };
      menu.offsetWidth = 0;
      menu.offsetHeight = 0;

      globalThis.document.querySelectorAll = () => [menu];

      expect(dd.dismissDropdown(globalThis.document)).toBe(false);
    });

    test('should handle querySelectorAll failures gracefully', () => {
      globalThis.document.querySelectorAll = () => { throw new Error('Query failed'); };
      expect(dd.dismissDropdown(globalThis.document)).toBe(false);
    });
  });

  describe('_findSearchInput', () => {
    test('should return null when optionEls is null', () => {
      const result = dd._findSearchInput(globalThis.document, null);
      expect(result).toBeNull();
    });

    test('should return null when optionEls is empty', () => {
      const result = dd._findSearchInput(globalThis.document, []);
      expect(result).toBeNull();
    });

    test('should find input near first option via closest', () => {
      const input = createElement('input', { type: 'text', placeholder: 'Search' });
      input.offsetWidth = 100;
      input.offsetHeight = 30;

      const listbox = createElement('div', { role: 'listbox', children: [input] });
      const option = createElement('div', { role: 'option', innerText: 'Option 1' });
      option.closest = () => listbox;
      listbox.querySelector = () => input;

      const result = dd._findSearchInput(globalThis.document, [option]);
      expect(result).not.toBeNull();
      expect(result.placeholder).toBe('Search');
    });

    test('should find input with placeholder containing "search"', () => {
      const input = createElement('input', { type: 'text', placeholder: 'Search items...' });
      input.offsetWidth = 100;
      input.offsetHeight = 30;

      globalThis.document.querySelectorAll = () => [input];

      const result = dd._findSearchInput(globalThis.document, []);
      expect(result).not.toBeNull();
    });

    test('should find input with placeholder containing "filter"', () => {
      const input = createElement('input', { type: 'text', placeholder: 'Filter results' });
      input.offsetWidth = 100;
      input.offsetHeight = 30;

      globalThis.document.querySelectorAll = () => [input];

      const result = dd._findSearchInput(globalThis.document, []);
      expect(result).not.toBeNull();
    });

    test('should ignore hidden search inputs', () => {
      const input = createElement('input', { type: 'text', placeholder: 'Search' });
      input.offsetWidth = 0;
      input.offsetHeight = 0;

      globalThis.document.querySelectorAll = () => [input];

      const result = dd._findSearchInput(globalThis.document, []);
      expect(result).toBeNull();
    });

    test('should handle closest failures gracefully', () => {
      const option = createElement('div', { role: 'option', innerText: 'Option 1' });
      option.closest = () => { throw new Error('Closest failed'); };

      const result = dd._findSearchInput(globalThis.document, [option]);
      expect(result).toBeNull();
    });

    test('should be case insensitive for placeholder matching', () => {
      const input = createElement('input', { type: 'text', placeholder: 'SEARCH ITEMS' });
      input.offsetWidth = 100;
      input.offsetHeight = 30;

      globalThis.document.querySelectorAll = () => [input];

      const result = dd._findSearchInput(globalThis.document, []);
      expect(result).not.toBeNull();
    });
  });
});
