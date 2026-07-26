/**
 * Tests for background/reasoning-trace.js
 */

import { jest } from '@jest/globals';
import {
  initReasoningTrace,
  captureReasoningStep,
  getReasoningSummary,
  getReasoningTrace,
  clearReasoningTrace,
  reasoningTraceToJson,
  getHighConfidenceDecisions,
  getLowConfidenceDecisions,
  flushPendingWrites,
  _resetReasoningTraceCache
} from '../background/reasoning-trace.js';

// Mock chrome.storage.local
const storageMock = {};
globalThis.chrome = {
  storage: {
    local: {
      set: jest.fn(async (obj) => { Object.assign(storageMock, obj); }),
      get: jest.fn(async (keys) => {
        const result = {};
        for (const k of keys) result[k] = storageMock[k];
        return result;
      }),
      remove: jest.fn(async (key) => { delete storageMock[key]; })
    }
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(storageMock).forEach(k => delete storageMock[k]);
  _resetReasoningTraceCache();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('initReasoningTrace', () => {
  test('creates a new trace and persists it', async () => {
    await initReasoningTrace({ goal: 'test goal', model: 'gpt-4' });
    // First set() persists the trace; a second set() updates the capped
    // reasoning_trace_index (GC bookkeeping) — assert the trace write, not an
    // exact call count.
    expect(chrome.storage.local.set).toHaveBeenCalled();
    const [[stored]] = chrome.storage.local.set.mock.calls;
    const trace = Object.values(stored)[0];
    expect(trace.goal).toBe('test goal');
    expect(trace.model).toBe('gpt-4');
    expect(trace.entries).toEqual([]);
    expect(trace.runId).toMatch(/^run_\d+_/);
  });

  test('creates trace with no metadata', async () => {
    await initReasoningTrace();
    expect(chrome.storage.local.set).toHaveBeenCalled();
    const [[stored]] = chrome.storage.local.set.mock.calls;
    const trace = Object.values(stored)[0];
    expect(trace.goal).toBe('');
    expect(trace.entries).toEqual([]);
  });

  test('generates unique run IDs on each init', async () => {
    await initReasoningTrace();
    const firstCall = Object.values(chrome.storage.local.set.mock.calls[0][0])[0];
    await initReasoningTrace();
    const secondCall = Object.values(chrome.storage.local.set.mock.calls[1][0])[0];
    expect(firstCall.runId).not.toBe(secondCall.runId);
  });

  test('handles storage error gracefully', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage full'));
    await expect(initReasoningTrace()).resolves.not.toThrow();
  });
});

describe('captureReasoningStep', () => {
  test('adds entries to current trace', async () => {
    await initReasoningTrace({ goal: 'navigate' });
    await captureReasoningStep('plan_generation', 'input', { url: 'https://example.com' });
    jest.runAllTimers();
    await Promise.resolve();

    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(1);
  });

  test('supports multiple steps', async () => {
    await initReasoningTrace();
    await captureReasoningStep('plan_generation', 'input', {});
    await captureReasoningStep('plan_generation', 'output', { planSteps: 3 });
    await captureReasoningStep('action_decision', 'input', {});
    jest.runAllTimers();
    await Promise.resolve();

    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(3);
    expect(summary.phases['plan_generation']).toEqual({ inputs: 1, outputs: 1 });
    expect(summary.phases['action_decision']).toEqual({ inputs: 1, outputs: 0 });
  });

  test('does nothing when no active trace', async () => {
    await captureReasoningStep('plan_generation', 'input', {});
    // No error thrown
    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(0);
  });

  test('increments step index on each entry', async () => {
    await initReasoningTrace();
    await captureReasoningStep('phase_a', 'input', {});
    await captureReasoningStep('phase_b', 'input', {});
    jest.runAllTimers();
    await Promise.resolve();

    const trace = await getReasoningSummary();
    expect(trace.totalSteps).toBe(2);
  });
});

describe('getReasoningSummary', () => {
  test('returns zero state with no active trace', async () => {
    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(0);
    expect(summary.goal).toBe('');
    expect(summary.phases).toEqual({});
  });

  test('returns summary with totalSteps', async () => {
    await initReasoningTrace({ goal: 'buy item' });
    await captureReasoningStep('plan_generation', 'output', {});
    jest.runAllTimers();

    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(1);
    expect(summary.goal).toBe('buy item');
  });

  test('summary string is non-empty', async () => {
    await initReasoningTrace({ goal: 'search' });
    await captureReasoningStep('action_decision', 'input', {});
    jest.runAllTimers();

    const { summary } = await getReasoningSummary();
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  test('accepts explicit runId', async () => {
    await initReasoningTrace({ goal: 'first run' });
    jest.runAllTimers();

    // Grab the runId from the stored trace
    const [[stored]] = chrome.storage.local.set.mock.calls;
    const runId = Object.values(stored)[0].runId;

    await clearReasoningTrace(); // clears current

    // Load from storage mock
    const storageKey = Object.keys(stored)[0];
    storageMock[storageKey] = Object.values(stored)[0];

    const summary = await getReasoningSummary(runId);
    expect(summary.goal).toBe('first run');
  });
});

describe('clearReasoningTrace', () => {
  test('clears current trace', async () => {
    await initReasoningTrace({ goal: 'test' });
    await clearReasoningTrace();
    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(0);
  });

  test('calls chrome.storage.local.remove', async () => {
    await initReasoningTrace();
    await clearReasoningTrace();
    expect(chrome.storage.local.remove).toHaveBeenCalledTimes(1);
  });

  test('does nothing when no active trace', async () => {
    await expect(clearReasoningTrace()).resolves.not.toThrow();
  });

  test('handles storage error gracefully', async () => {
    await initReasoningTrace();
    chrome.storage.local.remove.mockRejectedValueOnce(new Error('Remove failed'));
    await expect(clearReasoningTrace()).resolves.not.toThrow();
  });
});

describe('reasoningTraceToJson', () => {
  test('returns JSON string for current trace', async () => {
    await initReasoningTrace({ goal: 'test json' });
    await captureReasoningStep('plan_generation', 'input', {});
    jest.runAllTimers();

    const json = await reasoningTraceToJson();
    const parsed = JSON.parse(json);
    expect(parsed.goal).toBe('test json');
    expect(parsed.entries.length).toBe(1);
  });

  test('returns error JSON when no active trace', async () => {
    const json = await reasoningTraceToJson();
    const parsed = JSON.parse(json);
    expect(parsed.error).toBeDefined();
  });
});

describe('getHighConfidenceDecisions', () => {
  test('returns empty array with no active trace', async () => {
    const result = await getHighConfidenceDecisions();
    expect(result).toEqual([]);
  });

  test('filters by confidence in data', async () => {
    await initReasoningTrace();
    await captureReasoningStep('action_decision', 'output', { confidence: 0.9 });
    await captureReasoningStep('action_decision', 'output', { confidence: 0.3 });
    jest.runAllTimers();

    const high = await getHighConfidenceDecisions(0.8);
    expect(high.length).toBe(1);
    expect(high[0].data.confidence).toBe(0.9);
  });
});

describe('getLowConfidenceDecisions', () => {
  test('returns empty array with no active trace', async () => {
    const result = await getLowConfidenceDecisions();
    expect(result).toEqual([]);
  });

  test('filters by low confidence', async () => {
    await initReasoningTrace();
    await captureReasoningStep('action_decision', 'output', { confidence: 0.9 });
    await captureReasoningStep('action_decision', 'output', { confidence: 0.2 });
    jest.runAllTimers();

    const low = await getLowConfidenceDecisions(0.5);
    expect(low.length).toBe(1);
    expect(low[0].data.confidence).toBe(0.2);
  });
});

describe('flushPendingWrites', () => {
  test('flushes without error when no pending writes', async () => {
    await expect(flushPendingWrites()).resolves.not.toThrow();
  });

  test('persists pending writes immediately', async () => {
    await initReasoningTrace();
    chrome.storage.local.set.mockClear();

    // captureReasoningStep schedules a debounced write — don't advance timers
    await captureReasoningStep('phase', 'input', {});
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    await flushPendingWrites();
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });
});

describe('_resetReasoningTraceCache', () => {
  test('clears all state', async () => {
    await initReasoningTrace({ goal: 'reset test' });
    await captureReasoningStep('phase', 'input', {});
    _resetReasoningTraceCache();

    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(0);
  });
});

describe('initReasoningTrace — backward compat string arg (lines 64-66)', () => {
  test('accepts string first arg for backward compat', async () => {
    await initReasoningTrace('old-run-id', 'my goal', 'claude-3');
    const summary = await getReasoningSummary();
    expect(summary.goal).toBe('my goal');
  });
});

describe('clearReasoningTrace — with pending write (lines 36, 196-197)', () => {
  test('cancels pending debounced write and stale timer returns early', async () => {
    await initReasoningTrace({ goal: 'cancel test' });
    chrome.storage.local.set.mockClear();
    await captureReasoningStep('plan_generation', 'input', {});
    // Timer is pending in _pendingWrites
    await clearReasoningTrace();
    // Advancing timers fires the stale callback — it should hit the cancelled-timer guard (line 36)
    jest.runAllTimers();
    await Promise.resolve();
    // set should NOT have been called for the debounced write since it was cancelled
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe('getReasoningTrace — cache miss paths (lines 131, 133)', () => {
  test('returns null when storage throws (line 131 catch)', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('Storage error'));
    const result = await getReasoningTrace('nonexistent-run-id');
    expect(result).toBeNull();
  });

  test('returns null when trace not in storage (line 133 return null)', async () => {
    // get returns an object but without the key (trace is undefined → falsy)
    const result = await getReasoningTrace('missing-id');
    expect(result).toBeNull();
  });
});

describe('_persistTrace catch — storage error during timer (line 44)', () => {
  test('logs error when storage.set fails during debounced write', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await initReasoningTrace({ goal: 'persist error test' });
    await captureReasoningStep('plan_generation', 'input', {});
    chrome.storage.local.set.mockRejectedValueOnce(new Error('Disk full'));
    jest.runAllTimers();
    // Let the async callback resolve
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist reasoning trace:'),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe('flushPendingWrites — storage error (line 247)', () => {
  test('logs error when storage.set fails during flush', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await initReasoningTrace({ goal: 'flush error test' });
    await captureReasoningStep('plan_generation', 'input', {});
    chrome.storage.local.set.mockRejectedValueOnce(new Error('Quota exceeded'));
    await flushPendingWrites();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to flush reasoning trace:'),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});
