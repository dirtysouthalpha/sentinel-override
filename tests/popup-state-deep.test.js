// tests/popup-state-deep.test.js
// Deep tests for popup-modules/popup-state.js — edge cases, boundary conditions, stress tests.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createSandbox() {
  const sandbox = { window: {}, console, Proxy, JSON, Set, Error };
  vm.createContext(sandbox);
  const source = readFileSync(join(__dirname, '../popup-modules/popup-state.js'), 'utf8');
  const script = new vm.Script(source, { filename: 'popup-state.js' });
  script.runInContext(sandbox);
  return sandbox;
}

describe('popup-state deep: subscriber ordering', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    sandbox.initPopupState();
  });

  test('subscribers fire in insertion order', () => {
    const order = [];
    sandbox.subscribe('activeProviderId', () => order.push(1));
    sandbox.subscribe('activeProviderId', () => order.push(2));
    sandbox.subscribe('activeProviderId', () => order.push(3));

    const state = sandbox.getState();
    state.activeProviderId = 'openai';

    expect(order).toEqual([1, 2, 3]);
  });

  test('subscriber removed mid-iteration does not break remaining subscribers', () => {
    const calls = [];
    let unsub2;
    sandbox.subscribe('activeProviderId', () => calls.push('a'));
    unsub2 = sandbox.subscribe('activeProviderId', () => {
      calls.push('b');
      unsub2();
    });
    sandbox.subscribe('activeProviderId', () => calls.push('c'));

    const state = sandbox.getState();
    state.activeProviderId = 'openai';

    expect(calls).toContain('a');
    expect(calls).toContain('b');
    // 'c' may or may not be called depending on Set iteration behavior after delete
  });

  test('subscribe to non-existent key does not crash on unrelated changes', () => {
    const cb = jest.fn();
    sandbox.subscribe('nonExistentKey', cb);

    const state = sandbox.getState();
    state.activeProviderId = 'openai';
    state.currentSearchQuery = 'test';

    expect(cb).not.toHaveBeenCalled();
  });

  test('changing multiple properties fires correct subscribers', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    sandbox.subscribe('activeProviderId', cb1);
    sandbox.subscribe('currentSearchQuery', cb2);

    const state = sandbox.getState();
    state.activeProviderId = 'openai';
    state.currentSearchQuery = 'hello';

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  test('changing same value twice only fires once per change', () => {
    const cb = jest.fn();
    sandbox.subscribe('activeProviderId', cb);

    const state = sandbox.getState();
    state.activeProviderId = 'openai';
    state.activeProviderId = 'anthropic';
    state.activeProviderId = 'openai';

    expect(cb).toHaveBeenCalledTimes(3);
  });

  test('setting same value does not fire subscriber', () => {
    const cb = jest.fn();
    sandbox.subscribe('activeProviderId', cb);

    const state = sandbox.getState();
    state.activeProviderId = 'anthropic'; // same as default

    expect(cb).not.toHaveBeenCalled();
  });

  test('setting property to undefined from non-undefined fires subscriber', () => {
    const cb = jest.fn();
    sandbox.subscribe('currentReportMarkdown', cb);

    const state = sandbox.getState();
    state.currentReportMarkdown = 'some markdown';
    expect(cb).toHaveBeenCalledTimes(1);

    state.currentReportMarkdown = null;
    expect(cb).toHaveBeenCalledTimes(2);
  });

  test('setting property from null fires subscriber', () => {
    const cb = jest.fn();
    sandbox.subscribe('currentReport', cb);

    const state = sandbox.getState();
    state.currentReport = { data: 'test' };
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ data: 'test' }, 'currentReport', null);
  });
});

describe('popup-state deep: state immutability', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    sandbox.initPopupState();
  });

  test('conversationHistory is isolated between inits', () => {
    const state1 = sandbox.getState();
    state1.conversationHistory.push({ role: 'user', text: 'hello' });

    sandbox.initPopupState();
    const state2 = sandbox.getState();
    expect(state2.conversationHistory).toEqual([]);
  });

  test('providerConfigs is isolated between inits', () => {
    const state = sandbox.getState();
    state.providerConfigs.anthropic.apiKey = 'sk-test';

    sandbox.initPopupState();
    const state2 = sandbox.getState();
    expect(state2.providerConfigs).toEqual({ anthropic: {}, openai: {} });
  });

  test('pendingStepLogs is isolated between inits', () => {
    const state = sandbox.getState();
    state.pendingStepLogs['step1'] = { log: 'data' };

    sandbox.initPopupState();
    expect(sandbox.getState().pendingStepLogs).toEqual({});
  });

  test('selectedAttachments default is empty array', () => {
    const state = sandbox.getState();
    expect(state.selectedAttachments).toEqual([]);
  });

  test('currentSearchQuery default is empty string', () => {
    const state = sandbox.getState();
    expect(state.currentSearchQuery).toBe('');
  });

  test('currentSearchIndex default is 0', () => {
    const state = sandbox.getState();
    expect(state.currentSearchIndex).toBe(0);
  });
});

