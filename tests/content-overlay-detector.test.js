// tests/content-overlay-detector.test.js
// Unit tests for content/overlay-detector.js — modal/dialog/cookie banner detection and dismissal.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Minimal DOM element mock
function makeElement(tag, attrs = {}) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {},
    classList: {
      _c: [],
      add(c) { if (!this._c.includes(c)) this._c.push(c); },
      remove(c) { this._c = this._c.filter(x => x !== c); },
      toggle(c, force) {
        if (force === true) this.add(c);
        else if (force === false) this.remove(c);
        else if (this.contains(c)) this.remove(c);
        else this.add(c);
      },
      contains(c) { return this._c.includes(c); }
    },
    _attrs: Object.assign({}, attrs),
    _children: [],
    _parent: null,
    _eventLog: [],
    get textContent() { return this._attrs._textContent || ''; },
    set textContent(v) { this._attrs._textContent = v || ''; },
    get innerText() { return this._attrs._innerText || this.textContent; },
    set innerText(v) { this._attrs._innerText = v || ''; },
    getAttribute(n) { return this._attrs[n] !== undefined ? this._attrs[n] : null; },
    setAttribute(n, v) { this._attrs[n] = v; },
    removeAttribute(n) { delete this._attrs[n]; },
    get id() { return this._attrs.id || ''; },
    get className() { return this._attrs.className || ''; },
    appendChild(c) { this._children.push(c); c._parent = this; return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); },
    remove() { if (this._parent) this._parent.removeChild(this); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    dispatchEvent(e) { this._eventLog.push(e); return true; },
    click() { this._eventLog.push({ type: 'click' }); },
    contains(other) { return this._children.includes(other); },
    getBoundingClientRect() {
      return {
        left: 0, top: 0, width: 1200, height: 800,
        right: 1200, bottom: 800
      };
    },
  };
  return el;
}

// Track visibility answers
let _isVisibleResults = new Map();

function createSandbox() {
  _isVisibleResults = new Map();

  const elements = {};
  const elCache = {};
  function getOrCreate(id) {
    if (!elCache[id]) elCache[id] = makeElement('div', { id });
    return elCache[id];
  }

  // Mock dom.isVisible — checks our map first, defaults to true
  function isVisible(el) {
    if (_isVisibleResults.has(el)) return _isVisibleResults.get(el);
    return true;
  }

  const sandbox = {
    window: {},
    console,
    JSON,
    Error,
    TypeError,
    RegExp,
    Object,
    Array,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Map,
    Set,
    MouseEvent: class MouseEvent {
      constructor(type, opts) { this.type = type; this.opts = opts; }
    },
    KeyboardEvent: class KeyboardEvent {
      constructor(type, opts) { this.type = type; this.opts = opts; }
    },
    document: {
      body: makeElement('body'),
      documentElement: makeElement('html'),
      head: makeElement('head'),
      defaultView: null, // set below
      getElementById(id) { return getOrCreate(id); },
      querySelector(sel) { return null; },
      querySelectorAll(sel) { return []; },
      addEventListener() {},
      activeElement: null,
      elementFromPoint() { return null; },
    },
  };

  // Circular ref: document.defaultView references the window-like global
  const viewProxy = {
    get innerWidth() { return 1200; },
    get innerHeight() { return 800; },
    getComputedStyle(el) {
      return {
        position: 'static',
        zIndex: 'auto',
        pointerEvents: 'auto',
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      };
    },
  };
  sandbox.document.defaultView = viewProxy;
  sandbox.document.activeElement = sandbox.document.body;

  // Set up sentinel utils before loading overlay module
  sandbox.window.__sentinelUtils = {
    dom: { isVisible },
    shadow: {
      queryDeep() { return []; },
    },
    overlay: {},
  };
  sandbox.window.__sentinelUtils.overlay = sandbox.window.__sentinelUtils.overlay || {};

  // window reference
  sandbox.window = sandbox.window;
  Object.assign(sandbox.window, {
    __sentinelUtils: sandbox.window.__sentinelUtils,
  });

  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadOverlayModule(sandbox) {
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../content/overlay-detector.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'overlay-detector.js' });
  script.runInContext(sandbox);
  return sandbox;
}

// ========== Tests ==========

