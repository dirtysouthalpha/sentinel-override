// tests/content-overlay.test.js
// Unit tests for content/overlay-detector.js — detectOverlay, dismissOverlay, isOverlayBlocking.

import { jest } from '@jest/globals';

const fn = () => {};

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = {
  overlay: {},
  dom: { isVisible: () => true },
  shadow: { queryDeep: () => [] },
};

globalThis.MouseEvent = class MouseEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts); } };
globalThis.KeyboardEvent = class KeyboardEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts); } };

let ov;
beforeAll(async () => {
  await import('../content/overlay-detector.js');
  ov = globalThis.window.__sentinelUtils.overlay;
});

describe('ov.detectOverlay', () => {
  test('returns null for null doc', () => {
    expect(ov.detectOverlay(null)).toBeNull();
  });

  test('returns null for empty document', () => {
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('detects aria-modal="true" element', () => {
    const modal = { tagName: 'DIV', classList: { add: fn, remove: fn } };
    const doc = {
      querySelectorAll: (sel) => sel === '[aria-modal="true"]' ? [modal] : [],
      defaultView: { innerWidth: 1024, innerHeight: 768 },
    };
    expect(ov.detectOverlay(doc)).toBe(modal);
  });

  test('detects role="dialog" element', () => {
    const dialog = { tagName: 'DIV', classList: { add: fn, remove: fn } };
    const doc = {
      querySelectorAll: (sel) => {
        if (sel === '[aria-modal="true"]') return [];
        if (sel === '[role="dialog"], [role="alertdialog"]') return [dialog];
        return [];
      },
      defaultView: { innerWidth: 1024, innerHeight: 768 },
    };
    expect(ov.detectOverlay(doc)).toBe(dialog);
  });

  test('detects cookie banner', () => {
    const banner = { tagName: 'DIV', classList: { add: fn, remove: fn } };
    const doc = {
      querySelectorAll: (sel) => {
        if (sel === '[aria-modal="true"]') return [];
        if (sel === '[role="dialog"], [role="alertdialog"]') return [];
        if (sel === 'div, section') return [];
        if (sel === '.cookie-banner') return [banner];
        return [];
      },
      defaultView: { innerWidth: 1024, innerHeight: 768 },
    };
    expect(ov.detectOverlay(doc)).toBe(banner);
  });
});

describe('ov.dismissOverlay', () => {
  test('returns false for null overlay', () => {
    expect(ov.dismissOverlay({}, null)).toBe(false);
  });

  test('returns false for overlay with no close buttons', () => {
    const overlay = {
      querySelectorAll: () => [],
      innerText: '',
      textContent: '',
    };
    const doc = {
      body: { contains: () => true },
      activeElement: { dispatchEvent: fn },
    };
    expect(ov.dismissOverlay(doc, overlay)).toBe(false);
  });

  test('clicks close button when found', () => {
    const closeBtn = { click: jest.fn(), dispatchEvent: jest.fn() };
    const overlay = {
      querySelectorAll: (sel) => {
        if (sel === '[aria-label="Close" i]' || sel === 'button.close') return [closeBtn];
        if (sel === 'button, a, [role="button"]') return [];
        return [];
      },
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 400, bottom: 300, width: 300, height: 200 }),
    };
    // contains: () => true — overlay persists after Escape so execution reaches close buttons
    const doc = {
      body: { contains: () => true, dispatchEvent: jest.fn() },
      activeElement: { dispatchEvent: fn },
    };
    ov.dismissOverlay(doc, overlay);
    expect(closeBtn.click).toHaveBeenCalled();
  });
});

describe('ov.isOverlayBlocking', () => {
  test('returns null for null doc', () => {
    expect(ov.isOverlayBlocking(null, {})).toBeNull();
  });

  test('returns null for null targetEl', () => {
    expect(ov.isOverlayBlocking({}, null)).toBeNull();
  });

  test('returns null when target is the top element', () => {
    const target = {
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30 }),
    };
    const doc = {
      defaultView: { innerWidth: 1024, innerHeight: 768 },
      elementFromPoint: () => target,
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });

  test('returns blocking element when something is on top', () => {
    const target = {
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30 }),
      contains: () => false,
    };
    const blocker = { tagName: 'DIV' };
    const doc = {
      defaultView: { innerWidth: 1024, innerHeight: 768 },
      elementFromPoint: () => blocker,
      body: {},
      documentElement: {},
    };
    expect(ov.isOverlayBlocking(doc, target)).toBe(blocker);
  });

  test('returns null when top element is body or documentElement', () => {
    const target = {
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30 }),
      contains: () => false,
    };
    const body = {};
    const doc = {
      defaultView: { innerWidth: 1024, innerHeight: 768 },
      elementFromPoint: () => body,
      body: body,
      documentElement: {},
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });

  test('returns null when target center is outside viewport', () => {
    const target = {
      getBoundingClientRect: () => ({ left: -200, top: -200, width: 100, height: 30 }),
    };
    const doc = {
      defaultView: { innerWidth: 1024, innerHeight: 768 },
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });

  test('returns null on elementFromPoint error', () => {
    const target = {
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30 }),
    };
    const doc = {
      defaultView: { innerWidth: 1024, innerHeight: 768 },
      elementFromPoint: () => { throw new Error('fail'); },
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });
});

