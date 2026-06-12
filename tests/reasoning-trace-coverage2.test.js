/**
 * reasoning-trace-coverage2.test.js
 * Targets uncovered branches from the full-suite coverage report:
 *   L40    _persistTrace callback: trace evicted after timer scheduled
 *   L64-65 initReasoningTrace legacy API with no goal/model supplied
 *   L91    captureReasoningStep default data={}
 *   L102-104 phase||'unknown', direction||'unknown', data||{}
 *   L148   trace.entries || [] when entries field is absent
 *   L201   clearReasoningTrace: id !== _currentRunId
 *   L217   getHighConfidenceDecisions: trace evicted from cache
 *   L229   getLowConfidenceDecisions: trace evicted from cache
 *   L242   flushPendingWrites: trace evicted from cache
 */

import { jest } from '@jest/globals';
import {
  initReasoningTrace,
  captureReasoningStep,
  getReasoningSummary,
  getHighConfidenceDecisions,
  getLowConfidenceDecisions,
  clearReasoningTrace,
  flushPendingWrites,
  _resetReasoningTraceCache,
} from '../background/reasoning-trace.js';

const storageMock = {};
globalThis.chrome = {
  storage: {
    local: {
      set: jest.fn(async (obj) => { Object.assign(storageMock, obj); }),
      get: jest.fn(async (keys) => {
        const result = {};
        for (const k of (Array.isArray(keys) ? keys : [keys])) result[k] = storageMock[k];
        return result;
      }),
      remove: jest.fn(async (key) => { delete storageMock[key]; }),
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(storageMock).forEach(k => delete storageMock[k]);
  _resetReasoningTraceCache();
  jest.useFakeTimers();
  chrome.storage.local.set.mockImplementation(async (obj) => { Object.assign(storageMock, obj); });
  chrome.storage.local.get.mockImplementation(async (keys) => {
    const result = {};
    for (const k of (Array.isArray(keys) ? keys : [keys])) result[k] = storageMock[k];
    return result;
  });
  chrome.storage.local.remove.mockImplementation(async (key) => { delete storageMock[key]; });
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Lines 64-65: legacy API with no goal or model supplied ───────────────────────

describe('initReasoningTrace — legacy string API, missing goal and model', () => {
  test('calling with only a runId string sets goal and model to empty string', async () => {
    // arguments[1] = undefined → undefined || '' → '' branch (line 64)
    // arguments[2] = undefined → undefined || '' → '' branch (line 65)
    await initReasoningTrace('legacy-only-runid');
    const summary = await getReasoningSummary();
    expect(summary.goal).toBe('');
    expect(summary.model).toBe('');
  });
});

// ── Line 91: captureReasoningStep default data={} ───────────────────────────────

describe('captureReasoningStep — omitted data uses default {}', () => {
  test('calling without data argument applies the default and succeeds', async () => {
    await initReasoningTrace({ goal: 'default-data-test' });
    await expect(captureReasoningStep('plan', 'input')).resolves.toBeUndefined();
    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(1);
  });
});

// ── Lines 102-104: phase||'unknown', direction||'unknown', data||{} ──────────────

describe('captureReasoningStep — falsy phase / direction / data', () => {
  test('null phase and direction stored as "unknown"; null data stored as {}', async () => {
    await initReasoningTrace({ goal: 'falsy-args-test' });
    await captureReasoningStep(null, null, null);
    jest.runAllTimers();
    await Promise.resolve();

    const key = Object.keys(storageMock).find(k => k.startsWith('reasoning_trace_'));
    const trace = storageMock[key];
    expect(trace.entries).toHaveLength(1);
    expect(trace.entries[0].phase).toBe('unknown');      // line 102 || branch
    expect(trace.entries[0].direction).toBe('unknown');  // line 103 || branch
    expect(trace.entries[0].data).toEqual({});           // line 104 || branch
  });

  test('empty-string phase and direction stored as "unknown"', async () => {
    await initReasoningTrace({ goal: 'empty-str-test' });
    await captureReasoningStep('', '', null);
    jest.runAllTimers();
    await Promise.resolve();

    const key = Object.keys(storageMock).find(k => k.startsWith('reasoning_trace_'));
    const trace = storageMock[key];
    expect(trace.entries[0].phase).toBe('unknown');
    expect(trace.entries[0].direction).toBe('unknown');
  });
});

// ── Line 148: trace.entries || [] when entries field is absent ───────────────────

describe('getReasoningSummary — trace stored without entries field', () => {
  test('missing entries falls back to [] and reports totalSteps=0', async () => {
    // Pre-populate storage with a trace that has no entries property.
    // trace.entries is undefined → undefined || [] → [] branch (line 148).
    storageMock['reasoning_trace_no-entries-run'] = {
      runId: 'no-entries-run',
      goal: 'goal-x',
      model: 'model-y',
    };

    const summary = await getReasoningSummary('no-entries-run');
    expect(summary.totalSteps).toBe(0);
    expect(summary.goal).toBe('goal-x');
    expect(summary.summary).toContain('Run:');
  });
});

// ── Line 201: clearReasoningTrace when id !== _currentRunId ──────────────────────

describe('clearReasoningTrace — clearing a non-current run', () => {
  test('does not nullify _currentRunId when a different run is cleared', async () => {
    await initReasoningTrace({ goal: 'current-run' });

    // Clearing an unrelated id: id !== _currentRunId → _currentRunId stays (line 201 false branch)
    await clearReasoningTrace('completely-unrelated-run-id');

    // _currentRunId is still active, so captureReasoningStep should succeed
    await captureReasoningStep('plan', 'input', {});
    const summary = await getReasoningSummary();
    expect(summary.totalSteps).toBe(1);
  });
});

// ── Line 217: getHighConfidenceDecisions with evicted trace ──────────────────────

describe('getHighConfidenceDecisions — trace evicted from cache', () => {
  test('returns [] when _currentRunId is set but _traceCache has no entry', async () => {
    await initReasoningTrace({ goal: 'evict-high' });

    // Intercept Map.prototype.get: return undefined for run_ keys to simulate eviction
    const origGet = Map.prototype.get;
    Map.prototype.get = function(key) {
      if (typeof key === 'string' && key.startsWith('run_')) {
        Map.prototype.get = origGet;
        return undefined;
      }
      return origGet.call(this, key);
    };

    let result;
    try {
      result = await getHighConfidenceDecisions();
    } finally {
      Map.prototype.get = origGet;
    }

    expect(result).toEqual([]);
  });
});

// ── Line 229: getLowConfidenceDecisions with evicted trace ───────────────────────

describe('getLowConfidenceDecisions — trace evicted from cache', () => {
  test('returns [] when _currentRunId is set but _traceCache has no entry', async () => {
    await initReasoningTrace({ goal: 'evict-low' });

    const origGet = Map.prototype.get;
    Map.prototype.get = function(key) {
      if (typeof key === 'string' && key.startsWith('run_')) {
        Map.prototype.get = origGet;
        return undefined;
      }
      return origGet.call(this, key);
    };

    let result;
    try {
      result = await getLowConfidenceDecisions();
    } finally {
      Map.prototype.get = origGet;
    }

    expect(result).toEqual([]);
  });
});

// ── Line 242: flushPendingWrites with trace evicted ──────────────────────────────

describe('flushPendingWrites — trace evicted during flush', () => {
  test('continues without writing when trace is absent from cache', async () => {
    await initReasoningTrace({ goal: 'flush-evict-test' });
    await captureReasoningStep('plan', 'input', {});
    // Do NOT run timers — _pendingWrites still has an entry for this run

    // Intercept all run_ key lookups to return undefined (simulates eviction)
    const origGet = Map.prototype.get;
    Map.prototype.get = function(key) {
      if (typeof key === 'string' && key.startsWith('run_')) {
        return undefined;
      }
      return origGet.call(this, key);
    };

    chrome.storage.local.set.mockClear();
    try {
      await flushPendingWrites();
    } finally {
      Map.prototype.get = origGet;
    }

    // Line 242: !trace → continue; no storage.set call
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ── Line 40: _persistTrace callback with trace evicted between schedule and fire ─

describe('_persistTrace — trace evicted between schedule and callback fire (line 40)', () => {
  test('live timer callback skips write when trace is missing from cache', async () => {
    await initReasoningTrace({ goal: 'timer-evict-test' });

    // Capture setTimeout callbacks manually (so we control when they fire)
    const captured = [];
    let nextId = 88000;
    const origST = globalThis.setTimeout;
    const origCT = globalThis.clearTimeout;
    globalThis.setTimeout = (cb) => { const id = nextId++; captured.push({ id, cb }); return id; };
    globalThis.clearTimeout = () => {};

    await captureReasoningStep('plan', 'input', {}); // captured[0] id=88000

    globalThis.setTimeout = origST;
    globalThis.clearTimeout = origCT;

    // Now: _pendingWrites has {runId: 88000}, _traceCache has {runId: trace}.
    // Intercept Map.prototype.get so:
    //   - 1st call with run_ key: returns real value (_pendingWrites check — passes line 35)
    //   - 2nd call with run_ key: returns undefined (_traceCache lookup — triggers line 40)
    let getCount = 0;
    const origGet = Map.prototype.get;
    Map.prototype.get = function(key) {
      if (typeof key === 'string' && key.startsWith('run_')) {
        getCount++;
        if (getCount === 2) {
          // _traceCache.get(runId) — simulate eviction
          return undefined;
        }
      }
      return origGet.call(this, key);
    };

    chrome.storage.local.set.mockClear();
    try {
      await captured[0].cb();
    } finally {
      Map.prototype.get = origGet;
    }

    // Line 40: !trace → return; no storage write
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
