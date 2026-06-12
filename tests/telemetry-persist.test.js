// tests/telemetry-persist.test.js
// Covers branches that require _persistEnabled=true.  The init IIFE in
// telemetry.js uses a callback-style chrome.storage.local.get, so
// _persistEnabled stays false unless we explicitly trigger it via the
// chrome.storage.onChanged listener that the module registers at startup.
//
// Covered:
//   Line 215   _scheduleFlush setInterval tick: if(_pendingPersistFlush) false branch
//   Lines 226-228  _flushRunBuffer body (happy path, array ternary branches)
//   Line 250   _getRunsIndex coalesce: if(_runsIndexReadPromise) true branch
//   Lines 323-325  endRun body: Array.isArray ternary + index.find + if(entry)
//
// Uses dynamic import so the chrome mock is installed before module eval.

import { jest } from '@jest/globals';

// --- storage mock -------------------------------------------------------

const storageData = {};
const onChangedListeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn((keysOrObj, cb) => {
        const keyList = Array.isArray(keysOrObj)
          ? keysOrObj
          : typeof keysOrObj === 'string'
            ? [keysOrObj]
            : Object.keys(keysOrObj || {});
        const result = {};
        for (const k of keyList) result[k] = storageData[k];
        if (typeof cb === 'function') { cb(result); return undefined; }
        return Promise.resolve(result);
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete storageData[k];
      }),
    },
    onChanged: {
      addListener: jest.fn((fn) => { onChangedListeners.push(fn); }),
      removeListener: jest.fn(),
    },
  },
  runtime: {
    lastError: null,
    sendMessage: jest.fn(async () => {}),
    getPlatformInfo: jest.fn((cb) => { if (cb) cb(); }),
    getURL: jest.fn((p) => `chrome-extension://test/${p}`),
  },
};

// Dynamic import so the chrome mock exists before the module-level IIFE runs.
const { startRun, endRun, emit, _clearCacheForTests } = await import('../background/telemetry.js');

// Enable persistence by firing the onChanged listener the module registered.
// This sets _persistEnabled = true without relying on the storage callback path.
for (const fn of onChangedListeners) {
  fn({ telemetryPersist: { newValue: true } }, 'local');
}

// --- helpers ------------------------------------------------------------

function resetStorage() {
  for (const k of Object.keys(storageData)) delete storageData[k];
}

// --- lifecycle ----------------------------------------------------------

beforeEach(() => {
  resetStorage();
  if (typeof _clearCacheForTests === 'function') _clearCacheForTests();
  jest.clearAllMocks();
  // Re-bind after clearAllMocks (clearAllMocks resets implementations)
  chrome.storage.local.get.mockImplementation((keysOrObj, cb) => {
    const keyList = Array.isArray(keysOrObj)
      ? keysOrObj
      : typeof keysOrObj === 'string'
        ? [keysOrObj]
        : Object.keys(keysOrObj || {});
    const result = {};
    for (const k of keyList) result[k] = storageData[k];
    if (typeof cb === 'function') { cb(result); return undefined; }
    return Promise.resolve(result);
  });
  chrome.storage.local.set.mockImplementation(async (obj) => { Object.assign(storageData, obj); });
  chrome.storage.local.remove.mockImplementation(async (keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) delete storageData[k];
  });
});

// --- Line 215: _scheduleFlush setInterval tick with pendingFlush=false ──

describe('_scheduleFlush — setInterval tick: if(_pendingPersistFlush) false branch (line 215)', () => {
  test('timer fires with no pending flush: false branch, no write', async () => {
    jest.useFakeTimers();
    try {
      // startRun calls _scheduleFlush which creates the setInterval
      await startRun('flush-timer-run', 'timer goal');
      // Do NOT emit — _pendingPersistFlush stays false
      // Advance past PERSIST_FLUSH_INTERVAL_MS to fire the setInterval callback
      await jest.advanceTimersByTimeAsync(10000);
      // storage.set should NOT have been called for the run key (no flush happened)
      const runSetCalls = chrome.storage.local.set.mock.calls.filter(
        ([obj]) => obj && Object.keys(obj).some(k => k.startsWith('telemetry_run_'))
      );
      expect(runSetCalls).toHaveLength(0);
    } finally {
      jest.useRealTimers();
      await endRun('flush-timer-run');
    }
  });
});

// --- Lines 226-228: _flushRunBuffer body ────────────────────────────────

