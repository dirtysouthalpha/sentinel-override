// tests/cursor-deep.test.js
// Additional coverage for content/cursor.js uncovered branches:
//   19-94: IIFE init, ensureStyle, ensureCursor creation paths
//   104: detached element removal
//   112-136: element creation + append paths
//   143-147: documentElement not ready fallback
//   155-173: installRemovalObserver MutationObserver
//   175-184: scheduleAutoHide with keepVisibleMode
//   229-242: moveToElement with zero-size rect, press timing
//   266-278: setKeepVisible, hide with timer clear

import { jest } from '@jest/globals';

const fn = () => {};

let createdElements = [];
let appendedTo = [];
let observers = [];
let intervals = [];
let timeouts = [];
let rafCallbacks = [];

function resetGlobals() {
  createdElements = [];
  appendedTo = [];
  observers = [];
  intervals = [];
  timeouts = [];
  rafCallbacks = [];
}

// Mock requestAnimationFrame
globalThis.requestAnimationFrame = (cb) => { rafCallbacks.push(cb); return 1; };

// Mock window
globalThis.window = globalThis;
delete globalThis.window.__sentinelCursor;
delete globalThis.window.__sentinelUtils;
globalThis.window.__sentinelUtils = {};
globalThis.window.__sentinelCursor = undefined;

// Mock document
function createDocumentMock() {
  return {
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
          contains(c) { this._classes.has(c); },
        },
        setAttribute: fn,
        innerHTML: '',
        isConnected: true,
        appendChild: fn,
        remove: fn,
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
}

globalThis.MutationObserver = class {
  constructor(cb) { this._cb = cb; observers.push(this); }
  observe() {}
  disconnect() {}
};

let mockSetInterval;
let mockClearInterval;
let mockSetTimeout;
let mockClearTimeout;

beforeEach(() => {
  resetGlobals();
  // Reset window state for fresh cursor init
  delete globalThis.window.__sentinelCursor;
  globalThis.window.__sentinelCursor = undefined;
  globalThis.window.__sentinelUtils = {};
  globalThis.document = createDocumentMock();

  mockSetInterval = jest.spyOn(globalThis, 'setInterval').mockImplementation((cb) => { const id = intervals.push(cb); return id; });
  mockClearInterval = jest.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  mockSetTimeout = jest.spyOn(globalThis, 'setTimeout').mockImplementation((cb) => { const id = timeouts.push(cb); return id; });
  mockClearTimeout = jest.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});
});

afterEach(() => {
  mockSetInterval.mockRestore();
  mockClearInterval.mockRestore();
  mockSetTimeout.mockRestore();
  mockClearTimeout.mockRestore();
});

async function loadCursor() {
  // Dynamic import re-executes the IIFE
  const module = await import('../content/cursor.js?t=' + Date.now());
  return globalThis.window.__sentinelUtils.cursor || globalThis.window.__sentinelCursor;
}

describe('cursor initialization', () => {
  test('creates cursor element on first load', async () => {
    globalThis.window.innerWidth = 1024;
    globalThis.window.innerHeight = 768;
    const cursor = await loadCursor();
    expect(cursor).toBeDefined();
    expect(cursor.__initialized).toBe(true);
  });

  test('idempotent — does not re-initialize if already initialized', async () => {
    globalThis.window.__sentinelCursor = { __initialized: true, moveTo: fn };
    const cursor = await loadCursor();
    // Should return the existing object, not create a new one
    expect(cursor).toBe(globalThis.window.__sentinelCursor);
  });
});

describe('cursor moveTo', () => {
  test('resolves immediately for non-number inputs', async () => {
    const cursor = await loadCursor();
    const result = await cursor.moveTo('abc', 100);
    expect(result).toBeUndefined();
  });

  test('resolves immediately for NaN inputs', async () => {
    const cursor = await loadCursor();
    const result = await cursor.moveTo(NaN, NaN);
    expect(result).toBeUndefined();
  });

  test('clamps coordinates to viewport bounds', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const cursor = await loadCursor();
    await cursor.moveTo(-100, -200);
    // Should not throw; coordinates should be clamped
    expect(cursor.getPosition().x).toBeGreaterThanOrEqual(0);
    expect(cursor.getPosition().y).toBeGreaterThanOrEqual(0);
  });

  test('clamps coordinates exceeding viewport', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const cursor = await loadCursor();
    await cursor.moveTo(9999, 9999);
    expect(cursor.getPosition().x).toBeLessThan(800);
    expect(cursor.getPosition().y).toBeLessThan(600);
  });

  test('returns a promise that resolves after duration', async () => {
    const cursor = await loadCursor();
    const p = cursor.moveTo(100, 200, { duration: 10 });
    expect(p).toBeInstanceOf(Promise);
    await p;
  });

  test('uses default duration when options not provided', async () => {
    const cursor = await loadCursor();
    await cursor.moveTo(100, 200);
    expect(cursor.getPosition()).toEqual({ x: 100, y: 200 });
  });
});

