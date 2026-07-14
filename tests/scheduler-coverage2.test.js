// tests/scheduler-coverage2.test.js
// Branch coverage for background/scheduler.js — second batch of uncovered lines:
//   109   registerAlarm early return when nextRunAt is falsy
//   680   _waitForAgentCompletion listener guard (null / non-object / array messages)

import { jest } from '@jest/globals';

let storageData = {};
let _agentRunning = false;
let _msgListeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
          const result = {};
          for (const k of Object.keys(keys)) {
            result[k] = storageData[k] !== undefined ? storageData[k] : keys[k];
          }
          return result;
        }
        const key = Array.isArray(keys) ? (keys.length > 0 ? keys[0] : undefined) : keys;
        return { [key]: storageData[key] !== undefined ? storageData[key] : undefined };
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
      remove: jest.fn(async () => {}),
    },
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    get: jest.fn(async (name, cb) => { if (cb) cb(null); }),
  },
  notifications: { create: jest.fn() },
  runtime: {
    getURL: jest.fn((path) => 'chrome-extension://xxx/' + path),
    sendMessage: jest.fn(() => Promise.resolve()),
    onMessage: {
      addListener: jest.fn((fn) => { _msgListeners.push(fn); }),
      removeListener: jest.fn(),
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

// agentRunning: false (data property) — agent busy path not taken
jest.unstable_mockModule('../background/agent-engine.js', () => ({
  agentRunning: false,
  startAgent: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/template-manager.js', () => ({
  resolveTemplateGoal: jest.fn(async (id, _params) => 'Resolved: ' + id),
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

const _mockModules = await Promise.all([
  import('../background/agent-engine.js'),
  import('../background/template-manager.js'),
  import('../background/shared-state.js'),
]);

const {
  createSchedule,
  toggleSchedule,
  executeScheduledTask,
} = await import('../background/scheduler.js');

function resetChromeMocks() {
  _msgListeners = [];
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
  chrome.storage.local.remove.mockImplementation(async () => {});
  chrome.alarms.get.mockImplementation(async (name, cb) => { if (cb) cb(null); });
  chrome.runtime.onMessage.addListener.mockImplementation((fn) => { _msgListeners.push(fn); });

  for (const mod of _mockModules) {
    for (const val of Object.values(mod)) {
      if (val && typeof val === 'function' && typeof val.mockReset === 'function') {
        val.mockReset();
      }
    }
  }
  const [agentEngine, templateManager] = _mockModules;
  if (agentEngine.startAgent) agentEngine.startAgent.mockImplementation(async () => {});
  if (templateManager.resolveTemplateGoal) {
    templateManager.resolveTemplateGoal.mockImplementation(async (id, _p) => 'Resolved: ' + id);
  }
}

function setupExecutionMocks({ tabId = 42 } = {}) {
  resetChromeMocks();
  chrome.tabs.query.mockImplementation((opts, cb) => {
    if (cb) cb([{ id: tabId }]);
    return Promise.resolve([{ id: tabId }]);
  });
}

async function fireAgentComplete(report = 'Done') {
  await new Promise(r => setTimeout(r, 100));
  for (const listener of _msgListeners) {
    listener({ action: 'agent_loop_complete', report });
  }
}

beforeEach(() => {
  storageData = {};
  _agentRunning = false;
  _msgListeners = [];
  resetChromeMocks();
});

// ── Line 109: registerAlarm early return when nextRunAt is falsy ──────────────

describe('registerAlarm — early return when nextRunAt is falsy (line 109)', () => {
  test('does not call chrome.alarms.create when schedule.nextRunAt is 0', async () => {
    // Create a once-type schedule
    const schedule = await createSchedule({
      name: 'Once Zero',
      goal: 'run once',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    // Zero out nextRunAt and disable so toggleSchedule will try to re-enable
    const data = storageData['sentinel_schedules'];
    data[schedule.id].nextRunAt = 0;
    data[schedule.id].enabled = false;

    // Flush the create's original alarm call so we can detect new ones
    chrome.alarms.create.mockClear();

    // toggleSchedule: nextRunAt=0 (falsy) → outer-if true → no recurrence → stays 0
    // → registerAlarm({ nextRunAt: 0 }) → line 109: if (!0) return
    await toggleSchedule(schedule.id, true);

    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
});

// ── Line 680: _waitForAgentCompletion listener guard ─────────────────────────

describe('_waitForAgentCompletion listener — guard for non-object messages (line 680)', () => {
  test('null, string, number, and array messages return early without resolving', async () => {
    const schedule = await createSchedule({
      name: 'Filter Test',
      goal: 'test filtering',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    resetChromeMocks();
    setupExecutionMocks();

    const agentEngine = _mockModules[0];
    agentEngine.startAgent.mockResolvedValue(undefined);

    const execPromise = executeScheduledTask('schedule-' + schedule.id);

    // Let listener be registered (listener is registered before startAgent in source)
    await new Promise(r => setTimeout(r, 50));

    // Fire non-object messages — each should hit line 680 and return without resolving
    for (const listener of _msgListeners) {
      listener(null);         // !msg → line 680 returns
      listener(undefined);    // !msg → line 680 returns
      listener('a string');   // typeof !== 'object' → line 680 returns
      listener(42);           // typeof !== 'object' → line 680 returns
      listener(true);         // typeof !== 'object' → line 680 returns
      listener([1, 2, 3]);   // Array.isArray → line 680 returns
    }

    // Execution should still be pending (not resolved by any of the bad messages)
    // Now send the real completion message
    await fireAgentComplete('filter test complete');
    await execPromise;

    const schedules = storageData['sentinel_schedules'] || {};
    expect(schedules[schedule.id].lastRunStatus).toBe('success');
  });
});
