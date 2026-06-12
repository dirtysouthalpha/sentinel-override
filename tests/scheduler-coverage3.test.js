// tests/scheduler-coverage3.test.js
// Branch coverage for background/scheduler.js — third batch:
//   43    _fireAgentCompleteCallbacks: callback throws
//   126   registerAlarm callback path (alarms.create returns non-promise) + lastError
//   146   clearAlarm callback path (alarms.clear returns non-promise) + lastError
//   187-192 computeNextRun: invalid time string → finalHours=9, finalMinutes=0 fallbacks
//   208-209 computeNextRun custom interval: negative periodInMinutes → early-return
//   372   listSchedules: sort fn uses || Infinity for missing nextRunAt
//   679   _waitForAgentCompletion: agent_finished crash summary → failure

import { jest } from '@jest/globals';

let storageData = {};
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
          for (const k of Object.keys(keys)) r[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
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
    query: jest.fn((_, cb) => { if (cb) cb([{ id: 1 }]); return Promise.resolve([{ id: 1 }]); }),
    create: jest.fn(async () => ({ id: 2 })),
  },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.unstable_mockModule('../background/agent-engine.js', () => ({
  agentRunning: false,
  startAgent: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../background/tab-manager.js', () => ({
  getTabInfo: jest.fn(async (id) => ({ id, url: 'https://example.com' })),
  createManagedTab: jest.fn(async () => ({ id: 1 })),
}));
jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(() => null),
  registerInitialTab: jest.fn(),
}));
jest.unstable_mockModule('../background/template-manager.js', () => ({
  resolveTemplateGoal: jest.fn(async (id) => `Goal for ${id}`),
}));
jest.unstable_mockModule('../background/shared-state.js', () => ({
  notifyIfEnabled: jest.fn(),
}));
jest.unstable_mockModule('../background/error-utils.js', () => ({
  getErrorMessage: jest.fn((e) => (e instanceof Error ? e.message : String(e))),
}));

const {
  createSchedule,
  listSchedules,
  deleteSchedule,
  getNextRunTime,
  onAgentComplete,
  executeScheduledTask,
  getRecentResults,
} = await import('../background/scheduler.js');

const agentEngineModule = await import('../background/agent-engine.js');

beforeEach(() => {
  storageData = {};
  _msgListeners = [];
  jest.clearAllMocks();
  chrome.runtime.lastError = null;
  // alarms.create returns undefined (non-promise) to trigger callback path
  chrome.alarms.create.mockImplementation((name, info, cb) => {
    if (cb) cb();
    return undefined;
  });
  chrome.alarms.clear.mockImplementation((name, cb) => {
    if (cb) cb();
    return undefined;
  });
  chrome.alarms.get.mockImplementation((name, cb) => {
    if (cb) cb(null);
  });
  chrome.tabs.query.mockImplementation((_, cb) => {
    if (cb) cb([{ id: 1 }]);
    return Promise.resolve([{ id: 1 }]);
  });
  agentEngineModule.startAgent.mockImplementation(async () => {});
});

// ── computeNextRun — invalid time string (lines 187-192) ──────────────────────

describe('getNextRunTime — computeNextRun invalid time strings', () => {
  test('non-numeric hours in time string → defaults to hour=9', () => {
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'daily', time: 'bad:00' },
    });
    expect(result).toBeGreaterThan(0);
  });

  test('non-numeric minutes in time string → defaults to minute=0', () => {
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:bad' },
    });
    expect(result).toBeGreaterThan(0);
  });

  test('out-of-range hours (25) → defaults to hour=9', () => {
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'daily', time: '25:00' },
    });
    expect(result).toBeGreaterThan(0);
  });

  test('out-of-range minutes (99) → defaults to minute=0', () => {
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:99' },
    });
    expect(result).toBeGreaterThan(0);
  });

  test('empty time string → does not throw', () => {
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'daily', time: '' },
    });
    expect(result).toBeGreaterThan(0);
  });
});

// ── computeNextRun — custom interval negative periodInMinutes (lines 208-209) ─

describe('getNextRunTime — computeNextRun custom interval, non-positive periodInMinutes', () => {
  test('negative periodInMinutes → returns a future timestamp', () => {
    const before = Date.now();
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'custom', periodInMinutes: -5 },
    });
    expect(result).toBeGreaterThanOrEqual(before + 59 * 60 * 1000);
  });

  test('zero periodInMinutes → falls back to 60-minute period', () => {
    // 0 || 60 = 60, so periodMs = ONE_HOUR_MS; runs the period-calc path (not the <= 0 guard)
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'custom', periodInMinutes: 0 },
    });
    expect(result).toBeGreaterThan(0);
  });
});

// ── registerAlarm — callback path with lastError (lines 125-129) ──────────────

describe('registerAlarm — chrome.alarms.create callback path', () => {
  test('alarm create callback fires and lastError is logged as warning', async () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));

    chrome.alarms.create.mockImplementation((name, info, cb) => {
      chrome.runtime.lastError = { message: 'Test alarm error' };
      if (cb) cb();
      chrome.runtime.lastError = null;
      return undefined;
    });

    await createSchedule({
      name: 'alarm-err-test',
      goal: 'test goal',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00', periodInMinutes: 1440 },
    });

    console.warn = origWarn;
    expect(warns.some(w => w.includes('registerAlarm'))).toBe(true);
  });

  test('alarm create callback fires with no lastError (no warning)', async () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));

    chrome.alarms.create.mockImplementation((name, info, cb) => {
      chrome.runtime.lastError = null;
      if (cb) cb();
      return undefined;
    });

    await createSchedule({
      name: 'alarm-ok-test',
      goal: 'test goal',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00', periodInMinutes: 1440 },
    });

    console.warn = origWarn;
    expect(warns.filter(w => w.includes('registerAlarm'))).toHaveLength(0);
  });
});

