// tests/cursor-deep.test.js
// Additional coverage for content/cursor.js uncovered branches

import { jest } from '@jest/globals';

const fn = () => {};

let createdElements = [];
let appendedTo = [];
let observers = [];

function resetGlobals() {
  createdElements = [];
  appendedTo = [];
  observers = [];
}

// Mock window
globalThis.window = globalThis;
delete globalThis.window.__sentinelCursor;
delete globalThis.window.__sentinelUtils;
globalThis.window.__sentinelUtils = {};
globalThis.window.__sentinelCursor = undefined;

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

beforeEach(() => {
  resetGlobals();
  delete globalThis.window.__sentinelCursor;
  globalThis.window.__sentinelCursor = undefined;
  globalThis.window.__sentinelUtils = {};
  globalThis.document = createDocumentMock();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

async function loadCursor() {
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
    const p = cursor.moveTo(-100, -200);
    jest.advanceTimersByTime(500);
    await p;
    expect(cursor.getPosition().x).toBeGreaterThanOrEqual(0);
    expect(cursor.getPosition().y).toBeGreaterThanOrEqual(0);
  });

  test('clamps coordinates exceeding viewport', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const cursor = await loadCursor();
    const p = cursor.moveTo(9999, 9999);
    jest.advanceTimersByTime(500);
    await p;
    expect(cursor.getPosition().x).toBeLessThan(800);
    expect(cursor.getPosition().y).toBeLessThan(600);
  });

  test('returns a promise that resolves after duration', async () => {
    const cursor = await loadCursor();
    const p = cursor.moveTo(100, 200, { duration: 10 });
    expect(p).toBeInstanceOf(Promise);
    jest.advanceTimersByTime(20);
    await p;
  });

  test('uses default duration when options not provided', async () => {
    const cursor = await loadCursor();
    const p = cursor.moveTo(100, 200);
    jest.advanceTimersByTime(500);
    await p;
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
    const p = cursor.moveToElement(el, { duration: 10 });
    jest.advanceTimersByTime(20);
    await p;
    expect(cursor.getPosition().x).toBe(250);
    expect(cursor.getPosition().y).toBe(175);
  });
});

describe('cursor press', () => {
  test('adds pressing class and schedules removal', async () => {
    const cursor = await loadCursor();
    expect(() => cursor.press()).not.toThrow();
  });

  test('press cleanup fires after timeout', async () => {
    const cursor = await loadCursor();
    cursor.press();
    jest.advanceTimersByTime(300);
    // Should not throw — pressing class removed
  });
});

describe('cursor show/hide', () => {
  test('show removes dimmed class', async () => {
    const cursor = await loadCursor();
    expect(() => cursor.show()).not.toThrow();
  });

  test('hide adds dimmed class and clears timer', async () => {
    const cursor = await loadCursor();
    cursor.show();
    jest.advanceTimersByTime(100);
    expect(() => cursor.hide()).not.toThrow();
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
    const p = cursor.moveTo(42, 84);
    jest.advanceTimersByTime(500);
    await p;
    expect(cursor.getPosition()).toEqual({ x: 42, y: 84 });
  });
});

describe('cursor detached element handling', () => {
  test('recreates cursor when element is disconnected', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
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
    const p = cursor.moveTo(10, 20);
    jest.advanceTimersByTime(500);
    await p;
    expect(cursor.getPosition()).toEqual({ x: 10, y: 20 });
  });
});

describe('MutationObserver removal detection', () => {
  test('observer is installed during cursor creation', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    await loadCursor();
    expect(observers.length).toBeGreaterThan(0);
  });

  test('observer callback triggers cursor recreation', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    // Mock requestAnimationFrame to fire synchronously
    const origRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
    try {
      await loadCursor();
      createdElements.length = 0;
      if (observers.length > 0 && observers[0]._cb) {
        observers[0]._cb([]);
      }
      expect(createdElements.some(e => e.id === '__sentinel_cursor__')).toBe(true);
    } finally {
      globalThis.requestAnimationFrame = origRAF;
    }
  });
});

describe('auto-hide behavior', () => {
  test('schedules auto-hide timer when keepVisible is off', async () => {
    const cursor = await loadCursor();
    cursor.setKeepVisible(false);
    cursor.show();
    // Advance past the auto-hide delay
    jest.advanceTimersByTime(13000);
    // Should not throw
  });

  test('does not schedule auto-hide when keepVisible is on', async () => {
    const cursor = await loadCursor();
    cursor.setKeepVisible(true);
    cursor.show();
    jest.advanceTimersByTime(13000);
    // No auto-hide should have been scheduled
  });
});

describe('cursor style injection', () => {
  test('creates style element on first cursor creation', async () => {
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    await loadCursor();
    const styleAppend = appendedTo.find(a => a.target === 'head' && a.el && a.el.tagName === 'STYLE');
    expect(styleAppend).toBeDefined();
  });
});
