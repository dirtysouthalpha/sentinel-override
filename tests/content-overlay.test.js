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
    globalThis.window.__sentinelUtils.dom = { isVisible: () => true };
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
    };
    const doc = {
      body: { contains: () => false },
      activeElement: { dispatchEvent: fn },
    };
    const result = ov.dismissOverlay(doc, overlay);
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
