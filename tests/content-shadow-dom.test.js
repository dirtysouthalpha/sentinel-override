// tests/content-shadow-dom.test.js
// Unit tests for content/shadow-dom.js — getShadowRoot, isInShadowDOM, walkShadowTree, queryDeep.

import { jest } from '@jest/globals';

const fn = () => {};

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = { shadow: {} };
globalThis.window.__sentinelCapturedRoots = {
  get: () => null,
};
globalThis.NodeFilter = { SHOW_ELEMENT: 1 };
globalThis.Node = { ELEMENT_NODE: 1 };

let shadow;
beforeAll(async () => {
  await import('../content/shadow-dom.js');
  shadow = globalThis.window.__sentinelUtils.shadow;
});

describe('shadow.getShadowRoot', () => {
  test('returns null for null element', () => {
    expect(shadow.getShadowRoot(null)).toBeNull();
  });

  test('returns null for element with no shadow root', () => {
    expect(shadow.getShadowRoot({})).toBeNull();
  });

  test('returns open shadowRoot when present', () => {
    const sr = {};
    const el = { shadowRoot: sr };
    expect(shadow.getShadowRoot(el)).toBe(sr);
  });

  test('returns captured closed shadow root', () => {
    const sr = {};
    const el = {};
    globalThis.window.__sentinelCapturedRoots = { get: (e) => e === el ? sr : null };
    expect(shadow.getShadowRoot(el)).toBe(sr);
    globalThis.window.__sentinelCapturedRoots = { get: () => null };
  });
});

describe('shadow.isInShadowDOM', () => {
  test('returns false for null', () => {
    expect(shadow.isInShadowDOM(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(shadow.isInShadowDOM(undefined)).toBe(false);
  });

  test('returns false when root node has no host', () => {
    const el = { getRootNode: () => ({}) };
    expect(shadow.isInShadowDOM(el)).toBe(false);
  });

  test('returns true when root node has host', () => {
    const el = { getRootNode: () => ({ host: {} }) };
    expect(shadow.isInShadowDOM(el)).toBe(true);
  });

  test('returns false when getRootNode throws', () => {
    const el = { getRootNode: () => { throw new Error('fail'); } };
    expect(shadow.isInShadowDOM(el)).toBe(false);
  });
});

describe('shadow.queryDeep', () => {
  test('returns empty array for null root', () => {
    expect(shadow.queryDeep(null, 'div')).toEqual([]);
  });

  test('returns empty array for null selector', () => {
    expect(shadow.queryDeep({}, null)).toEqual([]);
  });

  test('returns empty array for empty selector', () => {
    expect(shadow.queryDeep({}, '')).toEqual([]);
  });
});

describe('shadow.queryDeepFirst', () => {
  test('returns null for null root', () => {
    expect(shadow.queryDeepFirst(null, 'div')).toBeNull();
  });

  test('returns null for null selector', () => {
    expect(shadow.queryDeepFirst({}, null)).toBeNull();
  });

  test('returns null for empty selector', () => {
    expect(shadow.queryDeepFirst({}, '')).toBeNull();
  });
});

describe('shadow.walkShadowTree', () => {
  test('does nothing for null root', () => {
    const cb = jest.fn();
    expect(() => shadow.walkShadowTree(null, cb)).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  test('does nothing for undefined root', () => {
    const cb = jest.fn();
    expect(() => shadow.walkShadowTree(undefined, cb)).not.toThrow();
  });
});
