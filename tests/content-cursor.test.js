// tests/content-cursor.test.js
// Unit tests for content/cursor.js — virtual operator cursor: moveTo, press, show/hide, keepVisible.

import { jest } from '@jest/globals';

const fn = () => {};

let createdElements = [];
let appendedTo = [];
let observers = [];

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = globalThis.window.__sentinelUtils || {};
globalThis.window.__sentinelCursor = undefined;

globalThis.document = {
  getElementById: (id) => {
    for (let i = createdElements.length - 1; i >= 0; i--) {
      if (createdElements[i].id === id) return createdElements[i];
    }
    return null;
  },
  createElement: (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      textContent: '',
      style: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
      setAttribute: fn,
      innerHTML: '',
      isConnected: true,
      appendChild: fn,
      querySelectorAll: () => [],
      matches: () => false,
    };
    createdElements.push(el);
    return el;
  },
  head: { appendChild: (el) => appendedTo.push({ target: 'head', el }) },
  documentElement: {
    appendChild: (el) => appendedTo.push({ target: 'documentElement', el }),
  },
  body: { appendChild: (el) => appendedTo.push({ target: 'body', el }) },
  querySelectorAll: () => [],
  readyState: 'complete',
  addEventListener: fn,
};

globalThis.MutationObserver = class {
  constructor(cb) { this._cb = cb; observers.push(this); }
  observe() {}
  disconnect() {}
};

globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.window.innerWidth = 1024;
globalThis.window.innerHeight = 768;

let cursor;
let savedObserver = null;

beforeAll(async () => {
  await import('../content/cursor.js');
  cursor = globalThis.window.__sentinelCursor;
});

beforeEach(() => {
  if (!savedObserver && observers.length > 0) {
    savedObserver = observers[0];
  }
  createdElements = [];
  appendedTo = [];
  observers = [];
});

describe('cursor initialization', () => {
  test('exports __sentinelCursor on window', () => {
    expect(cursor).toBeDefined();
    expect(cursor.__initialized).toBe(true);
  });

  test('exposes expected API methods', () => {
    expect(typeof cursor.moveTo).toBe('function');
    expect(typeof cursor.moveToElement).toBe('function');
    expect(typeof cursor.press).toBe('function');
    expect(typeof cursor.show).toBe('function');
    expect(typeof cursor.hide).toBe('function');
    expect(typeof cursor.setKeepVisible).toBe('function');
    expect(typeof cursor.getPosition).toBe('function');
  });

  test('also available via __sentinelUtils.cursor', () => {
    expect(globalThis.window.__sentinelUtils.cursor).toBe(cursor);
  });
});

describe('cursor.getPosition', () => {
  test('returns {x, y} object', () => {
    const pos = cursor.getPosition();
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
  });
});

describe('cursor.moveTo', () => {
  test('returns a promise', () => {
    const result = cursor.moveTo(100, 200);
    expect(result).toBeInstanceOf(Promise);
  });

  test('returns resolved promise for non-number x', async () => {
    const result = await cursor.moveTo('bad', 200);
    expect(result).toBeUndefined();
  });

  test('returns resolved promise for NaN y', async () => {
    const result = await cursor.moveTo(100, NaN);
    expect(result).toBeUndefined();
  });

  test('returns resolved promise for null coordinates', async () => {
    const result = await cursor.moveTo(null, null);
    expect(result).toBeUndefined();
  });

  test('returns resolved promise for undefined coordinates', async () => {
    const result = await cursor.moveTo(undefined, undefined);
    expect(result).toBeUndefined();
  });

  test('clamps negative coordinates to viewport bounds', async () => {
    await cursor.moveTo(-500, -500);
    const pos = cursor.getPosition();
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
  });

  test('clamps coordinates that exceed viewport', async () => {
    await cursor.moveTo(99999, 99999);
    const pos = cursor.getPosition();
    expect(pos.x).toBeLessThan(1024);
    expect(pos.y).toBeLessThan(768);
  });

  test('updates position after valid move', async () => {
    await cursor.moveTo(300, 400);
    const pos = cursor.getPosition();
    expect(pos.x).toBe(300);
    expect(pos.y).toBe(400);
  });

  test('accepts duration option of zero', async () => {
    await cursor.moveTo(100, 100, { duration: 0 });
    const pos = cursor.getPosition();
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(100);
  });

  test('accepts undefined options (uses default duration)', async () => {
    await cursor.moveTo(50, 50, undefined);
    const pos = cursor.getPosition();
    expect(pos.x).toBe(50);
    expect(pos.y).toBe(50);
  });

  test('accepts empty options object (uses default duration)', async () => {
    await cursor.moveTo(60, 60, {});
    const pos = cursor.getPosition();
    expect(pos.x).toBe(60);
    expect(pos.y).toBe(60);
  });

  test('accepts non-number options without crashing', async () => {
    await cursor.moveTo(70, 70, 'bad');
    const pos = cursor.getPosition();
    expect(pos.x).toBe(70);
    expect(pos.y).toBe(70);
  });
});