describe('overlay-detector — detectOverlay', () => {
  let sandbox, ov;

  beforeEach(() => {
    sandbox = createSandbox();
    loadOverlayModule(sandbox);
    ov = sandbox.window.__sentinelUtils.overlay;
  });

  test('returns null when doc is null', () => {
    expect(ov.detectOverlay(null)).toBeNull();
  });

  test('returns null when doc is undefined', () => {
    expect(ov.detectOverlay(undefined)).toBeNull();
  });

  test('returns null when no overlays present', () => {
    const doc = {
      querySelectorAll: () => [],
      defaultView: { innerWidth: 1200, innerHeight: 800, getComputedStyle: () => ({ position: 'static', zIndex: 'auto', pointerEvents: 'auto' }) },
    };
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('detects visible aria-modal element', () => {
    const modal = makeElement('div', { 'aria-modal': 'true' });
    _isVisibleResults.set(modal, true);
    const doc = {
      querySelectorAll(sel) {
        if (sel === '[aria-modal="true"]') return [modal];
        return [];
      },
      defaultView: { innerWidth: 1200, innerHeight: 800, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(modal);
  });

  test('skips invisible aria-modal element', () => {
    const modal = makeElement('div', { 'aria-modal': 'true' });
    _isVisibleResults.set(modal, false);
    const doc = {
      querySelectorAll(sel) {
        if (sel === '[aria-modal="true"]') return [modal];
        return [];
      },
      defaultView: { innerWidth: 1200, innerHeight: 800, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('detects visible role=dialog element', () => {
    const dialog = makeElement('div');
    _isVisibleResults.set(dialog, true);
    const doc = {
      querySelectorAll(sel) {
        if (sel === '[role="dialog"], [role="alertdialog"]') return [dialog];
        return [];
      },
      defaultView: { innerWidth: 1200, innerHeight: 800, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(dialog);
  });

  test('detects high z-index fixed overlay covering viewport', () => {
    const overlay = makeElement('div');
    _isVisibleResults.set(overlay, true);
    const doc = {
      querySelectorAll(sel) {
        if (sel === 'div, section') return [overlay];
        return [];
      },
      defaultView: {
        innerWidth: 1200,
        innerHeight: 800,
        getComputedStyle() {
          return { position: 'fixed', zIndex: '9999', pointerEvents: 'auto' };
        },
      },
    };
    // Override bounding rect to cover viewport
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0, right: 1200, bottom: 800 });
    expect(ov.detectOverlay(doc)).toBe(overlay);
  });

  test('skips overlay with pointerEvents none', () => {
    const overlay = makeElement('div');
    const doc = {
      querySelectorAll(sel) {
        if (sel === 'div, section') return [overlay];
        return [];
      },
      defaultView: {
        innerWidth: 1200,
        innerHeight: 800,
        getComputedStyle() {
          return { position: 'fixed', zIndex: '9999', pointerEvents: 'none' };
        },
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('skips overlay with low z-index', () => {
    const overlay = makeElement('div');
    const doc = {
      querySelectorAll(sel) {
        if (sel === 'div, section') return [overlay];
        return [];
      },
      defaultView: {
        innerWidth: 1200,
        innerHeight: 800,
        getComputedStyle() {
          return { position: 'fixed', zIndex: '500', pointerEvents: 'auto' };
        },
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('skips overlay that does not cover enough of viewport', () => {
    const overlay = makeElement('div');
    const doc = {
      querySelectorAll(sel) {
        if (sel === 'div, section') return [overlay];
        return [];
      },
      defaultView: {
        innerWidth: 1200,
        innerHeight: 800,
        getComputedStyle() {
          return { position: 'fixed', zIndex: '9999', pointerEvents: 'auto' };
        },
      },
    };
    overlay.getBoundingClientRect = () => ({ width: 100, height: 100, left: 0, top: 0 });
    expect(ov.detectOverlay(doc)).toBeNull();
  });

  test('detects cookie banner via cookie selector', () => {
    const banner = makeElement('div', { className: 'cookie-banner' });
    _isVisibleResults.set(banner, true);
    const doc = {
      querySelectorAll(sel) {
        if (sel === '[class*="cookie" i]') return [banner];
        return [];
      },
      defaultView: { innerWidth: 1200, innerHeight: 800, getComputedStyle: () => ({}) },
    };
    expect(ov.detectOverlay(doc)).toBe(banner);
  });

  test('getComputedStyle error does not crash', () => {
    const overlay = makeElement('div');
    const doc = {
      querySelectorAll(sel) {
        if (sel === 'div, section') return [overlay];
        return [];
      },
      defaultView: {
        innerWidth: 1200,
        innerHeight: 800,
        getComputedStyle() { throw new Error('security'); },
      },
    };
    // Should not throw
    expect(ov.detectOverlay(doc)).toBeNull();
  });
});

describe('overlay-detector — dismissOverlay', () => {
  let sandbox, ov;

  beforeEach(() => {
    sandbox = createSandbox();
    loadOverlayModule(sandbox);
    ov = sandbox.window.__sentinelUtils.overlay;
  });

  test('returns false when overlay is null', () => {
    expect(ov.dismissOverlay({}, null)).toBe(false);
  });

  test('returns false when overlay is undefined', () => {
    expect(ov.dismissOverlay({}, undefined)).toBe(false);
  });

  test('returns false when overlay cannot be dismissed', () => {
    const overlay = makeElement('div');
    overlay.querySelectorAll = () => [];
    const doc = {
      body: { contains: () => true },
      activeElement: overlay,
    };
    _isVisibleResults.set(overlay, true);
    expect(ov.dismissOverlay(doc, overlay)).toBe(false);
  });

  test('dismisses via close button that removes overlay from DOM', () => {
    const overlay = makeElement('div');
    const closeBtn = makeElement('button');
    _isVisibleResults.set(closeBtn, true);
    _isVisibleResults.set(overlay, true);
    let dismissed = false;
    closeBtn.click = () => { dismissed = true; };
    closeBtn.dispatchEvent = () => { dismissed = true; };
    overlay.querySelectorAll = (sel) => {
      if (sel.includes('close') || sel.includes('Close') || sel.includes('dismiss') || sel.includes('Dismiss')) return [closeBtn];
      return [];
    };
    const doc = {
      body: { contains: () => !dismissed },
      activeElement: overlay,
    };
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });

  test('dismisses via text-match button (Close/OK/Dismiss)', () => {
    const overlay = makeElement('div');
    const btn = makeElement('button');
    btn.innerText = 'Close';
    _isVisibleResults.set(btn, true);
    _isVisibleResults.set(overlay, true);
    overlay.querySelectorAll = (sel) => {
      if (sel === 'button, a, [role="button"]') return [btn];
      if (sel.includes('close') || sel.includes('accept') || sel.includes('consent')) return [];
      return [];
    };
    let dismissed = false;
    const doc = {
      body: { contains: () => !dismissed },
      activeElement: overlay,
    };
    btn.click = () => { dismissed = true; };
    btn.dispatchEvent = () => { dismissed = true; };
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });

  test('dismisses via accept button text', () => {
    const overlay = makeElement('div');
    const btn = makeElement('button');
    btn.innerText = 'Accept';
    _isVisibleResults.set(btn, true);
    _isVisibleResults.set(overlay, true);
    overlay.querySelectorAll = (sel) => {
      if (sel === 'button, a, [role="button"]') return [btn];
      return [];
    };
    let dismissed = false;
    const doc = {
      body: { contains: () => !dismissed },
      activeElement: overlay,
    };
    btn.click = () => { dismissed = true; };
    btn.dispatchEvent = () => { dismissed = true; };
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });

  test('tries Escape key as last resort', () => {
    const overlay = makeElement('div');
    overlay.querySelectorAll = () => [];
    let dismissed = false;
    const activeEl = {
      dispatchEvent(e) {
        if (e.type === 'keyup') dismissed = true;
      },
    };
    const doc = {
      body: { contains: () => !dismissed },
      activeElement: activeEl,
    };
    expect(ov.dismissOverlay(doc, overlay)).toBe(true);
  });
});

describe('overlay-detector — isOverlayBlocking', () => {
  let sandbox, ov;

  beforeEach(() => {
    sandbox = createSandbox();
    loadOverlayModule(sandbox);
    ov = sandbox.window.__sentinelUtils.overlay;
  });

  test('returns null when doc is null', () => {
    expect(ov.isOverlayBlocking(null, makeElement('div'))).toBeNull();
  });

  test('returns null when targetEl is null', () => {
    expect(ov.isOverlayBlocking({}, null)).toBeNull();
  });

  test('returns null when both are null', () => {
    expect(ov.isOverlayBlocking(null, null)).toBeNull();
  });

  test('returns null when target is the topmost element (not blocked)', () => {
    const target = makeElement('div');
    target.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 50 });
    target.contains = () => true;
    const doc = {
      defaultView: { innerWidth: 1200, innerHeight: 800 },
      elementFromPoint: () => target,
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });

  test('returns blocking element when something is on top', () => {
    const target = makeElement('div');
    target.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 50 });
    target.contains = () => false;
    const blocker = makeElement('div');
    const doc = {
      defaultView: { innerWidth: 1200, innerHeight: 800 },
      elementFromPoint: () => blocker,
    };
    expect(ov.isOverlayBlocking(doc, target)).toBe(blocker);
  });

  test('returns null when top element is body (not an overlay)', () => {
    const target = makeElement('div');
    target.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 50 });
    target.contains = () => false;
    const body = makeElement('body');
    const doc = {
      defaultView: { innerWidth: 1200, innerHeight: 800 },
      elementFromPoint: () => body,
      body,
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });

  test('returns null when top element is documentElement', () => {
    const target = makeElement('div');
    target.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 50 });
    target.contains = () => false;
    const html = makeElement('html');
    const doc = {
      defaultView: { innerWidth: 1200, innerHeight: 800 },
      elementFromPoint: () => html,
      documentElement: html,
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });

  test('returns null when target center is outside viewport (negative)', () => {
    const target = makeElement('div');
    target.getBoundingClientRect = () => ({ left: -200, top: -200, width: 100, height: 100 });
    const doc = {
      defaultView: { innerWidth: 1200, innerHeight: 800 },
      elementFromPoint: () => null,
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });

  test('returns null when target center exceeds viewport bounds', () => {
    const target = makeElement('div');
    target.getBoundingClientRect = () => ({ left: 2000, top: 1000, width: 200, height: 200 });
    const doc = {
      defaultView: { innerWidth: 1200, innerHeight: 800 },
      elementFromPoint: () => null,
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });

  test('returns null when getBoundingClientRect throws', () => {
    const target = makeElement('div');
    target.getBoundingClientRect = () => { throw new Error('detached'); };
    const doc = {
      defaultView: { innerWidth: 1200, innerHeight: 800 },
      elementFromPoint: () => null,
    };
    expect(ov.isOverlayBlocking(doc, target)).toBeNull();
  });
});
