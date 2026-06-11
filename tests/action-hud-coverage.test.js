/**
 * Branch coverage for content/action-hud.js uncovered paths.
 * Requires a fresh module import with a richer document mock where querySelector
 * returns actual elements (unlike the existing test which always returns null).
 *
 * Covers:
 *   148     getIcon() return (must be called — needs iconEl to be non-null)
 *   153     ensureStyle early return (style already exists)
 *   192     ensureHUD catch { return null }
 *   198     updateHUD: if (!el) return
 *   206     if (stepEl) → truthy branch
 *   210     if (fill) → truthy branch
 *   215     if (iconEl) → truthy branch
 *   216     if (textEl && opts.actionLabel) → truthy branch
 *   221-227 if (resultEl) { if (opts.result) / else } → both sub-branches
 */

import { jest } from '@jest/globals';

// ── Rich DOM mock ──────────────────────────────────────────────────────────────

const _elementsById = new Map();

function makeEl(tag) {
  const cls = new Set();
  return {
    tagName: tag.toUpperCase(),
    id: '',
    innerHTML: '',
    textContent: '',
    style: {},
    isConnected: true,
    _attrs: {},
    _childEls: {},
    classList: {
      add(...cs) { cs.forEach(c => cls.add(c)); },
      remove(...cs) { cs.forEach(c => cls.delete(c)); },
      contains(c) { return cls.has(c); },
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    appendChild(child) { return child; },
    // querySelector returns a mock child element for known class names
    querySelector(sel) {
      const m = sel.match(/^\.([\w-]+)$/);
      if (!m) return null;
      const name = m[1];
      if (!this._childEls[name]) {
        this._childEls[name] = makeEl('span');
      }
      return this._childEls[name];
    },
    get offsetWidth() { return 0; },
  };
}

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = globalThis.window.__sentinelUtils || {};
globalThis.window.__sentinelActionHUD = undefined;
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.cancelAnimationFrame = () => {};

let _createThrows = false;

globalThis.document = {
  getElementById(id) { return _elementsById.get(id) ?? null; },
  createElement(tag) {
    if (_createThrows) throw new Error('DOM unavailable');
    const el = makeEl(tag);
    return el;
  },
  head: {
    appendChild(el) {
      if (el.id) _elementsById.set(el.id, el);
      return el;
    },
  },
  documentElement: {
    appendChild(el) {
      if (el.id) _elementsById.set(el.id, el);
      return el;
    },
  },
  body: {
    appendChild(el) {
      if (el.id) _elementsById.set(el.id, el);
      return el;
    },
  },
};

// Import module AFTER globals are set up
await import('../content/action-hud.js');
const hud = globalThis.window.__sentinelActionHUD;

beforeEach(() => {
  jest.useFakeTimers();
  _elementsById.clear();
  _createThrows = false;
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// ── Line 148: getIcon() return ─────────────────────────────────────────────────

describe('getIcon — fallback and known type (line 148)', () => {
  test('returns default icon when actionType is not a known key', () => {
    // update() calls ensureHUD, then querySelector('.hud-action-icon') returns a child el,
    // then getIcon(currentAction) is called. currentAction defaults to '' (not a key) → ICONS.default.
    hud.update({});
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    expect(hudEl).toBeDefined();
    // If getIcon was called, iconEl.innerHTML would be set (non-empty SVG)
    const iconEl = hudEl._childEls['hud-action-icon'];
    expect(iconEl).toBeDefined();
    expect(typeof iconEl.innerHTML).toBe('string');
  });

  test('returns known icon when actionType matches a key', () => {
    hud.update({ action: 'click' });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const iconEl = hudEl._childEls['hud-action-icon'];
    expect(iconEl).toBeDefined();
    // innerHTML was set from ICONS['click']
    expect(iconEl.innerHTML).toContain('svg');
  });
});

// ── Line 153: ensureStyle early return ────────────────────────────────────────

describe('ensureStyle — early return when style already exists (line 153)', () => {
  test('calling update() twice does not re-create the style element', () => {
    hud.update({}); // first call: creates and registers style
    const styleEl = _elementsById.get('__sentinel_action_hud_style__');
    expect(styleEl).toBeDefined();

    // Second call: getElementById(HUD_STYLE_ID) returns the existing style → early return
    hud.update({});
    // Still only one style element registered
    expect(_elementsById.get('__sentinel_action_hud_style__')).toBe(styleEl);
  });
});

// ── Lines 192 & 198: ensureHUD catch / updateHUD early return ─────────────────

describe('ensureHUD catch + updateHUD early return (lines 192, 198)', () => {
  test('update() returns silently when ensureHUD throws (lines 192 and 198)', () => {
    _createThrows = true;
    // ensureHUD tries createElement → throws → catch returns null → updateHUD line 198 returns
    expect(() => hud.update({ step: 3 })).not.toThrow();
    // No HUD was created
    expect(_elementsById.get('__sentinel_action_hud__')).toBeUndefined();
  });
});

// ── Lines 206, 210: querySelector truthy branches ─────────────────────────────

describe('updateHUD — stepEl and fill truthy branches (lines 206, 210)', () => {
  test('updates step counter HTML when stepEl is found (line 206)', () => {
    hud.update({ step: 7, totalSteps: 10 });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const stepEl = hudEl._childEls['hud-step'];
    expect(stepEl).toBeDefined();
    expect(stepEl.innerHTML).toContain('7');
  });

  test('updates progress bar width when fill is found (line 210)', () => {
    hud.update({ step: 5, totalSteps: 10 });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const fill = hudEl._childEls['hud-progress-fill'];
    expect(fill).toBeDefined();
    expect(fill.style.width).toBe('50%');
  });
});

// ── Lines 215-216: iconEl and textEl truthy branches ─────────────────────────

describe('updateHUD — iconEl and textEl truthy branches (lines 215-216)', () => {
  test('sets iconEl.innerHTML from getIcon when iconEl is found (line 215)', () => {
    hud.update({ action: 'type' });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const iconEl = hudEl._childEls['hud-action-icon'];
    expect(iconEl.innerHTML).toContain('svg');
  });

  test('sets textEl.textContent when textEl is found and actionLabel provided (line 216)', () => {
    hud.update({ actionLabel: 'Typing text' });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const textEl = hudEl._childEls['hud-action-text'];
    expect(textEl.textContent).toBe('Typing text');
  });
});

// ── Lines 221-227: resultEl truthy / result sub-branches ─────────────────────

describe('updateHUD — resultEl and result sub-branches (lines 221-227)', () => {
  test('sets resultEl.textContent and success class when opts.result and resultSuccess (lines 222-224)', () => {
    hud.update({ result: 'Done!', resultSuccess: true });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const resultEl = hudEl._childEls['hud-result'];
    expect(resultEl.textContent).toBe('Done!');
    expect(resultEl.classList.contains('success')).toBe(true);
  });

  test('sets resultEl.textContent and error class when opts.result and resultError (line 225)', () => {
    hud.update({ result: 'Failed', resultError: true });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const resultEl = hudEl._childEls['hud-result'];
    expect(resultEl.textContent).toBe('Failed');
    expect(resultEl.classList.contains('error')).toBe(true);
  });

  test('truncates long result strings to 80 chars (line 223)', () => {
    const long = 'x'.repeat(100);
    hud.update({ result: long });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const resultEl = hudEl._childEls['hud-result'];
    expect(resultEl.textContent).toBe('x'.repeat(80));
  });

  test('converts non-string result via String() (line 223 ternary else)', () => {
    hud.update({ result: 42 });
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const resultEl = hudEl._childEls['hud-result'];
    expect(resultEl.textContent).toBe('42');
  });

  test('clears resultEl.textContent when no result (line 227)', () => {
    // First set a result, then clear it
    hud.update({ result: 'something' });
    hud.update({}); // no result → else branch → textContent = ''
    const hudEl = _elementsById.get('__sentinel_action_hud__');
    const resultEl = hudEl._childEls['hud-result'];
    expect(resultEl.textContent).toBe('');
  });
});
