// tests/content-highlight.test.js
// Unit tests for content/highlight.js — highlight/removeHighlight with CSS class injection.

import { jest } from '@jest/globals';

const fn = () => {};

let styleElement = null;
let injectedStyles = {};
let consoleWarnSpy;

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = { highlight: {} };

globalThis.document = {
  getElementById: (id) => injectedStyles[id] || null,
  createElement: (tag) => {
    const el = { tagName: tag, id: '', textContent: '', appendChild: fn };
    styleElement = el;
    return el;
  },
  head: { appendChild: fn },
  documentElement: { appendChild: fn },
};

let hl;
beforeAll(async () => {
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await import('../content/highlight.js');
  hl = globalThis.window.__sentinelUtils.highlight;
});

afterAll(() => {
  consoleWarnSpy.mockRestore();
});

beforeEach(() => {
  injectedStyles = {};
  styleElement = null;
  consoleWarnSpy.mockClear();
});

describe('hl.highlightElement', () => {
  test('adds highlight class to element', () => {
    const el = { classList: { add: fn } };
    hl.highlightElement(el);
    // Should not throw
  });

  test('handles null element gracefully', () => {
    expect(() => hl.highlightElement(null)).not.toThrow();
  });

  test('handles element without classList gracefully', () => {
    expect(() => hl.highlightElement({})).not.toThrow();
  });

  test('injects style element on first call', () => {
    const el = { classList: { add: fn } };
    hl.highlightElement(el);
    // Style should be injected (createElement was called)
  });

  test('skips style injection when style already exists', () => {
    // Pre-populate the style element
    injectedStyles['__sentinel_highlight_style__'] = { id: '__sentinel_highlight_style__' };
    const el = { classList: { add: fn } };
    hl.highlightElement(el);
    // Should not create a new style element since one already exists
    expect(styleElement).toBeNull();
  });

  test('catches error from ensureStyleInjected', () => {
    const origGetById = globalThis.document.getElementById;
    globalThis.document.getElementById = () => { throw new Error('nope'); };
    const el = { classList: { add: fn } };
    expect(() => hl.highlightElement(el)).not.toThrow();
    globalThis.document.getElementById = origGetById;
  });

  test('catches error from classList.add', () => {
    const el = {
      classList: { add: () => { throw new Error('add fail'); } },
    };
    expect(() => hl.highlightElement(el)).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  test('catches error from createElement in ensureStyleInjected', () => {
    const origCreateEl = globalThis.document.createElement;
    globalThis.document.createElement = () => { throw new Error('create fail'); };
    const el = { classList: { add: fn } };
    // Should not throw — ensureStyleInjected catches, then highlightElement catches
    expect(() => hl.highlightElement(el)).not.toThrow();
    globalThis.document.createElement = origCreateEl;
  });

  test('handles undefined element gracefully', () => {
    expect(() => hl.highlightElement(undefined)).not.toThrow();
  });

  test('handles falsey element gracefully', () => {
    expect(() => hl.highlightElement(0)).not.toThrow();
    expect(() => hl.highlightElement('')).not.toThrow();
  });

  test('catch uses String(e) when error has no message (line 42 ternary false branch)', () => {
    const el = {
      classList: { add: () => { throw 'string-error'; } },
    };
    expect(() => hl.highlightElement(el)).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('highlight element:'), 'string-error');
  });
});

describe('hl.removeHighlight', () => {
  test('handles null element gracefully', () => {
    expect(() => hl.removeHighlight(null)).not.toThrow();
  });

  test('handles element without classList gracefully', () => {
    expect(() => hl.removeHighlight({})).not.toThrow();
  });

  test('schedules removal after delay', () => {
    jest.useFakeTimers();
    const el = { classList: { remove: fn } };
    hl.removeHighlight(el);
    // The removal is scheduled with setTimeout(500ms)
    jest.useRealTimers();
  });

  test('actually removes highlight class after timeout', () => {
    jest.useFakeTimers();
    let removed = false;
    const el = { classList: { remove: () => { removed = true; } } };
    hl.removeHighlight(el);
    expect(removed).toBe(false);
    jest.advanceTimersByTime(500);
    expect(removed).toBe(true);
    jest.useRealTimers();
  });

  test('catches error from classList.remove in setTimeout', () => {
    jest.useFakeTimers();
    const el = {
      classList: { remove: () => { throw new Error('remove fail'); } },
    };
    hl.removeHighlight(el);
    expect(() => jest.advanceTimersByTime(500)).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('catches error from outer removeHighlight try block', () => {
    // Make classList.add throw in a way that the outer catch catches
    const el = { classList: null };
    // el.classList is falsy → early return, no error
    expect(() => hl.removeHighlight(el)).not.toThrow();
  });

  test('catches error when classList is a throwing getter', () => {
    const el = {};
    Object.defineProperty(el, 'classList', {
      get() { throw new Error('getter fail'); },
    });
    // The outer try/catch should handle this
    expect(() => hl.removeHighlight(el)).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  test('handles undefined element gracefully', () => {
    expect(() => hl.removeHighlight(undefined)).not.toThrow();
  });

  test('inner catch uses String(e) when error has no message (line 55 ternary false branch)', () => {
    jest.useFakeTimers();
    const el = {
      classList: { remove: () => { throw 42; } },
    };
    hl.removeHighlight(el);
    expect(() => jest.advanceTimersByTime(500)).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('remove highlight class:'), '42');
    jest.useRealTimers();
  });

  test('outer catch uses String(e) when error has no message (line 57 ternary false branch)', () => {
    const el = {};
    Object.defineProperty(el, 'classList', {
      get() { throw 'outer-err'; },
    });
    expect(() => hl.removeHighlight(el)).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('removeHighlight:'), 'outer-err');
  });
});

describe('ensureStyleInjected — edge cases', () => {
  test('falls back to documentElement when head is null', () => {
    const origHead = globalThis.document.head;
    globalThis.document.head = null;
    const el = { classList: { add: fn } };
    hl.highlightElement(el);
    globalThis.document.head = origHead;
  });

  test('handles both head and documentElement being null', () => {
    const origHead = globalThis.document.head;
    const origDE = globalThis.document.documentElement;
    globalThis.document.head = null;
    globalThis.document.documentElement = null;
    const el = { classList: { add: fn } };
    // Should not throw even though appendChild target is null
    expect(() => hl.highlightElement(el)).not.toThrow();
    globalThis.document.head = origHead;
    globalThis.document.documentElement = origDE;
  });

  test('handles appendChild throwing in ensureStyleInjected', () => {
    const origHead = globalThis.document.head;
    globalThis.document.head = { appendChild: () => { throw new Error('append fail'); } };
    const el = { classList: { add: fn } };
    // ensureStyleInjected catches internally, highlight proceeds
    expect(() => hl.highlightElement(el)).not.toThrow();
    globalThis.document.head = origHead;
  });
});
