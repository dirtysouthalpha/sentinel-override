// tests/scheduler-legacy-paths.test.js
// Branch coverage for background/scheduler.js uncovered lines:
//   126-127  registerAlarm — legacy chrome.alarms.create callback with chrome.runtime.lastError
//   146-147  clearAlarm — legacy chrome.alarms.clear callback with chrome.runtime.lastError
//   658      _getOrCreateTab — throws when chrome.tabs.create returns a tab with no id
//   674-675  _waitForAgentCompletion — timeout path fires after FIVE_MINUTES_MS
//   686-688  _waitForAgentCompletion — agent_finished crash fast-fail message
//   840-842  initScheduler — chrome.alarms.get lastError path

import { jest } from '@jest/globals';

let storageData = {};
let _agentRunning = false;
let _msgListeners = [];
let _usingFakeTimers = false;

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(async () => {}),
    },
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    get: jest.fn(),
  },
  notifications: { create: jest.fn() },
  runtime: {
    getURL: jest.fn((path) => 'chrome-extension://xxx/' + path),
    sendMessage: jest.fn(() => Promise.resolve()),
    onMessage: {
      addListener: jest.fn((fn) => { _msgListeners.push(fn); }),
      removeListener: jest.fn((fn) => { _msgListeners = _msgListeners.filter(l => l !== fn); }),
    },
  },
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
  },
  tabs: {
    query: jest.fn(),
    create: jest.fn(),
  },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  },
}));

jest.unstable_mockModule('../background/agent-engine.js', () => ({
  get agentRunning() { return _agentRunning; },
  startAgent: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/template-manager.js', () => ({
  resolveTemplateGoal: jest.fn(async (id) => 'Resolved: ' + id),
}));

jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(() => null),
  registerInitialTab: jest.fn(),
}));

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com', title: 'Test' })),
  waitForPageLoad: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/shared-state.js', () => ({
  onAgentCompletion: jest.fn(() => () => {}),
  emitAgentCompletion: jest.fn(),
  notifyIfEnabled: jest.fn(),
}));

const [agentEngineMod] = await Promise.all([
  import('../background/agent-engine.js'),
]);

const {
  createSchedule,
  deleteSchedule,
  toggleSchedule,
  executeScheduledTask,
  initScheduler,
} = await import('../background/scheduler.js');

function restoreStorageMocks() {
  chrome.storage.local.get.mockImplementation(async (keys) => {
    if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
      const result = {};
      for (const k of Object.keys(keys)) {
        result[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
      }
      return result;
    }
    const key = Array.isArray(keys) ? keys[0] : keys;
    return { [key]: storageData[key] !== undefined ? storageData[key] : undefined };
  });
  chrome.storage.local.set.mockImplementation(async (obj) => Object.assign(storageData, obj));
  chrome.alarms.get.mockImplementation((name, cb) => { if (cb) cb(null); });
  chrome.runtime.onMessage.addListener.mockImplementation((fn) => { _msgListeners.push(fn); });
  chrome.runtime.onMessage.removeListener.mockImplementation((fn) => {
    _msgListeners = _msgListeners.filter(l => l !== fn);
  });
  agentEngineMod.startAgent.mockImplementation(async () => {});
}

beforeEach(() => {
  storageData = {};
  _agentRunning = false;
  _msgListeners = [];
  _usingFakeTimers = false;
  jest.resetAllMocks();
  restoreStorageMocks();
  delete chrome.runtime.lastError;
});

afterEach(() => {
  if (_usingFakeTimers) {
    jest.useRealTimers();
    _usingFakeTimers = false;
  }
  delete chrome.runtime.lastError;
});

// ========== registerAlarm legacy callback — lines 126-127 ==========