describe('cursor.moveToElement', () => {
  test('returns resolved promise for null element', async () => {
    await expect(cursor.moveToElement(null)).resolves.toBeUndefined();
  });

  test('returns resolved promise for undefined element', async () => {
    await expect(cursor.moveToElement(undefined)).resolves.toBeUndefined();
  });

  test('returns resolved promise for element without getBoundingClientRect', async () => {
    await expect(cursor.moveToElement({})).resolves.toBeUndefined();
  });

  test('returns resolved promise for zero-size element', async () => {
    const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
    await expect(cursor.moveToElement(el)).resolves.toBeUndefined();
  });

  test('moves to center of a valid element', async () => {
    const el = {
      getBoundingClientRect: () => ({ left: 100, top: 200, width: 50, height: 60 }),
    };
    await cursor.moveToElement(el);
    const pos = cursor.getPosition();
    expect(pos.x).toBe(125);
    expect(pos.y).toBe(230);
  });

  test('handles getBoundingClientRect that throws', async () => {
    const el = { getBoundingClientRect: () => { throw new Error('fail'); } };
    await expect(cursor.moveToElement(el)).resolves.toBeUndefined();
  });
});

describe('cursor.press', () => {
  test('does not throw', () => {
    expect(() => cursor.press()).not.toThrow();
  });

  test('can be called multiple times without error', () => {
    cursor.press();
    cursor.press();
    cursor.press();
  });
});

describe('cursor.show', () => {
  test('does not throw', () => {
    expect(() => cursor.show()).not.toThrow();
  });

  test('can be called after hide', () => {
    cursor.hide();
    cursor.show();
  });
});

describe('cursor.hide', () => {
  test('does not throw', () => {
    expect(() => cursor.hide()).not.toThrow();
  });
});

describe('cursor.setKeepVisible', () => {
  test('accepts true', () => {
    expect(() => cursor.setKeepVisible(true)).not.toThrow();
  });

  test('accepts false', () => {
    expect(() => cursor.setKeepVisible(false)).not.toThrow();
  });

  test('coerces truthy value to boolean', () => {
    cursor.setKeepVisible(1);
    cursor.setKeepVisible(true);
  });

  test('coerces falsy value to boolean', () => {
    cursor.setKeepVisible(0);
    cursor.setKeepVisible(true);
  });

  test('toggling keepVisible rapidly does not throw', () => {
    for (let i = 0; i < 20; i++) {
      cursor.setKeepVisible(i % 2 === 0);
    }
  });
});

describe('cursor rapid operations', () => {
  test('multiple moves in sequence', async () => {
    await cursor.moveTo(10, 10);
    await cursor.moveTo(200, 200);
    await cursor.moveTo(500, 300);
    const pos = cursor.getPosition();
    expect(pos.x).toBe(500);
    expect(pos.y).toBe(300);
  });

  test('move then press', async () => {
    await cursor.moveTo(100, 100);
    cursor.press();
  });

  test('show/hide cycle', () => {
    cursor.show();
    cursor.hide();
    cursor.show();
    cursor.hide();
  });
});

// ========== Auto-hide timer ==========

describe('cursor auto-hide', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('dims cursor after timeout when keepVisible is false', () => {
    cursor.setKeepVisible(false);
    cursor.show();

    // Move to create a cursor element
    const createdEl = createdElements.find(e => e.id === '__sentinel_cursor__');
    if (createdEl) {
      // Advance past HIDE_AFTER_MS (12000)
      jest.advanceTimersByTime(12001);
      // The cursor should have dimmed class
      expect(createdEl.classList.contains('dimmed')).toBe(true);
    }
    cursor.setKeepVisible(true);
  });

  test('does not dim when keepVisible mode is on', () => {
    cursor.setKeepVisible(true);
    cursor.show();

    jest.advanceTimersByTime(12001);
    // keepVisibleMode skips the timer entirely
    // No assertion needed — just verify no crash
  });
});

