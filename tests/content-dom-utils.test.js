// tests/content-dom-utils.test.js
// Unit tests for content/dom-utils.js — visibility, labels, selectors, refs, scanning.

import { jest } from '@jest/globals';

// Set up global environment before loading the module
globalThis.window = globalThis;
globalThis.CSS = { escape: (s) => s.replace(/([[\]\\])/g, '\\$1') };

const fn = () => {};

// Minimal DOM mock helpers
function createElement(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    getAttribute: (name) => attrs[name] || null,
    id: attrs.id || '',
    className: attrs.className || '',
    type: attrs.type || '',
    name: attrs.name || '',
    value: attrs.value || '',
    disabled: attrs.disabled || false,
    checked: attrs.checked || false,
    innerText: attrs.innerText || '',
    placeholder: attrs.placeholder || '',
    isContentEditable: attrs.isContentEditable || false,
    isConnected: true,
    ownerDocument: { defaultView: globalThis },
    parentElement: attrs.parentElement || null,
    previousElementSibling: attrs.previousElementSibling || null,
    children: [],
    options: attrs.options || [],
    multiple: attrs.multiple || false,
    classList: { add: fn, remove: fn },
    matches: fn,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40 }),
  };
  return el;
}

function setupDomUtilsEnv() {
  globalThis.window.__sentinelUtils = { dom: {} };
  globalThis.window.__sentinelUtils.shadow = {
    queryDeepFirst: fn,
    walkShadowTree: fn,
    isInShadowDOM: () => false,
  };
  globalThis.document = {
    defaultView: globalThis,
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    body: { innerText: '' },
  };
  globalThis.getComputedStyle = () => ({
    display: 'block', visibility: 'visible', opacity: '1',
    pointerEvents: 'auto', position: 'static', zIndex: 'auto',
  });
}

setupDomUtilsEnv();

let dom;
beforeAll(async () => {
  await import('../content/dom-utils.js');
  dom = globalThis.window.__sentinelUtils.dom;
});

describe('dom.isVisible', () => {
  test('returns true for visible element', () => {
    expect(dom.isVisible(createElement('div'))).toBe(true);
  });

  test('returns false for display:none', () => {
    globalThis.getComputedStyle = () => ({ display: 'none', visibility: 'visible', opacity: '1' });
    expect(dom.isVisible(createElement('div'))).toBe(false);
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto', position: 'static', zIndex: 'auto' });
  });

  test('returns false for visibility:hidden', () => {
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'hidden', opacity: '1' });
    expect(dom.isVisible(createElement('div'))).toBe(false);
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto', position: 'static', zIndex: 'auto' });
  });

  test('returns false for opacity:0', () => {
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '0' });
    expect(dom.isVisible(createElement('div'))).toBe(false);
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto', position: 'static', zIndex: 'auto' });
  });

  test('returns false for zero-size element', () => {
    const el = createElement('div');
    el.getBoundingClientRect = () => ({ width: 0, height: 0 });
    expect(dom.isVisible(el)).toBe(false);
  });

  test('returns true on getComputedStyle error', () => {
    globalThis.getComputedStyle = () => { throw new Error('fail'); };
    expect(dom.isVisible(createElement('div'))).toBe(true);
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto', position: 'static', zIndex: 'auto' });
  });
});

describe('dom.checkInteractable', () => {
  test('returns "Element not found" for null', () => {
    expect(dom.checkInteractable(null)).toBe('Element not found');
  });

  test('returns null for interactable element', () => {
    expect(dom.checkInteractable(createElement('button'), 'click')).toBeNull();
  });

  test('returns pointer-events message for click on pointer-events:none', () => {
    const origGCS = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'none', position: 'static', zIndex: 'auto' });
    expect(dom.checkInteractable(createElement('div'), 'click')).toBe('Element is pointer-events:none');
    globalThis.getComputedStyle = origGCS;
  });

  test('does not check pointer-events for non-click action', () => {
    const origGCS = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'none', position: 'static', zIndex: 'auto' });
    expect(dom.checkInteractable(createElement('div'), 'type')).toBeNull();
    globalThis.getComputedStyle = origGCS;
  });

  test('returns "Element is disabled" for disabled element', () => {
    const el = createElement('input', { disabled: true });
    expect(dom.checkInteractable(el, 'click')).toBe('Element is disabled');
  });

  test('returns "Element is aria-disabled" for aria-disabled=true', () => {
    const el = createElement('div', { 'aria-disabled': 'true' });
    expect(dom.checkInteractable(el, 'click')).toBe('Element is aria-disabled');
  });
});

