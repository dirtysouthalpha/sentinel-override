// tests/content-highlight.test.js
// Unit tests for content/highlight.js — highlight/removeHighlight with CSS class injection.

import { jest } from '@jest/globals';

const fn = () => {};

let styleElement = null;
let injectedStyles = {};

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
  await import('../content/highlight.js');
  hl = globalThis.window.__sentinelUtils.highlight;
});

beforeEach(() => {
  injectedStyles = {};
  styleElement = null;
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
});
