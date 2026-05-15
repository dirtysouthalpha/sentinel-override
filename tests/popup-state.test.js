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
});