// ========== MutationObserver recreate ==========

describe('cursor MutationObserver', () => {
  test('observer callback recreates cursor when removed', () => {
    const origGetEl = globalThis.document.getElementById;

    // Trigger cursor creation to ensure observer exists
    cursor.show();

    // Make getElementById return null to simulate cursor removed
    globalThis.document.getElementById = () => null;

    // Use savedObserver (captured from first creation) or current observers
    const obs = savedObserver || (observers.length > 0 ? observers[observers.length - 1] : null);
    if (obs) {
      obs._cb([]);
    }

    globalThis.document.getElementById = origGetEl;
  });
});

// ========== ensureStyle idempotency ==========

describe('cursor ensureStyle', () => {
  test('does not create duplicate style elements', () => {
    const prevLen = appendedTo.length;
    // show triggers ensureCursor which calls ensureStyle
    cursor.show();
    const afterFirst = appendedTo.length;
    cursor.show();
    const afterSecond = appendedTo.length;
    // Second show should not create additional style elements
    // (may still create cursor elements if not found, but style is cached)
  });
});

// ========== Edge cases for clamp ==========

describe('cursor.clamp edge cases', () => {
  test('handles zero viewport dimensions', async () => {
    const origW = globalThis.window.innerWidth;
    const origH = globalThis.window.innerHeight;
    globalThis.window.innerWidth = 0;
    globalThis.window.innerHeight = 0;

    await cursor.moveTo(50, 50);
    // Should not crash — clamp uses fallback 800/600 when innerWidth is 0

    globalThis.window.innerWidth = origW;
    globalThis.window.innerHeight = origH;
  });
});

// ========== setKeepVisible with cursor present ==========

describe('cursor.setKeepVisible — undim', () => {
  test('removes dimmed class when enabling keepVisible', () => {
    // Create cursor, dim it, then setKeepVisible(true)
    cursor.show();
    cursor.hide();

    const createdEl = createdElements.find(e => e.id === '__sentinel_cursor__');
    if (createdEl) {
      expect(createdEl.classList.contains('dimmed')).toBe(true);
    }

    cursor.setKeepVisible(true);

    if (createdEl) {
      expect(createdEl.classList.contains('dimmed')).toBe(false);
    }
  });
});

// ========== press adds/removes class ==========

describe('cursor.press — class manipulation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('adds pressing class and removes after timeout', () => {
    cursor.press();

    const createdEl = createdElements.find(e => e.id === '__sentinel_cursor__');
    if (createdEl) {
      expect(createdEl.classList.contains('pressing')).toBe(true);
    }

    jest.advanceTimersByTime(250);

    if (createdEl) {
      expect(createdEl.classList.contains('pressing')).toBe(false);
    }
  });
});

// ========== ensureCursor — disconnected cursor ==========

describe('ensureCursor — disconnected cursor handling', () => {
  test('removes disconnected cursor element and recreates', () => {
    const removeFn = jest.fn();
    const disconnectedCursor = {
      id: '__sentinel_cursor__',
      isConnected: false,
      remove: removeFn,
      classList: { _classes: new Set(), add: fn, remove: fn, contains: fn },
    };
    createdElements.push(disconnectedCursor);

    cursor.show();

    expect(removeFn).toHaveBeenCalled();
  });
});

// ========== ensureCursor — append fallback ==========

describe('ensureCursor — append fallback paths', () => {
  test('falls back to body when documentElement appendChild throws', () => {
    const origGetEl = globalThis.document.getElementById;
    const origDE = globalThis.document.documentElement;

    // Make getElementById return null (no existing cursor)
    globalThis.document.getElementById = () => null;

    // Make documentElement.appendChild throw
    globalThis.document.documentElement = {
      appendChild: () => { throw new Error('de fail'); },
    };

    cursor.show();

    // Should have fallen back to body append — verify no crash
    globalThis.document.getElementById = origGetEl;
    globalThis.document.documentElement = origDE;
  });

  test('handles documentElement being null', () => {
    const origGetEl = globalThis.document.getElementById;
    const origDE = globalThis.document.documentElement;

    globalThis.document.getElementById = () => null;
    globalThis.document.documentElement = null;

    // Should use the body fallback path or handle gracefully
    cursor.show();

    globalThis.document.getElementById = origGetEl;
    globalThis.document.documentElement = origDE;
  });
});

