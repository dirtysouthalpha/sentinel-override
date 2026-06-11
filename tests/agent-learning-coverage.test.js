/**
 * agent-learning error path coverage — tests catch blocks in initLearningEngine
 * and _persist (the debounced storage flush).
 */

import { jest } from '@jest/globals';
import {
  initLearningEngine,
  recordActionOutcome,
} from '../background/agent-learning.js';

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('agent-learning — error path coverage', () => {
  test('initLearningEngine catch: storage.get rejection logs warning and does not throw', async () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));

    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(initLearningEngine()).resolves.toBeUndefined();

    console.warn = origWarn;
    expect(warns.some(m => m.includes('Init failed'))).toBe(true);
  });

  test('_persist catch: storage.set rejection logs warning and does not throw', async () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));

    chrome.storage.local.set.mockRejectedValueOnce(new Error('quota exceeded'));

    // Trigger a debounced persist
    recordActionOutcome('test_platform', 'click', '#btn', true, 100);

    // Advance the debounce timer (5000ms in the module)
    jest.runAllTimers();
    // Flush microtasks from the async _persist
    await Promise.resolve();
    await Promise.resolve();

    console.warn = origWarn;
    expect(warns.some(m => m.includes('Persist failed'))).toBe(true);
  });
});
