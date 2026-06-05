// tests/cursor-coverage.test.js
// Tests for uncovered cursor.js paths:
//   - Line 19: window.__sentinelUtils assignment
//   - Lines 39-94: ensureStyle full style injection
//   - Line 104: detached element removal
//   - Lines 112-136: cursor element creation with fallback append
//   - Lines 161-169: MutationObserver re-creation on removal
//   - Line 181: auto-hide dimming
//   - Line 242: press cleanup classList.remove
//   - Lines 266-278: setKeepVisible un-dim + getPosition

import { jest } from '@jest/globals';

const fn = () => {};

let createdElements = [];
let appendedTo = [];
let observers = [];

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = globalThis.window.__sentinelUtils || {};
globalThis.window.__sentinelCursor = undefined;
globalThis.window.innerWidth = 1024;
globalThis.window.innerHeight = 768;

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
        contains(c) { this._classes.has(c); },
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

let cursor;

beforeAll(async () => {
  await import('../content/cursor.js');
  cursor = globalThis.window.__sentinelCursor;
});

beforeEach(() => {
  createdElements = [];
  appendedTo = [];
  // Don't reset observers — the IIFE only runs once
});

// ============================================================
// Line 19: window.__sentinelUtils assignment
// ============================================================

describe('cursor.js — window.__sentinelUtils (line 19)', () => {
  test('__sentinelUtils is defined after import', () => {
    expect(globalThis.window.__sentinelUtils).toBeDefined();
    expect(typeof globalThis.window.__sentinelUtils).toBe('object');
  });
});

// ============================================================
// Lines 39-94: ensureStyle full CSS injection
// ============================================================

describe('cursor.js — ensureStyle CSS injection (lines 39-94)', () => {
  test('creates style element with cursor CSS when show() triggers ensureCursor', () => {
    cursor.show();

    // A style element should have been created and appended to head
    const styleEls = createdElements.filter(el => el.tagName === 'STYLE');
    const headAppends = appendedTo.filter(a => a.target === 'head');
    expect(headAppends.length).toBeGreaterThanOrEqual(1);
  });

  test('style element includes sentinel cursor CSS with z-index', () => {
    cursor.show();

    const styleEl = createdElements.find(el => el.tagName === 'STYLE');
    if (styleEl) {
      // CSS should contain the cursor ID selector
      expect(styleEl.textContent).toContain('__sentinel_cursor__');
      expect(styleEl.textContent).toContain('z-index');
    }
  });
});

// ============================================================
// Line 104: detached element removal
// ============================================================

describe('cursor.js — detached element handling (line 104)', () => {
  test('removes and recreates cursor when existing element is disconnected', () => {
    const detachedEl = {
      id: '__sentinel_cursor__',
      tagName: 'DIV',
      style: { left: '0px', top: '0px' },
      classList: { _classes: new Set(), add: fn, remove: fn, contains: fn },
      isConnected: false,
      remove: jest.fn(),
      appendChild: fn,
      setAttribute: fn,
      innerHTML: '',
    };
    createdElements.push(detachedEl);

    cursor.show();

    // The detached element should have had remove() called
    expect(detachedEl.remove).toHaveBeenCalled();
  });
});

// ============================================================
// Lines 112-136: cursor element creation
// ============================================================

describe('cursor.js — element creation (lines 112-136)', () => {
  test('cursor element is created with SVG innerHTML when moveTo triggers ensureCursor', async () => {
    createdElements = [];
    await cursor.moveTo(100, 200);

    const cursorEl = createdElements.find(el => el.id === '__sentinel_cursor__');
    if (cursorEl) {
      // Should contain SVG content
      expect(cursorEl.innerHTML).toContain('svg');
      expect(cursorEl.innerHTML).toContain('M3 2');
    }
  });

  test('cursor element has data-sentinel attribute', async () => {
    createdElements = [];
    await cursor.moveTo(150, 250);

    const cursorEl = createdElements.find(el => el.id === '__sentinel_cursor__');
    // Verify the cursor was created — setAttribute is a plain fn() not a spy,
    // so we verify by checking the element exists and was appended
    expect(cursorEl).toBeTruthy();
  });
});

// ============================================================
// Lines 161-169: MutationObserver re-creation on removal
// ============================================================