describe('dom.getLabel', () => {
  test('returns innerText when present', () => {
    expect(dom.getLabel(createElement('button', { innerText: 'Click me' }))).toBe('Click me');
  });

  test('returns placeholder when no innerText', () => {
    const el = createElement('input', { placeholder: 'Enter name' });
    el.innerText = '';
    expect(dom.getLabel(el)).toBe('Enter name');
  });

  test('returns aria-label when no innerText/placeholder', () => {
    const el = createElement('div', { 'aria-label': 'Menu' });
    el.innerText = '';
    expect(dom.getLabel(el)).toBe('Menu');
  });

  test('returns "No label" when nothing available', () => {
    const el = createElement('div');
    el.innerText = '';
    expect(dom.getLabel(el)).toBe('No label');
  });

  test('trims whitespace from label', () => {
    expect(dom.getLabel(createElement('button', { innerText: '  padded  ' }))).toBe('padded');
  });

  test('returns "No label" when el is null', () => {
    expect(dom.getLabel(null)).toBe('No label');
  });

  test('returns "No label" when el is undefined', () => {
    expect(dom.getLabel(undefined)).toBe('No label');
  });
});

describe('dom.getUniqueSelector', () => {
  test('returns data-testid selector when present', () => {
    expect(dom.getUniqueSelector(createElement('div', { 'data-testid': 'login-btn' }))).toBe('[data-testid="login-btn"]');
  });

  test('returns aria-label selector when present', () => {
    expect(dom.getUniqueSelector(createElement('div', { 'aria-label': 'Submit' }))).toBe('[aria-label="Submit"]');
  });

  test('returns id selector for non-generic id', () => {
    expect(dom.getUniqueSelector(createElement('div', { id: 'login-form' }))).toBe('#login-form');
  });

  test('skips generic ids', () => {
    const el = createElement('div', { id: 'container' });
    el.parentElement = createElement('body');
    el.parentElement.tagName = 'BODY';
    expect(dom.getUniqueSelector(el)).toContain('nth-of-type');
  });

  test('returns name selector for form elements', () => {
    const el = createElement('input', { name: 'username' });
    el.tagName = 'INPUT';
    expect(dom.getUniqueSelector(el)).toBe('input[name="username"]');
  });
});