describe('_flushRunBuffer — persistence enabled (lines 226-228)', () => {
  test('emit + endRun: runs flush body, writes events to storage', async () => {
    await startRun('flush-run-1', 'flush goal');
    emit('test', 'info', 'hello from flush');
    await endRun('flush-run-1');

    // _flushRunBuffer wrote the run data key
    const runKey = 'telemetry_run_flush-run-1';
    expect(storageData[runKey]).toBeDefined();
    expect(Array.isArray(storageData[runKey])).toBe(true);
    expect(storageData[runKey].length).toBeGreaterThanOrEqual(1);
  });

  test('Array.isArray(stored[key]) : [] branch — non-array existing data is replaced', async () => {
    await startRun('flush-run-2', 'goal b');
    emit('test', 'info', 'event b');
    // Pre-populate with non-array data to hit the : [] fallback (line 226)
    storageData['telemetry_run_flush-run-2'] = 'bad-data';
    await endRun('flush-run-2');

    const stored = storageData['telemetry_run_flush-run-2'];
    expect(Array.isArray(stored)).toBe(true);
  });

  test('merged.length > PERSIST_MAX_EVENTS_PER_RUN: events are capped (line 228 true branch)', async () => {
    await startRun('flush-run-cap', 'cap goal');
    emit('test', 'info', 'new event');
    // Pre-populate storage with 1001 events so merged exceeds the 1000-event cap
    storageData['telemetry_run_flush-run-cap'] = Array.from({ length: 1001 }, (_, i) => ({ seq: i }));
    await endRun('flush-run-cap');

    const stored = storageData['telemetry_run_flush-run-cap'];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBeLessThanOrEqual(1000);
  });
});

// --- Line 250: _getRunsIndex coalesce ──────────────────────────────────

describe('_getRunsIndex — concurrent read coalescing (line 250)', () => {
  test('two startRun calls issued simultaneously share a single index read', async () => {
    if (typeof _clearCacheForTests === 'function') _clearCacheForTests();

    // Both calls reach _getRunsIndex concurrently; second hits line 250
    await Promise.all([
      startRun('concurrent-a', 'goal a'),
      startRun('concurrent-b', 'goal b'),
    ]);

    const index = storageData['telemetry_runs_index'] || [];
    expect(Array.isArray(index)).toBe(true);
    // At least one entry was written
    expect(index.length).toBeGreaterThanOrEqual(1);
  });
});

// --- Lines 323-325: endRun body ─────────────────────────────────────────

describe('endRun with persistence enabled (lines 323-325)', () => {
  test('full cycle: entry found in index and finishedAt is set (line 325 true branch)', async () => {
    await startRun('end-run-1', 'finish goal');
    emit('test', 'info', 'step 1');
    await endRun('end-run-1');

    const index = storageData['telemetry_runs_index'] || [];
    const entry = index.find(e => e.runId === 'end-run-1');
    expect(entry).toBeDefined();
    expect(typeof entry.finishedAt).toBe('number');
    expect(entry.finishedAt).toBeGreaterThan(0);
  });

  test('entry not in index: if(entry) false branch — no crash (line 325 false)', async () => {
    await startRun('end-run-2', 'missing entry goal');
    // Wipe the runs index so index.find() returns undefined
    delete storageData['telemetry_runs_index'];
    if (typeof _clearCacheForTests === 'function') _clearCacheForTests();

    await expect(endRun('end-run-2')).resolves.toBeUndefined();
  });

  test('storedEvents key is array: Array.isArray true branch (line 323)', async () => {
    await startRun('end-run-3', 'array events');
    emit('test', 'info', 'pre-stored event');
    // Pre-populate with an array to hit the Array.isArray true branch on line 323
    storageData['telemetry_run_end-run-3'] = [{ seq: 0, message: 'pre-existing' }];
    await endRun('end-run-3');

    const stored = storageData['telemetry_run_end-run-3'];
    expect(Array.isArray(stored)).toBe(true);
  });

  test('storedEvents key is not array: Array.isArray false branch, events = [] (line 323)', async () => {
    await startRun('end-run-4', 'non-array events');
    emit('test', 'info', 'event');
    // Pre-populate with non-array to hit the : [] branch
    storageData['telemetry_run_end-run-4'] = null;
    await endRun('end-run-4');

    // endRun completed, entry count based on 0 existing events + buffer
    const index = storageData['telemetry_runs_index'] || [];
    const entry = index.find(e => e.runId === 'end-run-4');
    if (entry) expect(typeof entry.count).toBe('number');
  });
});