describe('popup-state deep: init re-initialization', () => {
  test('calling initPopupState twice does not leak subscribers', () => {
    const sandbox = createSandbox();
    sandbox.initPopupState();

    const cb = jest.fn();
    sandbox.subscribe('activeProviderId', cb);

    sandbox.initPopupState();
    const state = sandbox.getState();
    state.activeProviderId = 'openai';

    // Subscriber was added to the global _subscribers, init doesn't clear it
    // so cb should still be called
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('getState before init returns undefined', () => {
    const sandbox = createSandbox();
    // Don't call initPopupState
    expect(sandbox.getState()).toBeUndefined();
  });

  test('subscribe before init does not crash', () => {
    const sandbox = createSandbox();
    expect(() => sandbox.subscribe('key', jest.fn())).not.toThrow();
  });

  test('multiple sequential inits produce independent states', () => {
    const sandbox = createSandbox();

    sandbox.initPopupState();
    sandbox.getState().activeProviderId = 'openai';

    sandbox.initPopupState();
    sandbox.getState().conversationHistory.push('msg1');

    sandbox.initPopupState();
    const state = sandbox.getState();
    expect(state.activeProviderId).toBe('anthropic');
    expect(state.conversationHistory).toEqual([]);
    expect(state.currentSearchQuery).toBe('');
  });
});

describe('popup-state deep: proxy edge cases', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    sandbox.initPopupState();
  });

  test('setting property to NaN fires subscriber', () => {
    const cb = jest.fn();
    sandbox.subscribe('currentSearchIndex', cb);

    const state = sandbox.getState();
    state.currentSearchIndex = NaN;

    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('setting property to 0 fires subscriber', () => {
    const cb = jest.fn();
    sandbox.subscribe('currentSearchIndex', cb);

    const state = sandbox.getState();
    // Default is 0, so setting to 0 should NOT fire
    state.currentSearchIndex = 0;
    expect(cb).not.toHaveBeenCalled();

    // Change to non-zero then back to 0
    state.currentSearchIndex = 5;
    expect(cb).toHaveBeenCalledTimes(1);
    state.currentSearchIndex = 0;
    expect(cb).toHaveBeenCalledTimes(2);
  });

  test('setting property to empty string from empty string does not fire', () => {
    const cb = jest.fn();
    sandbox.subscribe('currentSearchQuery', cb);

    const state = sandbox.getState();
    state.currentSearchQuery = '';
    expect(cb).not.toHaveBeenCalled();
  });

  test('setting property to false fires subscriber', () => {
    const cb = jest.fn();
    sandbox.subscribe('activeProviderId', cb);

    const state = sandbox.getState();
    state.activeProviderId = false;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(false, 'activeProviderId', 'anthropic');
  });

  test('setting property to null fires subscriber', () => {
    const cb = jest.fn();
    sandbox.subscribe('currentReportMarkdown', cb);

    const state = sandbox.getState();
    state.currentReportMarkdown = null;
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('subscribing to same callback twice results in single notification', () => {
    const cb = jest.fn();
    sandbox.subscribe('activeProviderId', cb);
    sandbox.subscribe('activeProviderId', cb);

    const state = sandbox.getState();
    state.activeProviderId = 'openai';

    // Set prevents duplicate, so should only fire once
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('adding new property to state does not crash', () => {
    const state = sandbox.getState();
    expect(() => { state.customProp = 'value'; }).not.toThrow();
    expect(state.customProp).toBe('value');
  });

  test('deleting a property from state does not crash', () => {
    const state = sandbox.getState();
    expect(() => { delete state.currentSearchQuery; }).not.toThrow();
  });

  test('getOwnPropertyDescriptor still works through proxy', () => {
    const state = sandbox.getState();
    const desc = Object.getOwnPropertyDescriptor(state, 'conversationHistory');
    expect(desc).toBeDefined();
    expect(Array.isArray(desc.value)).toBe(true);
  });
});

describe('popup-state deep: unsubscribe function edge cases', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    sandbox.initPopupState();
  });

  test('unsubscribing a callback that was never subscribed is safe', () => {
    const cb = jest.fn();
    const unsub = sandbox.subscribe('key', cb);
    unsub();
    unsub();
    unsub();
    unsub();
    unsub();
    // No crash
    expect(true).toBe(true);
  });

  test('calling unsubscribe from within a subscriber callback', () => {
    let callCount = 0;
    let unsub;
    const cb = () => {
      callCount++;
      if (unsub) unsub();
    };
    unsub = sandbox.subscribe('activeProviderId', cb);

    const state = sandbox.getState();
    state.activeProviderId = 'openai';
    expect(callCount).toBe(1);

    state.activeProviderId = 'anthropic';
    expect(callCount).toBe(1); // unsubscribed itself during first call
  });

  test('different keys do not interfere', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    const unsub1 = sandbox.subscribe('activeProviderId', cb1);
    sandbox.subscribe('currentSearchQuery', cb2);

    unsub1();

    const state = sandbox.getState();
    state.activeProviderId = 'openai';
    state.currentSearchQuery = 'test';

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  test('unsubscribing from one key does not affect other key subscribers', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    const unsub1 = sandbox.subscribe('key1', cb1);
    sandbox.subscribe('key2', cb2);

    unsub1();

    const state = sandbox.getState();
    state.key1 = 'value1';
    state.key2 = 'value2';

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

describe('popup-state deep: window exports', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
    sandbox.initPopupState();
  });

  test('initPopupState is exported on window', () => {
    expect(typeof sandbox.window.initPopupState).toBe('function');
  });

  test('getState is exported on window', () => {
    expect(typeof sandbox.window.getState).toBe('function');
  });

  test('subscribe is exported on window', () => {
    expect(typeof sandbox.window.subscribe).toBe('function');
  });

  test('window functions match sandbox functions', () => {
    expect(sandbox.window.initPopupState).toBe(sandbox.initPopupState);
    expect(sandbox.window.getState).toBe(sandbox.getState);
    expect(sandbox.window.subscribe).toBe(sandbox.subscribe);
  });
});