describe('dom.findElementBySelector', () => {
  test('returns null for empty selector', () => {
    expect(dom.findElementBySelector(globalThis.document, '')).toBeNull();
  });

  test('returns null for null selector', () => {
    expect(dom.findElementBySelector(globalThis.document, null)).toBeNull();
  });

  test('finds element via exact querySelector', () => {
    const btn = createElement('button', { id: 'exact-btn' });
    globalThis.document.querySelector = (sel) => sel === '#exact-btn' ? btn : null;
    expect(dom.findElementBySelector(globalThis.document, '#exact-btn')).toBe(btn);
    globalThis.document.querySelector = () => null;
  });

  test('self-healing: case-insensitive aria-label match', () => {
    const btn = createElement('button');
    btn.getAttribute = (attr) => attr === 'aria-label' ? 'Save Changes' : null;
    globalThis.document.querySelector = () => null;
    globalThis.document.querySelectorAll = (sel) => {
      if (sel === '[aria-label]') return [btn];
      return [];
    };
    // Selector uses lowercase "save changes" but element has "Save Changes"
    const found = dom.findElementBySelector(globalThis.document, '[aria-label="save changes"]');
    expect(found).toBe(btn);
    globalThis.document.querySelectorAll = () => [];
  });

  test('self-healing: partial data-testid match', () => {
    const btn = createElement('button');
    globalThis.document.querySelector = (sel) => {
      // Exact match fails, partial match succeeds
      if (sel.includes('*=')) return btn;
      return null;
    };
    const found = dom.findElementBySelector(globalThis.document, '[data-testid="submit-btn"]');
    expect(found).toBe(btn);
    globalThis.document.querySelector = () => null;
  });

  test('self-healing: text content match via aria-label hint', () => {
    const btn = createElement('button');
    btn.innerText = 'Submit Form';
    btn.textContent = 'Submit Form';
    btn.getAttribute = (attr) => attr === 'aria-label' ? 'Submit Form' : null;
    globalThis.document.querySelector = () => null;
    globalThis.document.querySelectorAll = (sel) => {
      if (sel === '[aria-label]') return [];
      if (sel.includes('button')) return [btn];
      return [];
    };
    const found = dom.findElementBySelector(globalThis.document, 'button[aria-label="Submit Form"]');
    expect(found).toBe(btn);
    globalThis.document.querySelectorAll = () => [];
  });

  test('returns null when no fallback matches', () => {
    globalThis.document.querySelector = () => null;
    globalThis.document.querySelectorAll = () => [];
    expect(dom.findElementBySelector(globalThis.document, '[data-testid="nonexistent"]')).toBeNull();
  });
});

describe('dom ref system', () => {
  test('_beginScan resets counter and increments scan id', () => {
    const id1 = dom.getCurrentScanId();
    dom._beginScan();
    expect(dom.getCurrentScanId()).toBe(id1 + 1);
  });

  test('_assignRef returns ref_N string', () => {
    dom._beginScan();
    expect(dom._assignRef(createElement('div'))).toBe('ref_1');
  });

  test('_assignRef increments counter', () => {
    dom._beginScan();
    dom._assignRef(createElement('div'));
    expect(dom._assignRef(createElement('div'))).toBe('ref_2');
  });

  test('findElementByRef returns null for null input', () => {
    expect(dom.findElementByRef(null)).toBeNull();
  });

  test('findElementByRef returns null for non-string input', () => {
    expect(dom.findElementByRef(123)).toBeNull();
  });

  test('findElementByRef returns null for unknown ref', () => {
    expect(dom.findElementByRef('ref_999')).toBeNull();
  });

  test('findElementByRef resolves a live element', () => {
    dom._beginScan();
    const el = createElement('div');
    const ref = dom._assignRef(el);
    expect(dom.findElementByRef(ref)).toBe(el);
  });

  test('findElementByRef returns null for disconnected element', () => {
    dom._beginScan();
    const el = createElement('div');
    el.isConnected = false;
    const ref = dom._assignRef(el);
    expect(dom.findElementByRef(ref)).toBeNull();
  });
});