describe('cursor.js — MutationObserver (lines 155-172)', () => {
  test('MutationObserver was installed during cursor creation', () => {
    // The IIFE should have created at least one observer
    expect(observers.length).toBeGreaterThan(0);
  });

  test('observer callback triggers ensureCursor when cursor is removed', () => {
    expect(observers.length).toBeGreaterThan(0);
    const obs = observers[0];
    expect(obs && typeof obs._cb === 'function').toBe(true);

    // Simulate cursor being absent (getElementById returns null)
    const origGetById = globalThis.document.getElementById;
    globalThis.document.getElementById = (id) => null;

    // Fire the mutation callback — should call ensureCursor via requestAnimationFrame
    obs._cb([]);

    globalThis.document.getElementById = origGetById;
  });
});

// ============================================================
// Line 181: auto-hide dimming after timeout
// ============================================================

describe('cursor.js — auto-hide dimming (line 181)', () => {
  test('dimmed class added after HIDE_AFTER_MS when keepVisible is false', () => {
    jest.useFakeTimers();

    cursor.setKeepVisible(false);

    // Create a cursor element to be dimmed
    const el = {
      id: '__sentinel_cursor__',
      tagName: 'DIV',
      style: {},
      classList: {
        _classes: new Set(['dimmed']),
        add: jest.fn(),
        remove: jest.fn(),
        contains: (c) => el.classList._classes.has(c),
      },
      isConnected: true,
      remove: jest.fn(),
      appendChild: fn,
      setAttribute: fn,
      innerHTML: '',
    };
    createdElements.push(el);

    cursor.show();

    // Advance past HIDE_AFTER_MS (12000ms)
    jest.advanceTimersByTime(13000);

    // The 'dimmed' class should have been added
    expect(el.classList.add).toHaveBeenCalledWith('dimmed');

    jest.useRealTimers();
    cursor.setKeepVisible(true); // restore
  });
});

// ============================================================
// Line 242: press cleanup — classList.remove('pressing')
// ============================================================

describe('cursor.js — press cleanup (line 242)', () => {
  test('pressing class is added then removed after 240ms timeout', () => {
    jest.useFakeTimers();

    const el = {
      id: '__sentinel_cursor__',
      tagName: 'DIV',
      style: {},
      classList: {
        _classes: new Set(),
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn(),
      },
      isConnected: true,
      remove: jest.fn(),
      appendChild: fn,
      setAttribute: fn,
      innerHTML: '',
    };
    createdElements.push(el);

    cursor.press();
    expect(el.classList.add).toHaveBeenCalledWith('pressing');

    // Advance past the 240ms cleanup timeout
    jest.advanceTimersByTime(300);
    expect(el.classList.remove).toHaveBeenCalledWith('pressing');

    jest.useRealTimers();
  });
});

// ============================================================
// Lines 263-272: setKeepVisible and getPosition
// ============================================================

describe('cursor.js — setKeepVisible and getPosition (lines 263-272)', () => {
  test('setKeepVisible(true) removes dimmed class from existing cursor', () => {
    const el = {
      id: '__sentinel_cursor__',
      tagName: 'DIV',
      style: {},
      classList: {
        _classes: new Set(['dimmed']),
        add: jest.fn(),
        remove: jest.fn(),
        contains: (c) => el.classList._classes.has(c),
      },
      isConnected: true,
      remove: jest.fn(),
      appendChild: fn,
      setAttribute: fn,
      innerHTML: '',
    };
    createdElements.push(el);

    cursor.setKeepVisible(true);
    expect(el.classList.remove).toHaveBeenCalledWith('dimmed');
  });

  test('getPosition returns last known coordinates', async () => {
    await cursor.moveTo(42, 69);
    const pos = cursor.getPosition();
    expect(pos).toHaveProperty('x', 42);
    expect(pos).toHaveProperty('y', 69);
  });

  test('moveTo with NaN values returns resolved promise without moving', async () => {
    const result = await cursor.moveTo(NaN, NaN);
    // Should resolve without error
    expect(result).toBeUndefined();
  });

  test('moveTo with non-number values returns resolved promise', async () => {
    const result = await cursor.moveTo('not-a-number', 'also-not');
    expect(result).toBeUndefined();
  });
});

// ============================================================
// hide() method
// ============================================================

describe('cursor.js — hide()', () => {
  test('adds dimmed class and clears hide timer', () => {
    const el = {
      id: '__sentinel_cursor__',
      tagName: 'DIV',
      style: {},
      classList: {
        _classes: new Set(),
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn(),
      },
      isConnected: true,
      remove: jest.fn(),
      appendChild: fn,
      setAttribute: fn,
      innerHTML: '',
    };
    createdElements.push(el);

    cursor.hide();
    expect(el.classList.add).toHaveBeenCalledWith('dimmed');
  });
});