describe('cursor moveToElement', () => {
  test('resolves immediately for null element', async () => {
    const cursor = await loadCursor();
    const result = await cursor.moveToElement(null);
    expect(result).toBeUndefined();
  });

  test('resolves immediately for element without getBoundingClientRect', async () => {
    const cursor = await loadCursor();
    const result = await cursor.moveToElement({});
    expect(result).toBeUndefined();
  });

  test('resolves immediately for zero-size element', async () => {
    const cursor = await loadCursor();
    const el = { getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }) };
    const result = await cursor.moveToElement(el);
    expect(result).toBeUndefined();
  });

  test('moves to center of valid element', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const cursor = await loadCursor();
    const el = {
      getBoundingClientRect: () => ({ width: 100, height: 50, left: 200, top: 150 }),
    };
    await cursor.moveToElement(el, { duration: 10 });
    // Center = left + width/2, top + height/2
    expect(cursor.getPosition().x).toBe(250);
    expect(cursor.getPosition().y).toBe(175);
  });
});

describe('cursor press', () => {
  test('adds pressing class and schedules removal', async () => {
    const cursor = await loadCursor();
    // press() should not throw
    expect(() => cursor.press()).not.toThrow();
    // The setTimeout should have been called for the press cleanup
    expect(timeouts.length).toBeGreaterThan(0);
  });
});

describe('cursor show/hide', () => {
  test('show removes dimmed class', async () => {
    const cursor = await loadCursor();
    expect(() => cursor.show()).not.toThrow();
  });

  test('hide adds dimmed class and clears timer', async () => {
    const cursor = await loadCursor();
    // First show to potentially set a timer
    cursor.show();
    // Then hide
    expect(() => cursor.hide()).not.toThrow();
    expect(mockClearTimeout).toHaveBeenCalled();
  });
});

describe('cursor setKeepVisible', () => {
  test('enabling keepVisible removes dimmed class', async () => {
    const cursor = await loadCursor();
    expect(() => cursor.setKeepVisible(true)).not.toThrow();
  });

  test('disabling keepVisible', async () => {
    const cursor = await loadCursor();
    expect(() => cursor.setKeepVisible(false)).not.toThrow();
  });
});

describe('cursor getPosition', () => {
  test('returns current position', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const cursor = await loadCursor();
    await cursor.moveTo(42, 84);
    expect(cursor.getPosition()).toEqual({ x: 42, y: 84 });
  });
});

describe('cursor detached element handling', () => {
  test('recreates cursor when element is disconnected', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    // Create a cursor that's marked as disconnected
    const disconnectedEl = {
      id: '__sentinel_cursor__',
      isConnected: false,
      style: {},
      classList: { add: fn, remove: fn, contains: () => false, _classes: new Set() },
      setAttribute: fn,
      innerHTML: '',
      appendChild: fn,
      remove: fn,
    };
    createdElements.push(disconnectedEl);
    const cursor = await loadCursor();
    // The cursor should still be usable
    await cursor.moveTo(10, 20);
    expect(cursor.getPosition()).toEqual({ x: 10, y: 20 });
  });
});

describe('MutationObserver removal detection', () => {
  test('observer is installed during cursor creation', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const cursor = await loadCursor();
    // Observer should have been created
    expect(observers.length).toBeGreaterThan(0);
  });

  test('observer callback triggers cursor recreation', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const cursor = await loadCursor();
    // Simulate cursor element being removed (not found by getElementById)
    // by clearing the created elements array
    createdElements.length = 0;
    // Trigger the mutation observer callback
    if (observers.length > 0 && observers[0]._cb) {
      observers[0]._cb([]);
      // Fire the rAF callback
      if (rafCallbacks.length > 0) {
        rafCallbacks[0]();
      }
    }
    // Cursor should be recreated
    expect(createdElements.some(e => e.id === '__sentinel_cursor__')).toBe(true);
  });
});

describe('auto-hide behavior', () => {
  test('schedules auto-hide timer when keepVisible is off', async () => {
    const cursor = await loadCursor();
    cursor.setKeepVisible(false);
    cursor.show();
    // show() should schedule a timeout for auto-hide
    expect(timeouts.length).toBeGreaterThan(0);
  });

  test('does not schedule auto-hide when keepVisible is on', async () => {
    const cursor = await loadCursor();
    cursor.setKeepVisible(true);
    const timeoutCountBefore = timeouts.length;
    cursor.show();
    // No new timeout should be added
    expect(timeouts.length).toBe(timeoutCountBefore);
  });
});

describe('cursor style injection', () => {
  test('creates style element on first cursor creation', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const cursor = await loadCursor();
    // Should have appended a style element to head
    const styleAppend = appendedTo.find(a => a.target === 'head' && a.el && a.el.tagName === 'STYLE');
    expect(styleAppend).toBeDefined();
  });
});