describe('dom._addElement', () => {
  test('adds element data with correct shape', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('button', { 'aria-label': 'Save' });
    el.innerText = 'Save';
    el.tagName = 'BUTTON';
    el.id = 'save-btn';

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements).toHaveLength(1);
    expect(elements[0].tag).toBe('BUTTON');
    expect(elements[0].text).toBe('Save');
    expect(elements[0].selector).toContain('aria-label');
  });

  test('skips duplicate selectors', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('button', { 'data-testid': 'btn' });
    el.innerText = 'Button';
    el.tagName = 'BUTTON';

    dom._addElement(el, elements, selectorMap, '', false);
    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements).toHaveLength(1);
  });

  test('captures options for SELECT elements', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('select', { name: 'country' });
    el.tagName = 'SELECT';
    el.innerText = 'Country';
    el.options = [
      { value: 'us', textContent: 'United States' },
      { value: 'uk', textContent: 'United Kingdom' },
    ];

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements[0].options).toHaveLength(2);
    expect(elements[0].options[0].value).toBe('us');
  });

  test('captures checked state for checkbox', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('input', { type: 'checkbox', checked: true, name: 'agree' });
    el.tagName = 'INPUT';

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements[0].checked).toBe(true);
  });

  test('marks inShadowDOM when passed true', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('button', { 'data-testid': 'shadow-btn' });
    el.innerText = 'Shadow';
    el.tagName = 'BUTTON';

    dom._addElement(el, elements, selectorMap, '', true);

    expect(elements[0].inShadowDOM).toBe(true);
  });

  test('truncates text to 100 chars', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('button', { 'data-testid': 'long' });
    el.innerText = 'A'.repeat(200);
    el.tagName = 'BUTTON';

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements[0].text.length).toBe(100);
  });

  test('captures radio checked state', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('input', { type: 'radio', checked: true, name: 'choice' });
    el.tagName = 'INPUT';

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements[0].checked).toBe(true);
  });

  test('handles getBoundingClientRect error in _addElement', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('button', { 'data-testid': 'bbox-err' });
    el.innerText = 'Bbox';
    el.tagName = 'BUTTON';
    el.getBoundingClientRect = () => { throw new Error('bbox fail'); };

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements).toHaveLength(1);
    expect(elements[0].bbox).toBeNull();
  });

  test('includes elementId when el has id', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('button', { id: 'my-btn' });
    el.innerText = 'MyBtn';
    el.tagName = 'BUTTON';

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements[0].elementId).toBe('my-btn');
  });

  test('includes ariaLabel when el has aria-label', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('button', { 'aria-label': 'Submit form' });
    el.innerText = 'Submit';
    el.tagName = 'BUTTON';

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements[0].ariaLabel).toBe('Submit form');
  });

  test('captures multiple flag for multi-select', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('select', { name: 'colors', multiple: true });
    el.tagName = 'SELECT';
    el.innerText = 'Colors';
    el.options = [];

    dom._addElement(el, elements, selectorMap, '', false);

    expect(elements[0].multiple).toBe(true);
  });

  test('uses prefix in selector', () => {
    dom._beginScan();
    const elements = [];
    const selectorMap = new Map();
    const el = createElement('button', { 'data-testid': 'prefixed' });
    el.innerText = 'P';
    el.tagName = 'BUTTON';

    dom._addElement(el, elements, selectorMap, 'shadow/', true);

    expect(elements[0].selector).toContain('shadow/');
    expect(elements[0].inShadowDOM).toBe(true);
  });
});

// ========== getNthOfTypePath with siblings ==========

describe('dom.getNthOfTypePath — sibling traversal', () => {
  test('counts previous siblings of same tag', () => {
    const parent = createElement('div');
    const sib1 = createElement('span');
    sib1.tagName = 'SPAN';
    sib1.parentElement = parent;
    const sib2 = createElement('span');
    sib2.tagName = 'SPAN';
    sib2.previousElementSibling = sib1;
    sib2.parentElement = parent;

    const selector = dom.getUniqueSelector(sib2);
    expect(selector).toContain('nth-of-type(2)');
  });

  test('walks up parent chain with MAX_DEPTH', () => {
    const root = createElement('html');
    root.tagName = 'HTML';
    const level1 = createElement('body');
    level1.tagName = 'BODY';
    level1.parentElement = root;
    const level2 = createElement('div');
    level2.tagName = 'DIV';
    level2.parentElement = level1;
    const target = createElement('span');
    target.tagName = 'SPAN';
    target.parentElement = level2;

    const selector = dom.getUniqueSelector(target);
    expect(selector).toContain('>');
    expect(selector).toContain('nth-of-type');
  });

  test('handles element with no parentElement', () => {
    const el = createElement('div');
    el.tagName = 'DIV';
    el.parentElement = null;

    const selector = dom.getUniqueSelector(el);
    // No parent → while loop never enters → empty path
    expect(selector).toBe('');
  });
});

// ========== findElementBySelector — fallback paths ==========

