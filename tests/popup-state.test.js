// tests/popup-state.test.js
// Unit tests for popup-modules/popup-state.js — reactive state, subscribe, notifications.
// popup-state.js uses bare function declarations (no exports), so we eval in a VM sandbox.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sandbox = {
  window: {},
  console,
  Proxy,
  JSON,
  Set,
  Error,
  structuredClone,
};

vm.createContext(sandbox);
const source = readFileSync(join(__dirname, '../popup-modules/popup-state.js'), 'utf8');
const script = new vm.Script(source, { filename: 'popup-state.js' });
script.runInContext(sandbox);

const { initPopupState, getState, subscribe } = sandbox;

describe('initPopupState', () => {
  test('creates window.__popupState', () => {
    initPopupState();
    expect(sandbox.window.__popupState).toBeDefined();
  });

  test('state has default shape', () => {
    initPopupState();
    const state = getState();
    expect(state.conversationHistory).toEqual([]);
    expect(state.activeProviderId).toBe('anthropic');
    expect(state.currentSearchQuery).toBe('');
    expect(state.currentSearchIndex).toBe(0);
    expect(state.providerConfigs).toEqual({ anthropic: {}, openai: {} });
    expect(state.currentReportMarkdown).toBeNull();
    expect(state.currentReport).toBeNull();
    expect(state.pendingStepLogs).toEqual({});
  });

  test('each init creates a fresh state (deep clone)', () => {
    initPopupState();
    const state1 = getState();
    state1.conversationHistory.push('test');
    state1.activeProviderId = 'openai';

    initPopupState();
    const state2 = getState();
    expect(state2.conversationHistory).toEqual([]);
    expect(state2.activeProviderId).toBe('anthropic');
  });
});

describe('getState', () => {
  test('returns window.__popupState', () => {
    initPopupState();
    expect(getState()).toBe(sandbox.window.__popupState);
  });
});

describe('subscribe', () => {
  beforeEach(() => {
    initPopupState();
  });

  test('notifies on property change', () => {
    const cb = jest.fn();
    subscribe('activeProviderId', cb);

    const state = getState();
    state.activeProviderId = 'openai';

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('openai', 'activeProviderId', 'anthropic');
  });

  test('does not notify when value unchanged', () => {
    const cb = jest.fn();
    subscribe('activeProviderId', cb);

    const state = getState();
    state.activeProviderId = 'anthropic';

    expect(cb).not.toHaveBeenCalled();
  });

  test('unsubscribe stops notifications', () => {
    const cb = jest.fn();
    const unsub = subscribe('activeProviderId', cb);

    unsub();
    const state = getState();
    state.activeProviderId = 'openai';

    expect(cb).not.toHaveBeenCalled();
  });

  test('supports multiple subscribers on same key', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    subscribe('activeProviderId', cb1);
    subscribe('activeProviderId', cb2);

    const state = getState();
    state.activeProviderId = 'openai';

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  test('catches subscriber errors without breaking', () => {
    const errorCb = () => { throw new Error('boom'); };
    const goodCb = jest.fn();
    subscribe('activeProviderId', errorCb);
    subscribe('activeProviderId', goodCb);

    const state = getState();
    expect(() => { state.activeProviderId = 'openai'; }).not.toThrow();
    expect(goodCb).toHaveBeenCalled();
  });

  test('notifies on different property changes', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    subscribe('activeProviderId', cb1);
    subscribe('currentSearchQuery', cb2);

    const state = getState();
    state.currentSearchQuery = 'test';

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  test('returns unsubscribe function', () => {
    const unsub = subscribe('activeProviderId', jest.fn());
    expect(typeof unsub).toBe('function');
  });

  test('handles null callback gracefully', () => {
    expect(() => subscribe('activeProviderId', null)).not.toThrow();
    const state = getState();
    expect(() => { state.activeProviderId = 'openai'; }).not.toThrow();
  });

  test('handles undefined callback gracefully', () => {
    expect(() => subscribe('activeProviderId', undefined)).not.toThrow();
    const state = getState();
    expect(() => { state.activeProviderId = 'openai'; }).not.toThrow();
  });

  test('handles non-function callback gracefully', () => {
    expect(() => subscribe('activeProviderId', 'not a function')).not.toThrow();
    const state = getState();
    expect(() => { state.activeProviderId = 'openai'; }).not.toThrow();
  });

  test('subscriber receives old value correctly', () => {
    const cb = jest.fn();
    subscribe('activeProviderId', cb);

    const state = getState();
    state.activeProviderId = 'openai';

    expect(cb).toHaveBeenCalledWith('openai', 'activeProviderId', 'anthropic');
  });

  test('multiple unsubscribes are safe (idempotent)', () => {
    const cb = jest.fn();
    const unsub = subscribe('activeProviderId', cb);

    unsub();
    unsub();
    unsub();

    const state = getState();
    state.activeProviderId = 'openai';

    expect(cb).not.toHaveBeenCalled();
  });

  test('subscriber can unsubscribe during callback (pattern check)', () => {
    let callCount = 0;
    let unsub;
    const selfUnsubbingCb = () => {
      callCount++;
      if (callCount === 1) unsub();
    };
    unsub = subscribe('activeProviderId', selfUnsubbingCb);

    const state = getState();
    state.activeProviderId = 'openai';
    state.activeProviderId = 'anthropic';

    // Should only be called once (first change triggers unsub)
    expect(callCount).toBe(1);
  });

  test('state changes trigger correct subscribers for nested properties', () => {
    const cb = jest.fn();
    subscribe('providerConfigs', cb);

    const state = getState();
    state.providerConfigs = { openai: { apiKey: 'test' } };

    expect(cb).toHaveBeenCalled();
  });

  test('handles rapid state changes', () => {
    const cb = jest.fn();
    subscribe('activeProviderId', cb);

    const state = getState();
    // Start from 'anthropic', first set to 'openai' then alternate
    for (let i = 0; i < 100; i++) {
      state.activeProviderId = i % 2 === 0 ? 'openai' : 'anthropic';
    }

    // Should be called 100 times (each change, since we always change value)
    expect(cb).toHaveBeenCalledTimes(100);
  });

  test('subscribe(key, null) returns a no-op unsubscribe function', () => {
    // Fixed bug: subscribe() now returns a no-op thunk when callback is not a function.
    const unsub = subscribe('activeProviderId', null);
    expect(typeof unsub).toBe('function');
    // Calling the no-op should not throw
    expect(() => unsub()).not.toThrow();
  });

  test('subscribe(key, "not-a-function") returns a no-op unsubscribe function', () => {
    const unsub = subscribe('activeProviderId', 'not-a-function');
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  test('after subscribe(key, null), state changes do not cause errors', () => {
    subscribe('activeProviderId', null);
    subscribe('currentSearchQuery', null);
    const state = getState();
    expect(() => {
      state.activeProviderId = 'openai';
      state.currentSearchQuery = 'test query';
    }).not.toThrow();
  });
});