// ========== Shadow DOM detection ==========

describe('ov.detectOverlay — shadow DOM', () => {
  const origQueryDeep = globalThis.window.__sentinelUtils.shadow.queryDeep;
  const origIsVisible = globalThis.window.__sentinelUtils.dom.isVisible;

  afterEach(() => {
    globalThis.window.__sentinelUtils.shadow.queryDeep = origQueryDeep;
    globalThis.window.__sentinelUtils.dom.isVisible = origIsVisible;
  });

  test('detects aria-modal inside shadow DOM', () => {
    const modal = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.shadow.queryDeep = (doc, sel) => {
      if (sel === '[aria-modal="true"]') return [modal];
      return [];
    };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(modal);
  });

  test('detects role=dialog inside shadow DOM', () => {
    const dialog = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.shadow.queryDeep = (doc, sel) => {
      if (sel === '[role="dialog"], [role="alertdialog"]') return [dialog];
      return [];
    };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(dialog);
  });

  test('detects cookie banner inside shadow DOM', () => {
    const banner = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.shadow.queryDeep = (doc, sel) => {
      if (sel === '.cookie-banner') return [banner];
      return [];
    };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(banner);
  });
});

// ========== High z-index overlay detection ==========

describe('ov.detectOverlay — high z-index overlays', () => {
  const origIsVisible = globalThis.window.__sentinelUtils.dom.isVisible;

  afterEach(() => {
    globalThis.window.__sentinelUtils.dom.isVisible = origIsVisible;
  });

  test('detects fixed-position overlay with high z-index', () => {
    const overlay = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [overlay] : [],
      defaultView: {
        innerWidth: 1200, innerHeight: 800,
        getComputedStyle: () => ({ position: 'fixed', zIndex: '9999', pointerEvents: 'auto' }),
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBe(overlay);
  });

  test('detects absolute-position overlay with high z-index', () => {
    const overlay = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [overlay] : [],
      defaultView: {
        innerWidth: 1200, innerHeight: 800,
        getComputedStyle: () => ({ position: 'absolute', zIndex: '5000', pointerEvents: 'auto' }),
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBe(overlay);
  });

  test('uses clientWidth fallback when innerWidth is 0', () => {
    const overlay = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [overlay] : [],
      defaultView: {
        innerWidth: 0, innerHeight: 0,
        getComputedStyle: () => ({ position: 'fixed', zIndex: '9999', pointerEvents: 'auto' }),
      },
      documentElement: { clientWidth: 1200, clientHeight: 800 },
    };
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBe(overlay);
  });

  test('skips overlay with pointer-events none', () => {
    const overlay = { tagName: 'DIV' };
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [overlay] : [],
      defaultView: {
        innerWidth: 1200, innerHeight: 800,
        getComputedStyle: () => ({ position: 'fixed', zIndex: '9999', pointerEvents: 'none' }),
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('skips overlay with low z-index', () => {
    const overlay = { tagName: 'DIV' };
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [overlay] : [],
      defaultView: {
        innerWidth: 1200, innerHeight: 800,
        getComputedStyle: () => ({ position: 'fixed', zIndex: '500', pointerEvents: 'auto' }),
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('skips overlay not covering enough viewport', () => {
    const overlay = { tagName: 'DIV' };
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [overlay] : [],
      defaultView: {
        innerWidth: 1200, innerHeight: 800,
        getComputedStyle: () => ({ position: 'fixed', zIndex: '9999', pointerEvents: 'auto' }),
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 100, height: 100, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('handles getComputedStyle error', () => {
    const overlay = { tagName: 'DIV' };
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [overlay] : [],
      defaultView: {
        innerWidth: 1200, innerHeight: 800,
        getComputedStyle: () => { throw new Error('security'); },
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBeNull();
  });
});

// ========== dismissOverlay — accept buttons, text-match, escape edge cases ==========

describe('ov.dismissOverlay — extended paths', () => {
  const origIsVisible = globalThis.window.__sentinelUtils.dom.isVisible;

  afterEach(() => {
    globalThis.window.__sentinelUtils.dom.isVisible = origIsVisible;
  });

  test('continues past selector errors in close button phase', () => {
    let callCount = 0;
    const overlay = {
      querySelectorAll: () => {
        callCount++;
        if (callCount <= 2) throw new Error('bad selector');
        return [];
      },
    };
    const doc = {
      body: { contains: () => true },
      activeElement: { dispatchEvent: fn },
    };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    expect(ov.dismissOverlay(doc, overlay)).toBe(false);
  });

  test('continues past selector errors in accept button phase', () => {
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    const overlay = {
      querySelectorAll: (sel) => {
        // Close selectors return empty, accept selectors throw
        if (sel.includes('cookie-banner') || sel.includes('consent') || sel.includes('accept') || sel.includes('onetrust')) {
          throw new Error('bad accept selector');
        }
        return [];
      },
    };
    const doc = {
      body: { contains: () => true },
      activeElement: { dispatchEvent: fn },
    };
    // Should not throw; catch block continues the loop and falls through to text-match/Escape
    expect(() => ov.dismissOverlay(doc, overlay)).not.toThrow();
  });

  test('dismisses via accept button', () => {
    const acceptBtn = { click: jest.fn(), dispatchEvent: jest.fn() };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    let dismissed = false;
    const overlay = {
      querySelectorAll: (sel) => {
        if (sel.includes('close') || sel.includes('Close') || sel.includes('dismiss') || sel.includes('Dismiss')) return [];
        if (sel.includes('accept')) return [acceptBtn];
        return [];
      },
    };
    const doc = {
      body: { contains: () => !dismissed },
      activeElement: { dispatchEvent: fn },
    };
    acceptBtn.click.mockImplementation(() => { dismissed = true; });
    acceptBtn.dispatchEvent.mockImplementation(() => { dismissed = true; });
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
    expect(acceptBtn.click).toHaveBeenCalled();
  });

  test('dismisses via text-match button with "ok" text', () => {
    const btn = { click: jest.fn(), dispatchEvent: jest.fn(), innerText: 'ok', textContent: 'ok' };
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    let dismissed = false;
    const overlay = {
      querySelectorAll: (sel) => {
        if (sel === 'button, a, [role="button"]') return [btn];
        return [];
      },
    };
    const doc = {
      body: { contains: () => !dismissed },
      activeElement: { dispatchEvent: fn },
    };
    btn.click.mockImplementation(() => { dismissed = true; });
    btn.dispatchEvent.mockImplementation(() => { dismissed = true; });
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
    expect(btn.click).toHaveBeenCalled();
  });

  test('skips invisible text-match button', () => {
    const invisibleBtn = { click: jest.fn(), dispatchEvent: jest.fn(), innerText: 'Close', textContent: 'Close' };
    const visMap = new Map();
    visMap.set(invisibleBtn, false);
    globalThis.window.__sentinelUtils.dom.isVisible = (el) => visMap.has(el) ? visMap.get(el) : true;
    const overlay = {
      querySelectorAll: (sel) => {
        if (sel === 'button, a, [role="button"]') return [invisibleBtn];
        return [];
      },
    };
    const doc = {
      body: { contains: () => true },
      activeElement: { dispatchEvent: fn },
    };
    expect(ov.dismissOverlay(doc, overlay)).toBe(false);
    expect(invisibleBtn.click).not.toHaveBeenCalled();
  });

  test('returns true when Escape key dismisses overlay', () => {
    let dismissed = false;
    const overlay = { querySelectorAll: () => [] };
    const doc = {
      body: { contains: () => !dismissed },
      activeElement: { dispatchEvent: () => { dismissed = true; } },
    };
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });

  test('uses doc.body when activeElement is null for Escape key', () => {
    let dismissed = false;
    const body = {
      contains: () => !dismissed,
      dispatchEvent: () => { dismissed = true; },
    };
    const overlay = { querySelectorAll: () => [] };
    const doc = { body, activeElement: null };
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });

  test('invisible close button is skipped via continue (line 139)', () => {
    const invisibleBtn = { click: jest.fn(), dispatchEvent: jest.fn(), innerText: '' };
    globalThis.window.__sentinelUtils.dom.isVisible = (el) => el !== invisibleBtn;
    const overlay = {
      querySelectorAll: (sel) => {
        if (sel.includes('close') || sel.includes('Close') || sel.includes('dismiss') || sel.includes('Dismiss')) return [invisibleBtn];
        return [];
      },
    };
    const doc = { body: { contains: () => true }, activeElement: { dispatchEvent: fn } };
    const result = ov.dismissOverlay(doc, overlay);
    expect(invisibleBtn.click).not.toHaveBeenCalled();
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    expect(result).toBe(false);
  });

  test('invisible accept button is skipped via continue (line 166)', () => {
    const invisibleAccept = { click: jest.fn(), dispatchEvent: jest.fn() };
    globalThis.window.__sentinelUtils.dom.isVisible = (el) => el !== invisibleAccept;
    const overlay = {
      querySelectorAll: (sel) => {
        if (sel.includes('accept') || sel.includes('consent')) return [invisibleAccept];
        return [];
      },
    };
    const doc = { body: { contains: () => true }, activeElement: { dispatchEvent: fn } };
    const result = ov.dismissOverlay(doc, overlay);
    expect(invisibleAccept.click).not.toHaveBeenCalled();
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    expect(result).toBe(false);
  });
});

describe('ov.detectOverlay — additional branches', () => {
  test('aria-modal found but invisible returns null (line 40 false branch)', () => {
    const modal = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.dom.isVisible = () => false;
    const doc = {
      querySelectorAll: (sel) => sel === '[aria-modal="true"]' ? [modal] : [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({ position: 'static', zIndex: 'auto', pointerEvents: 'auto' }) },
    };
    expect(ov.detectOverlay(doc)).toBeNull();
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
  });

  test('detects aria-modal in shadow DOM (lines 44-48)', () => {
    const shadowModal = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.shadow.queryDeep = (doc, sel) =>
      sel === '[aria-modal="true"]' ? [shadowModal] : [];
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(shadowModal);
    globalThis.window.__sentinelUtils.shadow.queryDeep = () => [];
  });

  test('shadow aria-modal found but invisible returns null', () => {
    const shadowModal = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.dom.isVisible = (el) => el !== shadowModal;
    globalThis.window.__sentinelUtils.shadow.queryDeep = (doc, sel) =>
      sel === '[aria-modal="true"]' ? [shadowModal] : [];
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBeNull();
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    globalThis.window.__sentinelUtils.shadow.queryDeep = () => [];
  });

  test('detects role=dialog in shadow DOM (lines 59-63)', () => {
    const shadowDialog = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.shadow.queryDeep = (doc, sel) =>
      sel === '[role="dialog"], [role="alertdialog"]' ? [shadowDialog] : [];
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(shadowDialog);
    globalThis.window.__sentinelUtils.shadow.queryDeep = () => [];
  });

  test('non-numeric zIndex falls back to 0 via || 0 (line 73)', () => {
    const el = {
      getBoundingClientRect: () => ({ width: 1024, height: 768, left: 0, top: 0 }),
    };
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [el] : [],
      defaultView: {
        innerWidth: 1024, innerHeight: 768,
        getComputedStyle: () => ({ position: 'fixed', zIndex: 'notanumber', pointerEvents: 'auto' }),
      },
    };
    // parseInt('notanumber') = NaN → NaN || 0 = 0 → 0 <= MIN_BLOCKING_Z_INDEX → skip
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('high z-index overlay invisible returns null (line 81-82 false branch)', () => {
    const overlay = {
      getBoundingClientRect: () => ({ width: 1024, height: 768, left: 0, top: 0 }),
    };
    globalThis.window.__sentinelUtils.dom.isVisible = () => false;
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [overlay] : [],
      defaultView: {
        innerWidth: 1024, innerHeight: 768,
        getComputedStyle: () => ({ position: 'fixed', zIndex: '9999', pointerEvents: 'auto' }),
      },
    };
    expect(ov.detectOverlay(doc)).toBeNull();
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
  });

  test('detects cookie banner in shadow DOM (lines 101-108)', () => {
    const shadowBanner = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.shadow.queryDeep = (doc, sel) =>
      sel === '.cookie-banner' ? [shadowBanner] : [];
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(shadowBanner);
    globalThis.window.__sentinelUtils.shadow.queryDeep = () => [];
  });

  test('shadow cookie banner found but invisible skips it (line 106 false branch)', () => {
    const shadowBanner = { tagName: 'DIV' };
    globalThis.window.__sentinelUtils.dom.isVisible = (el) => el !== shadowBanner;
    globalThis.window.__sentinelUtils.shadow.queryDeep = (doc, sel) =>
      sel === '.cookie-banner' ? [shadowBanner] : [];
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1024, innerHeight: 768, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBeNull();
    globalThis.window.__sentinelUtils.dom.isVisible = () => true;
    globalThis.window.__sentinelUtils.shadow.queryDeep = () => [];
  });

  test('position not fixed or absolute continues past element (line 72)', () => {
    const el = {
      getBoundingClientRect: () => ({ width: 1024, height: 768, left: 0, top: 0 }),
    };
    const doc = {
      querySelectorAll: (sel) => sel === 'div, section' ? [el] : [],
      defaultView: {
        innerWidth: 1024, innerHeight: 768,
        getComputedStyle: () => ({ position: 'relative', zIndex: '9999', pointerEvents: 'auto' }),
      },
    };
    expect(ov.detectOverlay(doc)).toBeNull();
  });
});
