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

  test('resolves via MutationObserver callback', async () => {
    // Capture the observer instance to manually trigger its callback
    let capturedObserver = null;
    const OrigMO = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      constructor(cb) { this._cb = cb; capturedObserver = this; }
      observe() {}
      disconnect() { this._disconnected = true; }
    };

    // Condition starts false, then we flip body text via observer callback
    const origText = globalThis.document.body.innerText;
    globalThis.document.body.innerText = 'NotPresentXYZ';

    const promise = wait.handleWaitFor({ type: 'wait_for_text', text: 'FoundItNow' });

    // Flip the text and trigger observer callback
    globalThis.document.body.innerText = 'FoundItNow is here';
    if (capturedObserver) {
      capturedObserver._cb();
    }

    const result = await promise;
    expect(result).toContain('Condition met after');

    globalThis.MutationObserver = OrigMO;
    globalThis.document.body.innerText = origText;
  });

  test('resolves via polling interval callback', async () => {
    jest.useFakeTimers();

    // Condition starts false
    const origText = globalThis.document.body.innerText;
    globalThis.document.body.innerText = 'NotPresent';

    const promise = wait.handleWaitFor({ type: 'wait_for_text', text: 'PolledText', timeout: 10000 });

    // Flip text before polling interval fires
    globalThis.document.body.innerText = 'PolledText found';
    jest.advanceTimersByTime(600);

    const result = await promise;
    expect(result).toContain('Condition met after');

    jest.useRealTimers();
    globalThis.document.body.innerText = origText;
  });

  test('resolves "No document body" when body and documentElement are null', async () => {
    const origBody = globalThis.document.body;
    const origDE = globalThis.document.documentElement;
    globalThis.document.body = null;
    globalThis.document.documentElement = null;

    // Condition not met, so it enters observer path
    const result = await wait.handleWaitFor({ type: 'wait_for_text', text: 'NotPresent' });
    expect(result).toBe('No document body to observe');

    globalThis.document.body = origBody;
    globalThis.document.documentElement = origDE;
  });

  test('uses documentElement as observeTarget when body is null', async () => {
    const origBody = globalThis.document.body;
    const origDE = globalThis.document.documentElement;
    let observedTarget = null;

    const OrigMO = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      constructor(cb) { this._cb = cb; }
      observe(target) { observedTarget = target; }
      disconnect() {}
    };

    globalThis.document.body = null;
    globalThis.document.documentElement = { innerText: 'Fallback' };

    // Use a condition that will timeout quickly
    const promise = wait.handleWaitFor({ type: 'wait_for_text', text: 'NotPresent', timeout: 50 });

    // Check that observeTarget is documentElement
    // (observer.observe is called synchronously before timer)
    expect(observedTarget).toBe(globalThis.document.documentElement);

    await promise;

    globalThis.MutationObserver = OrigMO;
    globalThis.document.body = origBody;
    globalThis.document.documentElement = origDE;
  });

  test('disconnects observer and clears interval on timeout', async () => {
    let disconnected = false;
    const OrigMO = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      constructor(cb) { this._cb = cb; }
      observe() {}
      disconnect() { disconnected = true; }
    };

    const origText = globalThis.document.body.innerText;
    globalThis.document.body.innerText = 'NotPresentAtAll';

    const result = await wait.handleWaitFor({ type: 'wait_for_text', text: 'NeverFound', timeout: 50 });
    expect(result).toContain('Timeout');
    expect(disconnected).toBe(true);

    globalThis.MutationObserver = OrigMO;
    globalThis.document.body.innerText = origText;
  });
});

// ========== checkCondition — null body ==========

describe('wait.checkCondition — edge cases', () => {
  test('returns false for wait_for_text when body is null', () => {
    const origBody = globalThis.document.body;
    globalThis.document.body = null;
    expect(wait.checkCondition({ type: 'wait_for_text', text: 'Hello' })).toBe(false);
    globalThis.document.body = origBody;
  });

  test('returns true for wait_for_element with matching selector', () => {
    globalThis.document.querySelector = () => ({ tagName: 'DIV' });
    expect(wait.checkCondition({ type: 'wait_for_element', selector: '.found' })).toBe(true);
    globalThis.document.querySelector = () => null;
  });

  test('returns false for wait_for_element with ref but no dom utility', () => {
    const origDom = globalThis.window.__sentinelUtils.dom;
    globalThis.window.__sentinelUtils.dom = null;
    globalThis.document.querySelector = () => null;
    expect(wait.checkCondition({ type: 'wait_for_element', ref: 'ref_1', selector: '#missing' })).toBe(false);
    globalThis.window.__sentinelUtils.dom = origDom;
  });

  test('returns false for wait_for_element with ref but no findElementByRef', () => {
    const origDom = globalThis.window.__sentinelUtils.dom;
    globalThis.window.__sentinelUtils.dom = {};
    globalThis.document.querySelector = () => null;
    expect(wait.checkCondition({ type: 'wait_for_element', ref: 'ref_1', selector: '#missing' })).toBe(false);
    globalThis.window.__sentinelUtils.dom = origDom;
  });

  test('returns false for wait_for_element with ref found and no selector needed', () => {
    globalThis.window.__sentinelUtils.dom.findElementByRef = () => ({ isConnected: true });
    expect(wait.checkCondition({ type: 'wait_for_element', ref: 'ref_1' })).toBe(true);
    globalThis.window.__sentinelUtils.dom.findElementByRef = () => null;
  });

  test('returns false for wait_for_text with empty body innerText', () => {
    const origText = globalThis.document.body.innerText;
    globalThis.document.body.innerText = '';
    expect(wait.checkCondition({ type: 'wait_for_text', text: 'Hello' })).toBe(false);
    globalThis.document.body.innerText = origText;
  });
});

// ========== sleep edge cases ==========

describe('wait.sleep — edge cases', () => {
  test('resolves with zero ms', async () => {
    jest.useFakeTimers();
    const promise = wait.sleep(0);
    jest.advanceTimersByTime(0);
    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  test('resolves with negative ms', async () => {
    const result = await wait.sleep(-1);
    expect(result).toBeUndefined();
  });
});
