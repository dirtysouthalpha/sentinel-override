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
});
