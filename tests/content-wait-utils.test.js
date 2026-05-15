// tests/content-wait-utils.test.js
// Unit tests for content/wait-utils.js — sleep, checkCondition, handleWaitFor.

import { jest } from '@jest/globals';

globalThis.window = globalThis;
globalThis.window.__sentinelUtils = {
  wait: {},
  dom: { findElementByRef: () => null },
};

globalThis.document = {
  body: { innerText: 'Hello World' },
  querySelector: () => null,
};
globalThis.window.location = { href: 'https://example.com/page1' };

// Mock MutationObserver for Node environment
globalThis.MutationObserver = class MutationObserver {
  constructor(callback) { this._callback = callback; }
  observe() {}
  disconnect() {}
};

let wait;
beforeAll(async () => {
  await import('../content/wait-utils.js');
  wait = globalThis.window.__sentinelUtils.wait;
});

describe('wait.checkCondition', () => {
  test('returns true for wait_for_text when text is present', () => {
    expect(wait.checkCondition({ type: 'wait_for_text', text: 'Hello' })).toBe(true);
  });

  test('returns false for wait_for_text when text is absent', () => {
    expect(wait.checkCondition({ type: 'wait_for_text', text: 'NotPresent' })).toBe(false);
  });

  test('returns true for wait_for_navigation when URL changed', () => {
    expect(wait.checkCondition({ type: 'wait_for_navigation', currentUrl: 'https://example.com/old' })).toBe(true);
  });

  test('returns false for wait_for_navigation when URL unchanged', () => {
    expect(wait.checkCondition({ type: 'wait_for_navigation', currentUrl: 'https://example.com/page1' })).toBe(false);
  });

  test('returns false for wait_for_element with no matching element', () => {
    expect(wait.checkCondition({ type: 'wait_for_element', selector: '#missing' })).toBe(false);
  });

  test('returns false for wait_for_element with stale ref and no selector', () => {
    expect(wait.checkCondition({ type: 'wait_for_element', ref: 'ref_1' })).toBe(false);
  });

  test('returns true for wait_for_element with live ref', () => {
    globalThis.window.__sentinelUtils.dom.findElementByRef = () => ({ isConnected: true });
    expect(wait.checkCondition({ type: 'wait_for_element', ref: 'ref_1' })).toBe(true);
    globalThis.window.__sentinelUtils.dom.findElementByRef = () => null;
  });

  test('returns false for wait_for_element with stale ref and selector but no match', () => {
    expect(wait.checkCondition({ type: 'wait_for_element', ref: 'ref_1', selector: '#missing' })).toBe(false);
  });

  test('returns false for unknown condition type', () => {
    expect(wait.checkCondition({ type: 'unknown' })).toBe(false);
  });

  test('handles querySelector error gracefully', () => {
    globalThis.document.querySelector = () => { throw new Error('fail'); };
    expect(wait.checkCondition({ type: 'wait_for_element', selector: '!!!' })).toBe(false);
    globalThis.document.querySelector = () => null;
  });
});

describe('wait.sleep', () => {
  test('resolves after specified time', async () => {
    jest.useFakeTimers();
    const promise = wait.sleep(100);
    jest.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});

describe('wait.handleWaitFor', () => {
  test('resolves immediately when condition met', async () => {
    const result = await wait.handleWaitFor({ type: 'wait_for_text', text: 'Hello' });
    expect(result).toBe('Condition met immediately');
  });

  test('resolves with timeout string when condition not met within timeout', async () => {
    // Use a very short timeout
    const result = await wait.handleWaitFor({ type: 'wait_for_text', text: 'NotPresentXYZ', timeout: 50 });
    expect(result).toContain('Timeout');
  }, 10000);
});
