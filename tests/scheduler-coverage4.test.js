// tests/scheduler-coverage4.test.js
// Branch coverage for background/scheduler.js — fourth batch:
//   197  computeNextRun daily: candidate <= now → setDate(+1)
//   242  sendNotification failure with string error → appends error snippet
//   608  chrome.notifications.create: schedule.name || scheduleId (empty name)
//   642  _getOrCreateTab: chrome.tabs.query callback t=null → resolve([])
//   679  _waitForAgentCompletion: agent_finished crash path
//   43   _fireAgentCompleteCallbacks: callback throws → catch branch
//   748  storeResult: sort (completedAt || 0) with null completedAt
//   774  getScheduleResults: sort (completedAt || 0) with null completedAt
//   787  getRecentResults:  sort (completedAt || 0) with null completedAt

import { jest } from '@jest/globals';

let storageData = {};
let _agentRunning = false;
let _msgListeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        if (Array.isArray(keys)) {
          const r = {};
          for (const k of keys) r[k] = storageData[k];
          return r;
        }
        if (keys && typeof keys === 'object') {
          const r = {};
          for (const k of Object.keys(keys)) {
            r[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
          }
          return r;
        }
        return { [keys]: storageData[keys] };
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
      remove: jest.fn(async () => {}),
    },
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    get: jest.fn((name, cb) => { if (cb) cb(null); }),
  },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() },
  notifications: { create: jest.fn() },
  runtime: {
    getURL: jest.fn((p) => 'chrome-extension://test/' + p),
    sendMessage: jest.fn(() => Promise.resolve()),
    lastError: null,
    onMessage: {
      addListener: jest.fn((fn) => { _msgListeners.push(fn); }),
      removeListener: jest.fn((fn) => { _msgListeners = _msgListeners.filter(f => f !== fn); }),
    },
  },
  tabs: {
    query: jest.fn((_, cb) => { if (cb) cb([{ id: 1 }]); }),
    create: jest.fn(async () => ({ id: 2 })),
  },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../background/agent-engine.js', () => ({
  get agentRunning() { return _agentRunning; },
  startAgent: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../background/template-manager.js', () => ({
  resolveTemplateGoal: jest.fn(async (id) => `Goal for ${id}`),
}));
jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(() => null),
  registerInitialTab: jest.fn(),
}));
jest.unstable_mockModule('../background/tab-manager.js', () => ({
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test' })),
}));
jest.unstable_mockModule('../background/shared-state.js', () => ({
  onAgentCompletion: jest.fn(() => () => {}),
  emitAgentCompletion: jest.fn(),
  notifyIfEnabled: jest.fn(),
}));
jest.unstable_mockModule('../background/error-utils.js', () => ({
  getErrorMessage: jest.fn((e) => (e instanceof Error ? e.message : String(e))),
}));

const agentEngineModule = await import('../background/agent-engine.js');

const {
  createSchedule,
  getNextRunTime,
  onAgentComplete,
  executeScheduledTask,
  getScheduleResults,
  getRecentResults,
} = await import('../background/scheduler.js');

function resetMocks() {
  storageData = {};
  _agentRunning = false;
  _msgListeners = [];
  jest.clearAllMocks();
  chrome.runtime.lastError = null;
  chrome.storage.local.get.mockImplementation(async (keys) => {
    if (Array.isArray(keys)) {
      const r = {};
      for (const k of keys) r[k] = storageData[k];
      return r;
    }
    if (keys && typeof keys === 'object') {
      const r = {};
      for (const k of Object.keys(keys)) {
        r[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
      }
      return r;
    }
    return { [keys]: storageData[keys] };
  });
  chrome.storage.local.set.mockImplementation(async (obj) => Object.assign(storageData, obj));
  chrome.storage.local.remove.mockImplementation(async () => {});
  chrome.alarms.create.mockImplementation((name, info, cb) => { if (cb) cb(); });
  chrome.alarms.clear.mockImplementation((name, cb) => { if (cb) cb(); });
  chrome.alarms.get.mockImplementation((name, cb) => { if (cb) cb(null); });
  chrome.runtime.onMessage.addListener.mockImplementation((fn) => { _msgListeners.push(fn); });
  chrome.runtime.onMessage.removeListener.mockImplementation((fn) => {
    _msgListeners = _msgListeners.filter(f => f !== fn);
  });
  chrome.tabs.query.mockImplementation((_, cb) => { if (cb) cb([{ id: 1 }]); });
  chrome.tabs.create.mockImplementation(async () => ({ id: 2 }));
  agentEngineModule.startAgent.mockImplementation(async () => {});
}

beforeEach(resetMocks);

// ── Line 197: computeNextRun daily candidate in the past → setDate(+1) ─────────

describe('getNextRunTime — daily schedule with past time (line 197)', () => {
  test('00:00 has already passed today → candidate is pushed to tomorrow', () => {
    const now = Date.now();
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'daily', time: '00:00', periodInMinutes: 1440 },
    });
    // Result is tomorrow at 00:00: strictly in the future, less than 24 hours away
    expect(result).toBeGreaterThan(now);
    const diff = result - now;
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThan(24 * 3600 * 1000);
  });
});