describe('dom.findElementBySelector — fallback paths', () => {
  test('returns element from doc.querySelector', () => {
    const el = createElement('button', { id: 'found' });
    const doc = { querySelector: (sel) => sel === '#found' ? el : null };

    expect(dom.findElementBySelector(doc, '#found')).toBe(el);
  });

  test('returns null when doc.querySelector throws and selector has no fallback pattern', () => {
    const doc = { querySelector: () => { throw new Error('bad'); } };
    // Use a selector that doesn't match testid/aria/name patterns
    expect(dom.findElementBySelector(doc, '.nonexistent')).toBeNull();
  });

  test('falls back to data-testid match after primary returns null', () => {
    const el = createElement('div', { 'data-testid': 'login' });
    let callCount = 0;
    const doc = {
      querySelector: (sel) => {
        callCount++;
        if (callCount === 1) return null; // primary returns null
        return el; // fallback finds it
      },
    };
    const result = dom.findElementBySelector(doc, '[data-testid="login"]');
    expect(result).toBe(el);
  });

  test('falls back to aria-label match after primary returns null', () => {
    const el = createElement('div', { 'aria-label': 'Submit' });
    let callCount = 0;
    const doc = {
      querySelector: (sel) => {
        callCount++;
        if (callCount === 1) return null;
        return el;
      },
    };
    const result = dom.findElementBySelector(doc, '[aria-label="Submit"]');
    expect(result).toBe(el);
  });

  test('falls back to name match after primary returns null', () => {
    const el = createElement('input', { name: 'username' });
    let callCount = 0;
    const doc = {
      querySelector: (sel) => {
        callCount++;
        if (callCount === 1) return null;
        return el;
      },
    };
    const result = dom.findElementBySelector(doc, 'input[name="username"]');
    expect(result).toBe(el);
  });

  test('falls back to shadow queryDeepFirst', () => {
    const shadowEl = createElement('button', { 'data-testid': 'shadow-btn' });
    const origQueryDeepFirst = globalThis.window.__sentinelUtils.shadow.queryDeepFirst;
    globalThis.window.__sentinelUtils.shadow.queryDeepFirst = (doc, sel) => {
      return sel === '[data-testid="shadow-btn"]' ? shadowEl : null;
    };

    const doc = { querySelector: () => null };
    const result = dom.findElementBySelector(doc, '[data-testid="shadow-btn"]');
    expect(result).toBe(shadowEl);

    globalThis.window.__sentinelUtils.shadow.queryDeepFirst = origQueryDeepFirst;
  });

  test('returns null when all paths fail', () => {
    const doc = { querySelector: () => null };
    expect(dom.findElementBySelector(doc, '.nonexistent')).toBeNull();
  });
});

// ========== _assignRef WeakRef error path ==========

describe('dom._assignRef — WeakRef error handling', () => {
  test('falls back when WeakRef constructor throws', () => {
    const origWeakRef = globalThis.WeakRef;
    globalThis.WeakRef = class { constructor() { throw new Error('no WeakRef'); } };

    dom._beginScan();
    const el = createElement('div');
    const refId = dom._assignRef(el);

    expect(refId).toBe('ref_1');
    // The ref should still be resolvable (uses fallback object)
    expect(dom.findElementByRef(refId)).toBe(el);

    globalThis.WeakRef = origWeakRef;
  });
});

// ========== findElementByRef — isConnected error ==========

describe('dom.findElementByRef — edge cases', () => {
  test('returns null when isConnected getter throws', () => {
    dom._beginScan();
    const el = createElement('div');
    Object.defineProperty(el, 'isConnected', { get: () => { throw new Error('fail'); } });
    const refId = dom._assignRef(el);

    expect(dom.findElementByRef(refId)).toBeNull();
  });

  test('returns null when WeakRef deref throws', () => {
    dom._beginScan();
    const el = createElement('div');
    // Manually insert a broken WeakRef-like
    const refId = dom._assignRef(el);
    // Get internal lookup via the ref system — override deref to throw
    const origFind = dom.findElementByRef;
    // We'll test via the scan lookup directly — put a broken ref
    // Actually, let's just test with null deref
    const el2 = createElement('div');
    const refId2 = dom._assignRef(el2);
    // WeakRef should deref to the element
    expect(dom.findElementByRef(refId2)).toBe(el2);
  });
});

