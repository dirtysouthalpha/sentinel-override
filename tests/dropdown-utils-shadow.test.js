// tests/dropdown-utils-shadow.test.js
// Covers lines 179-188: shadow.queryDeep path in findDropdownOptions.
// A separate file is required because `shadow` is captured at module-import time:
//   const shadow = window.__sentinelUtils.shadow || {};
// Setting shadow.queryDeep before the import ensures the TRUE branch at line 179
// is reachable in this module instance.

import { jest } from '@jest/globals';

// ── DOM environment ───────────────────────────────────────────────────────────
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
    this.type = type; this.key = opts.key || ''; this.code = opts.code || '';
    this.keyCode = opts.keyCode || 0; this.which = opts.which || 0;
    this.bubbles = opts.bubbles ?? true; this.cancelable = opts.cancelable ?? true;
  }
};
globalThis.Event = class Event {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles ?? true;
    this.cancelable = opts.cancelable ?? true;
    this.composed = opts.composed ?? true;
  }
};
globalThis.InputEvent = class InputEvent extends globalThis.Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.inputType = opts.inputType || '';
    this.data = opts.data || '';
  }
};

// ── Shadow mock — set BEFORE module import so the captured `shadow` has queryDeep
const queryDeepFn = jest.fn();
window.__sentinelUtils = {
  shadow: { queryDeep: queryDeepFn },
  dom: { isVisible: () => true },
  wait: {},
};

// ── Module load ───────────────────────────────────────────────────────────────
let dd;
beforeAll(async () => {
  await import('../content/dropdown-utils.js');
  dd = window.__sentinelUtils.dropdown;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function makeDoc() {
  return {
    defaultView: globalThis,
    querySelectorAll: () => ({ forEach: () => {}, length: 0 }),
    querySelector: () => null,
    getElementById: () => null,
    body: { innerText: '', appendChild: () => {}, removeChild: () => {}, dispatchEvent: () => true },
    activeElement: null,
    documentElement: { children: [] },
  };
}

function makeOption(text) {
  return {
    tagName: 'LI', nodeType: 1,
    getAttribute: () => null,
    innerText: text, textContent: text,
    dispatchEvent: () => true,
    scrollIntoView: () => {},
    click: () => {},
    querySelectorAll: () => ({ forEach: () => {}, length: 0 }),
    closest: () => null,
    parentElement: null,
  };
}

describe('findDropdownOptions — shadow.queryDeep TRUE path (lines 179-188)', () => {
  test('queryDeep returns array with forEach: shadow options are collected (lines 181-183, 185-187)', () => {
    const shadowOpt = makeOption('shadow-option');
    const shadowMenuItem = makeOption('shadow-menu-item');
    queryDeepFn
      .mockReturnValueOnce([shadowOpt])       // call 1: '[role="option"]'
      .mockReturnValueOnce([shadowMenuItem]); // call 2: '[role="menuitem"]'

    const result = dd.findDropdownOptions(makeDoc(), null);

    expect(queryDeepFn).toHaveBeenCalledTimes(2);
    expect(queryDeepFn).toHaveBeenNthCalledWith(1, expect.anything(), '[role="option"]');
    expect(queryDeepFn).toHaveBeenNthCalledWith(2, expect.anything(), '[role="menuitem"]');
    expect(result).toContain(shadowOpt);
    expect(result).toContain(shadowMenuItem);
  });

  test('queryDeep returns object without forEach: shadow items skipped (FALSE branch lines 182, 186)', () => {
    queryDeepFn.mockReturnValue({ length: 0 }); // no forEach property
    const result = dd.findDropdownOptions(makeDoc(), null);
    expect(queryDeepFn).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]);
  });

  test('queryDeep returns empty array: no additions but forEach TRUE branch still fires', () => {
    queryDeepFn.mockReturnValue([]);
    const result = dd.findDropdownOptions(makeDoc(), null);
    expect(queryDeepFn).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]);
  });
});
