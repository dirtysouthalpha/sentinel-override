// tests/overlay-detector-branches.test.js
// ESM-import branch coverage for content/overlay-detector.js.
// The VM-based content-overlay-detector.test.js has full semantic coverage but
// contributes 0% to V8/Istanbul because vm.Script runs in a separate context.
// This file imports overlay-detector.js normally so all branches are tracked.
//
// Targets: 5-6, 47, 58-75, 98-106, 132-134, 187, 201-219, 250, 256

import { jest } from '@jest/globals';

// ── Module-level globals — must be set BEFORE the module is imported ─────────
// The IIFE inside overlay-detector.js captures `dom` and `shadow` at import
// time as references to these objects; mutating their methods between tests
// is visible to the closed-over functions.

const mockDom = {
  isVisible: jest.fn(() => true),
};

const mockShadow = {
  queryDeep: jest.fn(() => []),
};

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = {
  dom: mockDom,
  shadow: mockShadow,
  overlay: {},
};

globalThis.KeyboardEvent = class KeyboardEvent {
  constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); }
};
globalThis.MouseEvent = class MouseEvent {
  constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); }
};

await import('../content/overlay-detector.js');
const ov = globalThis.window.__sentinelUtils.overlay;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEl(overrides = {}) {
  return {
    querySelectorAll: jest.fn(() => []),
    getBoundingClientRect: jest.fn(() => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 })),
    click: jest.fn(),
    dispatchEvent: jest.fn(() => true),
    contains: jest.fn(() => false),
    innerText: '',
    textContent: '',
    ...overrides,
  };
}

function makeDoc(overrides = {}) {
  const body = makeEl({ contains: jest.fn(() => true), dispatchEvent: jest.fn(() => true) });
  return {
    querySelectorAll: jest.fn(() => []),
    activeElement: null,
    body,
    documentElement: { clientWidth: 1024, clientHeight: 768 },
    defaultView: {
      innerWidth: 1024,
      innerHeight: 768,
      getComputedStyle: jest.fn(() => ({ position: 'static', zIndex: 'auto', pointerEvents: 'auto' })),
    },
    elementFromPoint: jest.fn(() => null),
    ...overrides,
  };
}

beforeEach(() => {
  mockDom.isVisible.mockReset();
  mockDom.isVisible.mockReturnValue(true);
  mockShadow.queryDeep.mockReset();
  mockShadow.queryDeep.mockReturnValue([]);
});

// ── detectOverlay: shadow DOM paths (lines 47, 62-67, 106-113) ───────────────

describe('detectOverlay — shadow DOM paths', () => {
  test('detects visible aria-modal in shadow DOM — line 47 TRUE branch', () => {
    const shadowModal = makeEl();
    mockShadow.queryDeep.mockReturnValue([shadowModal]);
    expect(ov.detectOverlay(makeDoc())).toBe(shadowModal);
  });

  test('skips invisible aria-modal in shadow DOM — line 50 FALSE branch', () => {
    const shadowModal = makeEl();
    mockDom.isVisible.mockReturnValue(false);
    mockShadow.queryDeep.mockReturnValue([shadowModal]);
    expect(ov.detectOverlay(makeDoc())).toBeNull();
  });

  test('detects visible role=dialog in shadow DOM — lines 62-67', () => {
    const shadowDialog = makeEl();
    mockShadow.queryDeep.mockImplementation((d, sel) =>
      sel === '[role="dialog"], [role="alertdialog"]' ? [shadowDialog] : []
    );
    expect(ov.detectOverlay(makeDoc())).toBe(shadowDialog);
  });

  test('detects cookie banner in shadow DOM — lines 106-113', () => {
    const shadowBanner = makeEl();
    mockShadow.queryDeep.mockImplementation((d, sel) =>
      sel === '.cookie-banner' ? [shadowBanner] : []
    );
    expect(ov.detectOverlay(makeDoc())).toBe(shadowBanner);
  });
});

// ── detectOverlay: role=dialog and z-index paths (lines 58-75) ───────────────

describe('detectOverlay — role=dialog and z-index paths', () => {
  test('detects visible role=dialog element — line 58 TRUE branch', () => {
    const dialog = makeEl();
    const doc = makeDoc({
      querySelectorAll: jest.fn((sel) =>
        sel === '[role="dialog"], [role="alertdialog"]' ? [dialog] : []
      ),
    });
    expect(ov.detectOverlay(doc)).toBe(dialog);
  });

  test('detects high z-index fixed overlay covering viewport — lines 69-91', () => {
    const overlay = makeEl({
      getBoundingClientRect: jest.fn(() => ({ width: 1000, height: 800, left: 0, top: 0 })),
    });
    const doc = makeDoc({
      querySelectorAll: jest.fn((sel) => sel === 'div, section' ? [overlay] : []),
    });
    doc.defaultView.getComputedStyle = jest.fn(() => ({
      position: 'fixed',
      zIndex: '9999',
      pointerEvents: 'auto',
    }));
    expect(ov.detectOverlay(doc)).toBe(overlay);
  });

  test('continues past z-index check when defaultView is null — line 75 TRUE branch', () => {
    const el = makeEl();
    const doc = {
      querySelectorAll: jest.fn((sel) => sel === 'div, section' ? [el] : []),
      body: makeEl(),
      documentElement: {},
      defaultView: null,
    };
    expect(ov.detectOverlay(doc)).toBeNull();
  });
});