describe('registerAlarm legacy callback lastError', () => {
  test('warns when alarms.create legacy callback fires with chrome.runtime.lastError set', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Return undefined (not a Promise) so the legacy callback branch is taken.
    // On the second call (3 args with callback), invoke the callback with lastError.
    chrome.alarms.create.mockImplementation((name, info, cb) => {
      if (cb) {
        chrome.runtime.lastError = { message: 'alarm registration failed' };
        cb();
        delete chrome.runtime.lastError;
      }
      return undefined;
    });

    await createSchedule({
      name: 'Legacy Alarm Test',
      goal: 'test goal',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[Sentinel/scheduler] registerAlarm lastError:',
      'alarm registration failed',
    );

    warnSpy.mockRestore();
  });
});

// ========== clearAlarm legacy callback — lines 146-147 ==========

describe('clearAlarm legacy callback lastError', () => {
  test('warns when alarms.clear legacy callback fires with chrome.runtime.lastError set', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // createSchedule with default alarms.create (returns undefined, callback not invoked)
    const schedule = await createSchedule({
      name: 'Legacy Clear Test',
      goal: 'test goal',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    // Return undefined so the legacy callback branch is taken.
    // On the second call (2 args with callback), invoke the callback with lastError.
    chrome.alarms.clear.mockImplementation((name, cb) => {
      if (cb) {
        chrome.runtime.lastError = { message: 'alarm clear failed' };
        cb();
        delete chrome.runtime.lastError;
      }
      return undefined;
    });

    await deleteSchedule(schedule.id);

    expect(warnSpy).toHaveBeenCalledWith(
      '[Sentinel/scheduler] clearAlarm lastError:',
      'alarm clear failed',
    );

    warnSpy.mockRestore();
  });

  test('also reached via toggleSchedule(id, false) disabling a schedule', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const schedule = await createSchedule({
      name: 'Toggle Disable Test',
      goal: 'test',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    chrome.alarms.clear.mockImplementation((name, cb) => {
      if (cb) {
        chrome.runtime.lastError = { message: 'clear via toggle' };
        cb();
        delete chrome.runtime.lastError;
      }
      return undefined;
    });

    await toggleSchedule(schedule.id, false);

    expect(warnSpy).toHaveBeenCalledWith(
      '[Sentinel/scheduler] clearAlarm lastError:',
      'clear via toggle',
    );

    warnSpy.mockRestore();
  });
});

// ========== _getOrCreateTab throws — line 658 ==========

describe('_getOrCreateTab throws when tab has no id', () => {
  test('handleTaskFailure is called when tabs.create returns a tab without id', async () => {
    jest.useFakeTimers();
    _usingFakeTimers = true;

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // No active tab found
    chrome.tabs.query.mockImplementation((opts, cb) => { cb([]); });
    // tabs.create returns an object with no id
    chrome.tabs.create.mockResolvedValue({ url: 'about:blank' });

    const schedule = await createSchedule({
      name: 'No Tab ID Test',
      goal: 'test goal',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    const execPromise = executeScheduledTask(`schedule-${schedule.id}`);
    // Advance past the 500ms delay after tab creation
    await jest.advanceTimersByTimeAsync(600);
    await execPromise;

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to get/create tab:',
      'Failed to create tab',
    );

    errorSpy.mockRestore();
  });
});

// ========== _waitForAgentCompletion timeout — lines 674-675 ==========

describe('_waitForAgentCompletion timeout path', () => {
  test('resolves with failure status after 5-minute timeout', async () => {
    jest.useFakeTimers();
    _usingFakeTimers = true;

    // eslint-disable-next-line no-unused-vars
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Return a valid tab so execution proceeds to _waitForAgentCompletion
    chrome.tabs.query.mockImplementation((opts, cb) => { cb([{ id: 42 }]); });

    const schedule = await createSchedule({
      name: 'Timeout Test',
      goal: 'test goal',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    const execPromise = executeScheduledTask(`schedule-${schedule.id}`);
    // Advance past the 5-minute agent completion timeout (300,000ms)
    await jest.advanceTimersByTimeAsync(300001);
    await execPromise;

    const stored = storageData['sentinel_schedule_results'] || {};
    const results = Object.values(stored);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].status).toBe('failure');
    expect(results[0].error).toContain('timed out');

    warnSpy.mockRestore();
  });
});

// ========== _waitForAgentCompletion crash fast-fail — lines 686-688 ==========

describe('_waitForAgentCompletion crash fast-fail', () => {
  beforeEach(() => {
    // Ensure real timers regardless of what prior tests did
    jest.useRealTimers();
  });

  test('resolves with failure when agent_finished crash message is received', async () => {
    chrome.tabs.query.mockImplementation((opts, cb) => { cb([{ id: 42 }]); });

    const schedule = await createSchedule({
      name: 'Crash Fast-Fail Test',
      goal: 'test goal',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    const execPromise = executeScheduledTask(`schedule-${schedule.id}`);

    // Wait for the event loop to reach await completionPromise
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    // Fire the crash message through all registered onMessage listeners
    for (const listener of [..._msgListeners]) {
      listener({ action: 'agent_finished', summary: 'Agent crashed unexpectedly' });
    }

    await execPromise;

    const stored = storageData['sentinel_schedule_results'] || {};
    const results = Object.values(stored);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].status).toBe('failure');
    expect(results[0].error).toContain('crashed');
  });

  test('only fast-fails on summary matching CRASH_SUMMARY_RE (/crash|unexpected/i)', async () => {
    chrome.tabs.query.mockImplementation((opts, cb) => { cb([{ id: 42 }]); });

    const schedule = await createSchedule({
      name: 'Crash Regex Test',
      goal: 'test goal',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    const execPromise = executeScheduledTask(`schedule-${schedule.id}`);

    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    // Non-matching message should be ignored (no fast-fail)
    for (const listener of [..._msgListeners]) {
      listener({ action: 'agent_finished', summary: 'normal completion' });
    }
    // Then send the matching crash message
    for (const listener of [..._msgListeners]) {
      listener({ action: 'agent_finished', summary: 'unexpected error occurred' });
    }

    await execPromise;

    const stored = storageData['sentinel_schedule_results'] || {};
    const results = Object.values(stored);
    expect(results[0].status).toBe('failure');
    expect(results[0].error).toBe('unexpected error occurred');
  });
});

// ========== initScheduler alarms.get lastError — lines 840-842 ==========

describe('initScheduler alarms.get lastError path', () => {
  test('warns and treats alarm as absent when alarms.get fires lastError in callback', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Ensure there is an enabled schedule so initScheduler enters the loop
    await createSchedule({
      name: 'Init LastError Test',
      goal: 'test goal',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    // Make alarms.get invoke callback with lastError set
    chrome.alarms.get.mockImplementation((name, cb) => {
      if (cb) {
        chrome.runtime.lastError = { message: 'alarms.get failed' };
        cb(null);
        delete chrome.runtime.lastError;
      }
    });

    await initScheduler();

    expect(warnSpy).toHaveBeenCalledWith(
      '[Sentinel/scheduler] alarms.get lastError:',
      'alarms.get failed',
    );

    warnSpy.mockRestore();
  });

  test('re-registers alarm after lastError (treats missing alarm as needing re-registration)', async () => {
    // Suppress warnings
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await createSchedule({
      name: 'ReRegister After LastError',
      goal: 'test goal',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    chrome.alarms.get.mockImplementation((name, cb) => {
      if (cb) {
        chrome.runtime.lastError = { message: 'alarms.get failed' };
        cb(null);
        delete chrome.runtime.lastError;
      }
    });

    const createCallsBefore = chrome.alarms.create.mock.calls.length;
    await initScheduler();

    // alarms.create should have been called to re-register (alarm was treated as absent)
    expect(chrome.alarms.create.mock.calls.length).toBeGreaterThan(createCallsBefore);
  });
});