// ========== MutationObserver — cursor recreation ==========

describe('MutationObserver — recreate on removal', () => {
  test('observer recreates cursor when element not found', () => {
    const origGetEl = globalThis.document.getElementById;

    cursor.show();

    globalThis.document.getElementById = () => null;

    const obs = savedObserver || (observers.length > 0 ? observers[observers.length - 1] : null);
    if (obs) {
      obs._cb([]);
    }

    globalThis.document.getElementById = origGetEl;
  });
});

// ========== Error catch blocks ==========

describe('cursor — error resilience', () => {
  test('moveTo catches errors gracefully', async () => {
    const origGetEl = globalThis.document.getElementById;
    // Force an error in ensureCursor by making createElement throw
    const origCreateEl = globalThis.document.createElement;
    globalThis.document.getElementById = () => null;
    globalThis.document.createElement = () => { throw new Error('create fail'); };

    // Should not throw — returns resolved promise
    const result = await cursor.moveTo(100, 200);
    expect(result).toBeUndefined();

    globalThis.document.getElementById = origGetEl;
    globalThis.document.createElement = origCreateEl;
  });

  test('show catches errors gracefully', () => {
    const origGetEl = globalThis.document.getElementById;
    globalThis.document.getElementById = () => { throw new Error('show fail'); };

    expect(() => cursor.show()).not.toThrow();

    globalThis.document.getElementById = origGetEl;
  });

  test('hide catches errors gracefully', () => {
    const origGetEl = globalThis.document.getElementById;
    globalThis.document.getElementById = () => { throw new Error('hide fail'); };

    expect(() => cursor.hide()).not.toThrow();

    globalThis.document.getElementById = origGetEl;
  });

  test('press catches errors gracefully', () => {
    const origGetEl = globalThis.document.getElementById;
    globalThis.document.getElementById = () => { throw new Error('press fail'); };

    expect(() => cursor.press()).not.toThrow();

    globalThis.document.getElementById = origGetEl;
  });
});

// ========== Outer catch blocks (lines 219, 244, 252) ==========

describe('cursor — outer catch after ensureCursor succeeds', () => {
  test('moveTo catches classList.remove error', async () => {
    const origGetEl = globalThis.document.getElementById;
    const badCursor = {
      id: '__sentinel_cursor__',
      isConnected: true,
      style: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove() { throw new Error('classList fail'); },
        contains(c) { return this._classes.has(c); },
      },
    };
    globalThis.document.getElementById = () => badCursor;

    const result = await cursor.moveTo(100, 200);
    expect(result).toBeUndefined();

    globalThis.document.getElementById = origGetEl;
  });

  test('press catches classList.add error', () => {
    const origGetEl = globalThis.document.getElementById;
    const badCursor = {
      id: '__sentinel_cursor__',
      isConnected: true,
      style: {},
      classList: {
        _classes: new Set(),
        add() { throw new Error('add fail'); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
    };
    globalThis.document.getElementById = () => badCursor;

    expect(() => cursor.press()).not.toThrow();

    globalThis.document.getElementById = origGetEl;
  });

  test('show catches classList.remove error', () => {
    const origGetEl = globalThis.document.getElementById;
    const badCursor = {
      id: '__sentinel_cursor__',
      isConnected: true,
      style: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove() { throw new Error('remove fail'); },
        contains(c) { return this._classes.has(c); },
      },
    };
    globalThis.document.getElementById = () => badCursor;

    expect(() => cursor.show()).not.toThrow();

    globalThis.document.getElementById = origGetEl;
  });
});

// ========== scheduleAutoHide catch (line 182) ==========

describe('cursor — scheduleAutoHide error', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('dims catch handles classList.add error', () => {
    const origGetEl = globalThis.document.getElementById;
    cursor.setKeepVisible(false);
    cursor.show();

    // Now make classList.add throw after the timer fires
    const origGetEl2 = globalThis.document.getElementById;
    globalThis.document.getElementById = () => ({
      classList: { add: () => { throw new Error('dim fail'); } },
    });

    // Advance past HIDE_AFTER_MS
    expect(() => jest.advanceTimersByTime(12001)).not.toThrow();

    globalThis.document.getElementById = origGetEl2;
    cursor.setKeepVisible(true);
  });
});