// ── detectOverlay: cookie banner paths (lines 98-106) ────────────────────────

describe('detectOverlay — cookie banner paths', () => {
  test('detects visible cookie banner via .cookie-banner selector — line 98 TRUE branch', () => {
    const banner = makeEl();
    const doc = makeDoc({
      querySelectorAll: jest.fn((sel) => sel === '.cookie-banner' ? [banner] : []),
    });
    expect(ov.detectOverlay(doc)).toBe(banner);
  });

  test('catch block for invalid cookie selector does not throw — lines 100-102', () => {
    const doc = makeDoc({
      querySelectorAll: jest.fn((sel) => {
        if (sel === '.cookie-banner') throw new SyntaxError('invalid selector');
        return [];
      }),
    });
    expect(() => ov.detectOverlay(doc)).not.toThrow();
    expect(ov.detectOverlay(doc)).toBeNull();
  });
});

// ── dismissOverlay: activeEl fallback paths (lines 132-134) ──────────────────

describe('dismissOverlay — activeEl fallback paths', () => {
  test('uses documentElement when activeElement and body are null — line 132 third || branch', () => {
    // doc.body is null: !(null && ...) = !null = true → returns true after escape key
    const overlay = makeEl({ querySelectorAll: jest.fn(() => []) });
    const doc = {
      activeElement: null,
      body: null,
      documentElement: makeEl({ dispatchEvent: jest.fn() }),
    };
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });

  test('returns false when activeElement, body, and documentElement are all null — line 134', () => {
    const overlay = makeEl();
    const doc = { activeElement: null, body: null, documentElement: null };
    expect(ov.dismissOverlay(doc, overlay)).toBe(false);
  });
});

// ── dismissOverlay: accept button post-click check (line 187) ────────────────

describe('dismissOverlay — accept button dismissal', () => {
  test('returns true after accept button click dismisses overlay — line 187 TRUE branch', () => {
    const acceptBtn = makeEl();
    const overlay = makeEl({
      querySelectorAll: jest.fn((sel) =>
        sel.includes('accept') || sel.includes('consent') ? [acceptBtn] : []
      ),
    });
    let dismissed = false;
    const doc = makeDoc({
      body: makeEl({
        contains: jest.fn(() => !dismissed),
        dispatchEvent: jest.fn(),
      }),
    });
    acceptBtn.click = jest.fn(() => { dismissed = true; });
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });
});

// ── dismissOverlay: text-match buttons and backdrop click (lines 201-219) ────

describe('dismissOverlay — text-match buttons and backdrop click', () => {
  test('dismisses via button whose textContent matches — lines 201-210, line 201 second || branch', () => {
    // innerText is empty string (falsy) so textContent is used (covers || el.textContent branch)
    const btn = makeEl({ innerText: '', textContent: 'Close' });
    const overlay = makeEl({
      querySelectorAll: jest.fn((sel) =>
        sel === 'button, a, [role="button"]' ? [btn] : []
      ),
    });
    let dismissed = false;
    const doc = makeDoc({
      body: makeEl({
        contains: jest.fn(() => !dismissed),
        dispatchEvent: jest.fn(),
      }),
    });
    btn.click = jest.fn(() => { dismissed = true; });
    btn.dispatchEvent = jest.fn(() => { dismissed = true; });
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });

  test('text-match skips button with empty text — line 201 third || "" branch', () => {
    // Both innerText and textContent empty → text = '' → DISMISS_TEXT_RE.test fails
    const btn = makeEl({ innerText: '', textContent: '' });
    const overlay = makeEl({
      querySelectorAll: jest.fn((sel) =>
        sel === 'button, a, [role="button"]' ? [btn] : []
      ),
      getBoundingClientRect: jest.fn(() => ({ right: 50, bottom: 50 })),
    });
    expect(ov.dismissOverlay(makeDoc(), overlay)).toBe(false);
  });

  test('dismisses via backdrop click when no buttons work — lines 214-226', () => {
    const overlay = makeEl({
      querySelectorAll: jest.fn(() => []),
      getBoundingClientRect: jest.fn(() => ({ right: 100, bottom: 100 })),
    });
    let dismissed = false;
    const doc = makeDoc();
    doc.body.contains = jest.fn(() => !dismissed);
    // backdrop 'click' event on body signals overlay dismissed
    doc.body.dispatchEvent = jest.fn((e) => {
      if (e.type === 'click') dismissed = true;
    });
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });
});

// ── FALSE-path tests: uncovered branches after first pass ────────────────────