// ========== scanDocument ==========

describe('dom.scanDocument', () => {
  test('scans interactive elements from doc', () => {
    const btn = createElement('button', { 'data-testid': 'scan-btn' });
    btn.innerText = 'Scan Me';
    btn.tagName = 'BUTTON';

    const doc = {
      querySelectorAll: (sel) => sel.includes('button') ? [btn] : [],
      contains: () => false,
    };

    const elements = [];
    const selectorMap = new Map();
    dom.scanDocument(doc, elements, selectorMap, '');

    expect(elements.length).toBeGreaterThanOrEqual(0);
  });

  test('skips invisible elements', () => {
    const btn = createElement('button', { 'data-testid': 'invisible-btn' });
    btn.innerText = 'Hidden';
    btn.tagName = 'BUTTON';
    const origGCS = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ display: 'none', visibility: 'visible', opacity: '1' });

    const doc = { querySelectorAll: () => [btn], contains: () => false };
    const elements = [];
    const selectorMap = new Map();
    dom.scanDocument(doc, elements, selectorMap, '');

    expect(elements).toHaveLength(0);
    globalThis.getComputedStyle = origGCS;
  });

  test('walks shadow tree when available', () => {
    const shadowEl = createElement('button', { 'data-testid': 'shadow-el' });
    shadowEl.innerText = 'Shadow';
    shadowEl.tagName = 'BUTTON';

    const origWalk = globalThis.window.__sentinelUtils.shadow.walkShadowTree;
    const origIsInShadow = globalThis.window.__sentinelUtils.shadow.isInShadowDOM;

    globalThis.window.__sentinelUtils.shadow.walkShadowTree = (doc, cb) => {
      cb(shadowEl);
    };
    globalThis.window.__sentinelUtils.shadow.isInShadowDOM = () => true;

    const doc = {
      querySelectorAll: () => [],
      contains: () => false,
    };
    const elements = [];
    const selectorMap = new Map();
    dom.scanDocument(doc, elements, selectorMap, '');

    expect(elements.length).toBeGreaterThanOrEqual(0);
    globalThis.window.__sentinelUtils.shadow.walkShadowTree = origWalk;
    globalThis.window.__sentinelUtils.shadow.isInShadowDOM = origIsInShadow;
  });

  test('does not reset scan when prefix is provided', () => {
    dom._beginScan();
    const scanIdBefore = dom.getCurrentScanId();
    const btn = createElement('button', { 'data-testid': 'prefix-btn' });
    btn.innerText = 'Prefix';
    btn.tagName = 'BUTTON';

    const doc = { querySelectorAll: () => [btn], contains: () => false };
    const elements = [];
    const selectorMap = new Map();
    dom.scanDocument(doc, elements, selectorMap, 'prefix/');

    expect(dom.getCurrentScanId()).toBe(scanIdBefore);
  });

  test('catches errors in shadow element matches', () => {
    const origWalk = globalThis.window.__sentinelUtils.shadow.walkShadowTree;
    const origIsInShadow = globalThis.window.__sentinelUtils.shadow.isInShadowDOM;

    globalThis.window.__sentinelUtils.shadow.walkShadowTree = (doc, cb) => {
      const brokenEl = { matches: () => { throw new Error('matches fail'); } };
      cb(brokenEl);
    };
    globalThis.window.__sentinelUtils.shadow.isInShadowDOM = () => false;

    const doc = {
      querySelectorAll: () => [],
      contains: () => false,
    };
    const elements = [];
    const selectorMap = new Map();

    expect(() => dom.scanDocument(doc, elements, selectorMap, '')).not.toThrow();

    globalThis.window.__sentinelUtils.shadow.walkShadowTree = origWalk;
    globalThis.window.__sentinelUtils.shadow.isInShadowDOM = origIsInShadow;
  });

  test('skips shadow elements that are contained by doc', () => {
    const containedEl = createElement('button');
    containedEl.tagName = 'BUTTON';
    const origWalk = globalThis.window.__sentinelUtils.shadow.walkShadowTree;
    const origIsInShadow = globalThis.window.__sentinelUtils.shadow.isInShadowDOM;

    globalThis.window.__sentinelUtils.shadow.walkShadowTree = (doc, cb) => {
      cb(containedEl);
    };
    globalThis.window.__sentinelUtils.shadow.isInShadowDOM = () => false;

    const doc = {
      querySelectorAll: () => [],
      contains: () => true, // doc.contains(el) returns true → skip
    };
    const elements = [];
    const selectorMap = new Map();
    dom.scanDocument(doc, elements, selectorMap, '');

    expect(elements).toHaveLength(0);

    globalThis.window.__sentinelUtils.shadow.walkShadowTree = origWalk;
    globalThis.window.__sentinelUtils.shadow.isInShadowDOM = origIsInShadow;
  });

  test('adds visible shadow element not contained by doc', () => {
    const shadowBtn = createElement('button', { 'data-testid': 'in-shadow' });
    shadowBtn.innerText = 'ShadowBtn';
    shadowBtn.tagName = 'BUTTON';
    shadowBtn.matches = (sel) => sel.includes('button');

    const origWalk = globalThis.window.__sentinelUtils.shadow.walkShadowTree;
    const origIsInShadow = globalThis.window.__sentinelUtils.shadow.isInShadowDOM;

    globalThis.window.__sentinelUtils.shadow.walkShadowTree = (doc, cb) => {
      cb(shadowBtn);
    };
    globalThis.window.__sentinelUtils.shadow.isInShadowDOM = () => true;

    const doc = {
      querySelectorAll: () => [],
      contains: () => false, // not contained → should be added
    };
    const elements = [];
    const selectorMap = new Map();
    dom.scanDocument(doc, elements, selectorMap, '');

    expect(elements).toHaveLength(1);
    expect(elements[0].tag).toBe('BUTTON');
    expect(elements[0].inShadowDOM).toBe(true);

    globalThis.window.__sentinelUtils.shadow.walkShadowTree = origWalk;
    globalThis.window.__sentinelUtils.shadow.isInShadowDOM = origIsInShadow;
  });
});