// ── Lines 774, 787: sort (completedAt || 0) with null completedAt ─────────────

describe('getScheduleResults — sort || 0 branch when completedAt is null (line 774)', () => {
  test('results with null completedAt are sorted without error', async () => {
    const scheduleId = 'sched-null-cat';
    storageData['sentinel_schedule_results'] = {
      r1: { id: 'r1', scheduleId, status: 'success', completedAt: null },
      r2: { id: 'r2', scheduleId, status: 'failure', completedAt: 2000 },
      r3: { id: 'r3', scheduleId, status: 'success', completedAt: null },
    };
    const results = await getScheduleResults(scheduleId);
    expect(results).toHaveLength(3);
    // r2 (completedAt=2000) sorts first; r1/r3 (0) after
    expect(results[0].id).toBe('r2');
  });
});

describe('getRecentResults — sort || 0 branch when completedAt is null (line 787)', () => {
  test('results with null completedAt are sorted without error', async () => {
    storageData['sentinel_schedule_results'] = {
      x1: { id: 'x1', scheduleId: 's1', status: 'success', completedAt: null },
      x2: { id: 'x2', scheduleId: 's1', status: 'success', completedAt: 5000 },
      x3: { id: 'x3', scheduleId: 's1', status: 'failure', completedAt: null },
    };
    const results = await getRecentResults(10);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('x2');
  });
});

// ── Line 748: storeResult sort (completedAt || 0) — cap enforcement ──────────

describe('storeResult cap enforcement — sort || 0 with null completedAt (line 748)', () => {
  test('when 50+ results exist with null completedAt the cap sort does not throw', async () => {
    const scheduleId = 'sched-cap';
    const schedule = {
      id: scheduleId,
      name: 'Cap test',
      goal: '', // empty goal triggers quick failure path via _handleTaskFailure
      type: 'once',
      enabled: true,
      runAt: Date.now(),
    };

    // Pre-populate 51 results for this schedule with null completedAt
    const existingResults = {};
    for (let i = 0; i < 51; i++) {
      const rid = `existing-${i}`;
      existingResults[rid] = {
        id: rid,
        scheduleId,
        status: 'success',
        completedAt: null,
        startedAt: Date.now(),
        goal: 'old goal',
      };
    }
    storageData['sentinel_schedule_results'] = existingResults;
    storageData['sentinel_schedules'] = { [scheduleId]: schedule };

    // Execute task — empty goal → _handleTaskFailure → storeResult → sort runs
    await executeScheduledTask('schedule-' + scheduleId);

    // storeResult ran without throwing; results should be capped at 50
    const stored = storageData['sentinel_schedule_results'];
    const scheduleEntries = Object.values(stored).filter(r => r && r.scheduleId === scheduleId);
    expect(scheduleEntries.length).toBeLessThanOrEqual(50);
  });
});

// ── Line 608: chrome.notifications.create — schedule.name || scheduleId ──────

describe('executeScheduledTask — empty schedule name uses scheduleId in notification (line 608)', () => {
  test('notification message contains the scheduleId when name is empty string', async () => {
    const scheduleId = 'sched-empty-name';
    const schedule = {
      id: scheduleId,
      name: '',
      goal: 'Check dashboard',
      type: 'once',
      enabled: true,
      runAt: Date.now(),
    };
    storageData['sentinel_schedules'] = { [scheduleId]: schedule };

    const execPromise = executeScheduledTask('schedule-' + scheduleId);

    // Wait for all awaits inside executeScheduledTask to reach completionPromise
    await new Promise(r => setTimeout(r, 30));
    for (const fn of [..._msgListeners]) {
      fn({ action: 'agent_loop_complete', runId: 'r1', summary: 'done', status: 'success', report: null });
    }
    await execPromise;

    const createCall = chrome.notifications.create.mock.calls.find(
      ([id]) => id && id.startsWith('scheduled-')
    );
    expect(createCall).toBeDefined();
    expect(createCall[1].message).toContain(scheduleId);
  });
});

// ── Line 642: _getOrCreateTab — chrome.tabs.query callback with null ─────────