describe('detectOverlay — FALSE branches for shadow && queryDeep checks', () => {
  test('shadow has no queryDeep — lines 47/62/106 FALSE via second && operand', () => {
    // shadow is truthy (mockShadow) but queryDeep is absent → && short-circuits to false
    const qd = mockShadow.queryDeep;
    delete mockShadow.queryDeep;
    expect(ov.detectOverlay(makeDoc())).toBeNull();
    mockShadow.queryDeep = qd;
  });

  test('invisible role=dialog skips return, falls through to shadow dialog check — line 58 FALSE → 62', () => {
    const dialog = makeEl();
    mockDom.isVisible.mockReturnValue(false);
    const doc = makeDoc({
      querySelectorAll: jest.fn((sel) =>
        sel === '[role="dialog"], [role="alertdialog"]' ? [dialog] : []
      ),
    });
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('invisible cookie banner skips return, falls through to shadow cookie check — line 98 FALSE → 106', () => {
    const banner = makeEl();
    mockDom.isVisible.mockReturnValue(false);
    const doc = makeDoc({
      querySelectorAll: jest.fn((sel) => sel === '.cookie-banner' ? [banner] : []),
    });
    expect(ov.detectOverlay(doc)).toBeNull();
  });
});

describe('dismissOverlay — backdrop throw when body disappears (line 219 TRUE)', () => {
  test('doc.body null at backdrop section triggers throw caught silently — returns false', () => {
    // With no close/accept/text buttons (all querySelectorAll return []):
    //   access #1: line 132 activeEl = doc.body
    //   access #2: line 138 doc.body && ...
    //   access #3: line 138 doc.body.contains(overlay) — escape check finds overlay still present
    //   access #4: line 219 !doc.body → null → throw → catch → return false
    const overlay = makeEl({
      querySelectorAll: jest.fn(() => []),
      getBoundingClientRect: jest.fn(() => ({ right: 100, bottom: 100 })),
    });
    let accessCount = 0;
    const bodyEl = makeEl({
      contains: jest.fn(() => true),
      dispatchEvent: jest.fn(),
    });
    const doc = {
      activeElement: null,
      get body() { accessCount++; return accessCount <= 3 ? bodyEl : null; },
      documentElement: { clientWidth: 1024, clientHeight: 768 },
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: jest.fn(() => ({ position: 'static', zIndex: 'auto', pointerEvents: 'auto' })) },
      querySelectorAll: jest.fn(() => []),
      elementFromPoint: jest.fn(() => null),
    };
    expect(ov.dismissOverlay(doc, overlay)).toBe(false);
  });
});

describe('dismissOverlay — FALSE paths on post-click overlay-still-present check', () => {
  test('accept button click fails to dismiss — line 187 FALSE, backdrop click succeeds', () => {
    const acceptBtn = makeEl();
    const overlay = makeEl({
      querySelectorAll: jest.fn((sel) => {
        if (sel.includes('accept') || sel.includes('consent')) return [acceptBtn];
        return [];
      }),
      getBoundingClientRect: jest.fn(() => ({ right: 100, bottom: 100 })),
    });
    let dismissed = false;
    const doc = makeDoc({
      body: makeEl({
        contains: jest.fn(() => !dismissed),
        dispatchEvent: jest.fn((e) => { if (e.type === 'click') dismissed = true; }),
      }),
    });
    // acceptBtn.click is jest.fn() by default — does nothing to dismissed
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });

  test('text-match button click fails to dismiss — line 207 FALSE, backdrop click succeeds', () => {
    const btn = makeEl({ innerText: 'Close', textContent: 'Close' });
    const overlay = makeEl({
      querySelectorAll: jest.fn((sel) =>
        sel === 'button, a, [role="button"]' ? [btn] : []
      ),
      getBoundingClientRect: jest.fn(() => ({ right: 100, bottom: 100 })),
    });
    let dismissed = false;
    const doc = makeDoc({
      body: makeEl({
        contains: jest.fn(() => !dismissed),
        dispatchEvent: jest.fn((e) => { if (e.type === 'click') dismissed = true; }),
      }),
    });
    // btn.click is jest.fn() by default — overlay persists
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });
});

// ── isOverlayBlocking: null-guard paths (lines 250, 256) ─────────────────────

describe('isOverlayBlocking — null-guard branches', () => {
  test('returns null when defaultView is null — line 250 TRUE branch', () => {
    const target = makeEl({
      getBoundingClientRect: jest.fn(() => ({ left: 100, top: 100, width: 200, height: 200 })),
    });
    expect(ov.isOverlayBlocking(makeDoc({ defaultView: null }), target)).toBeNull();
  });

  test('returns null when elementFromPoint returns null — line 256 TRUE branch', () => {
    const target = makeEl({
      getBoundingClientRect: jest.fn(() => ({ left: 100, top: 100, width: 200, height: 200 })),
    });
    expect(ov.isOverlayBlocking(makeDoc({ elementFromPoint: jest.fn(() => null) }), target)).toBeNull();
  });
});