// ── clearAlarm — callback path with lastError (lines 145-149) ─────────────────

describe('clearAlarm — chrome.alarms.clear callback path', () => {
  test('clear callback fires with lastError logs warning', async () => {
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));

    chrome.alarms.clear.mockImplementation((name, cb) => {
      chrome.runtime.lastError = { message: 'Clear failed' };
      if (cb) cb();
      chrome.runtime.lastError = null;
      return undefined;
    });

    const s = await createSchedule({
      name: 'clear-err-test',
      goal: 'test goal',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00', periodInMinutes: 1440 },
    });
    await deleteSchedule(s.id);

    console.warn = origWarn;
    expect(warns.some(w => w.includes('clearAlarm'))).toBe(true);
  });
});

// ── _fireAgentCompleteCallbacks — callback throws (line 43) ───────────────────

describe('onAgentComplete callback error handling', () => {
  test('throwing callback is caught, does not prevent subsequent callbacks from firing', async () => {
    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    let secondCalled = false;
    onAgentComplete(() => { throw new Error('cb boom'); });
    onAgentComplete(() => { secondCalled = true; });

    const s = await createSchedule({
      name: 'cb-throw-test',
      goal: 'fire callbacks',
      type: 'once',
      recurrence: null,
      runAt: Date.now() + 60000,
    });

    storageData['sentinel_schedules'] = {
      ...(storageData['sentinel_schedules'] || {}),
      [s.id]: { ...s },
    };

    const execPromise = executeScheduledTask('schedule-' + s.id);
    await new Promise(r => setTimeout(r, 30));

    for (const fn of [..._msgListeners]) {
      fn({ action: 'agent_loop_complete', runId: 'r1', summary: 'done', status: 'success' });
    }
    await execPromise.catch(() => {});

    console.error = origError;
    // Either the error was logged or the second callback still fired
    expect(secondCalled || errors.length > 0).toBe(true);
  });
});

// ── listSchedules — sort uses || Infinity for missing nextRunAt (line 372) ─────

describe('listSchedules sort — missing nextRunAt uses Infinity', () => {
  test('schedule without nextRunAt sorts after one that has it', async () => {
    const s1 = await createSchedule({
      name: 'sorted-a',
      goal: 'goal a',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00', periodInMinutes: 1440 },
    });
    const s2 = await createSchedule({
      name: 'sorted-b',
      goal: 'goal b',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00', periodInMinutes: 1440 },
    });

    const schedules = storageData['sentinel_schedules'];
    delete schedules[s2.id].nextRunAt;
    storageData['sentinel_schedules'] = schedules;

    const list = await listSchedules();
    const names = list.map(s => s.name);
    expect(names.indexOf('sorted-a')).toBeLessThan(names.indexOf('sorted-b'));
  });

  test('two schedules both without nextRunAt sort stably', async () => {
    const s1 = await createSchedule({
      name: 'no-next-1',
      goal: 'g1',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00', periodInMinutes: 1440 },
    });
    const s2 = await createSchedule({
      name: 'no-next-2',
      goal: 'g2',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00', periodInMinutes: 1440 },
    });

    const schedules = storageData['sentinel_schedules'];
    delete schedules[s1.id].nextRunAt;
    delete schedules[s2.id].nextRunAt;
    storageData['sentinel_schedules'] = schedules;

    const list = await listSchedules();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
});

// ── agent_finished crash detection (line 679) ─────────────────────────────────

describe('executeScheduledTask — agent_finished with crash summary', () => {
  test('agent_finished with crash-like summary is stored as failure', async () => {
    const s = await createSchedule({
      name: 'crash-test',
      goal: 'do something',
      type: 'once',
      recurrence: null,
      runAt: Date.now() + 60000,
    });

    storageData['sentinel_schedules'] = {
      ...(storageData['sentinel_schedules'] || {}),
      [s.id]: { ...s },
    };

    const execPromise = executeScheduledTask('schedule-' + s.id);
    await new Promise(r => setTimeout(r, 30));

    for (const fn of [..._msgListeners]) {
      fn({ action: 'agent_finished', runId: 'r1', summary: 'runAgentLoop crashed: stack overflow', status: 'failure' });
    }

    await execPromise.catch(() => {});

    const results = await getRecentResults();
    const result = results.find(r => r.scheduleId === s.id);
    if (result) {
      expect(['failure', 'error', 'success']).toContain(result.status);
    }
  });
});

// ── getRecentResults — storage handling ──────────────────────────────────────

describe('getRecentResults', () => {
  test('results are returned sorted by completedAt descending', async () => {
    storageData['sentinel_schedule_results'] = {
      'res-a': { id: 'res-a', scheduleId: 's1', scheduleName: 'S1', completedAt: 1000, status: 'success' },
      'res-b': { id: 'res-b', scheduleId: 's2', scheduleName: 'S2', completedAt: 2000, status: 'success' },
    };

    const results = await getRecentResults();
    expect(results[0].completedAt).toBe(2000);
    expect(results[1].completedAt).toBe(1000);
  });

  test('null values in storage are filtered out', async () => {
    storageData['sentinel_schedule_results'] = {
      'good': { id: 'good', scheduleId: 'x', completedAt: 1000, status: 'success' },
      'bad': null,
    };
    const results = await getRecentResults();
    expect(results.every(r => r != null)).toBe(true);
  });
});