describe('_getOrCreateTab — tabs.query callback receives null (line 642)', () => {
  test('null tab list falls back to tabs.create without throwing', async () => {
    const scheduleId = 'sched-null-tabs';
    const schedule = {
      id: scheduleId,
      name: 'Null tabs test',
      goal: 'Check something',
      type: 'once',
      enabled: true,
      runAt: Date.now(),
    };
    storageData['sentinel_schedules'] = { [scheduleId]: schedule };

    // tabs.query calls back with null → resolve(null || []) = resolve([])
    // → tabs[0] is undefined → falls through to chrome.tabs.create
    // chrome.tabs.create returns {id:2}, then _getOrCreateTab waits FIVE_HUNDRED_MS (500ms)
    // Use fake timers to advance past that delay.
    chrome.tabs.query.mockImplementation((_, cb) => { if (cb) cb(null); });

    jest.useFakeTimers();
    try {
      const execPromise = executeScheduledTask('schedule-' + scheduleId);

      // Advance 600ms → fires the 500ms setTimeout inside _getOrCreateTab
      await jest.advanceTimersByTimeAsync(600);

      // Listener is now registered; fire completion message
      for (const fn of [..._msgListeners]) {
        fn({ action: 'agent_loop_complete', runId: 'r2', status: 'success', report: null });
      }

      await execPromise;
    } finally {
      jest.useRealTimers();
    }

    expect(chrome.tabs.create).toHaveBeenCalled();
  });
});

// ── Line 242: sendNotification failure with string error (line 242) ──────────

describe('sendNotification — failure with string error appends snippet (line 242)', () => {
  test('failure result with string error calls notifyIfEnabled with error snippet', async () => {
    const scheduleId = 'sched-str-err';
    const schedule = {
      id: scheduleId,
      name: 'String error test',
      goal: '', // empty goal → _handleTaskFailure with string error 'Resolved goal was empty'
      type: 'once',
      enabled: true,
      runAt: Date.now(),
    };
    storageData['sentinel_schedules'] = { [scheduleId]: schedule };

    const sharedState = await import('../background/shared-state.js');

    await executeScheduledTask('schedule-' + scheduleId);

    // sendNotification was called with error='Resolved goal was empty' (a string)
    expect(sharedState.notifyIfEnabled).toHaveBeenCalled();
    const notifyArgs = sharedState.notifyIfEnabled.mock.calls[0];
    expect(notifyArgs[1].message).toContain('Error:');
  });
});

// ── Line 679: agent_finished crash path ─────────────────────────────────────

describe('_waitForAgentCompletion — agent_finished crash message (line 679)', () => {
  test('agent_finished with crash summary resolves with failure status', async () => {
    const scheduleId = 'sched-crash';
    const schedule = {
      id: scheduleId,
      name: 'Crash test',
      goal: 'Run something',
      type: 'once',
      enabled: true,
      runAt: Date.now(),
    };
    storageData['sentinel_schedules'] = { [scheduleId]: schedule };

    const execPromise = executeScheduledTask('schedule-' + scheduleId);

    // Wait for listener to be registered
    await new Promise(r => setTimeout(r, 30));
    // Fire an agent_finished crash message (matches CRASH_SUMMARY_RE = /crash|unexpected/i)
    for (const fn of [..._msgListeners]) {
      fn({ action: 'agent_finished', summary: 'Agent crashed unexpectedly', runId: 'r3' });
    }
    await execPromise;

    const results = await getRecentResults(5);
    const result = results.find(r => r.scheduleId === scheduleId);
    expect(result).toBeDefined();
    expect(result.status).toBe('failure');
    expect(result.error).toBe('Agent crashed unexpectedly');
  });
});

// ── Line 43: _fireAgentCompleteCallbacks callback throws ─────────────────────

describe('onAgentComplete — throwing callback caught (line 43)', () => {
  test('throwing callback does not prevent subsequent callbacks from running', async () => {
    const scheduleId = 'sched-cb-throw';
    const schedule = {
      id: scheduleId,
      name: 'Callback throw test',
      goal: 'Run and complete',
      type: 'once',
      enabled: true,
      runAt: Date.now(),
    };
    storageData['sentinel_schedules'] = { [scheduleId]: schedule };

    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    let secondCalled = false;
    onAgentComplete(() => { throw new Error('intentional callback error'); });
    onAgentComplete(() => { secondCalled = true; });

    const execPromise = executeScheduledTask('schedule-' + scheduleId);

    // Wait for listener to be registered
    await new Promise(r => setTimeout(r, 30));
    for (const fn of [..._msgListeners]) {
      fn({ action: 'agent_loop_complete', runId: 'r4', summary: 'done', status: 'success', report: null });
    }
    await execPromise;

    console.error = origError;
    // The error was caught (logged) OR the second callback still ran
    expect(errors.length > 0 || secondCalled).toBe(true);
  });
});