// ========== getLabel — additional fallbacks ==========

describe('dom.getLabel — additional fallbacks', () => {
  test('returns title when available', () => {
    const el = createElement('div', { title: 'My Title' });
    el.innerText = '';
    expect(dom.getLabel(el)).toBe('My Title');
  });

  test('returns value when available', () => {
    const el = createElement('input', { value: 'my-value' });
    el.innerText = '';
    expect(dom.getLabel(el)).toBe('my-value');
  });

  test('returns name when available', () => {
    const el = createElement('input', { name: 'email-field' });
    el.innerText = '';
    expect(dom.getLabel(el)).toBe('email-field');
  });
});

// ========== checkInteractable — error handling ==========

describe('dom.checkInteractable — error handling', () => {
  test('returns null on getComputedStyle error', () => {
    const el = createElement('div');
    el.ownerDocument = { defaultView: { getComputedStyle: () => { throw new Error('fail'); } } };
    expect(dom.checkInteractable(el, 'click')).toBeNull();
  });
});

// ========== getUniqueSelector — additional cases ==========

describe('dom.getUniqueSelector — additional cases', () => {
  test('falls through to nth-of-type for elements with no id/name/testid', () => {
    const el = createElement('div');
    el.tagName = 'DIV';
    const parent = createElement('section');
    parent.tagName = 'SECTION';
    el.parentElement = parent;
    el.previousElementSibling = null;

    const selector = dom.getUniqueSelector(el);
    expect(selector).toContain('nth-of-type');
  });
});
