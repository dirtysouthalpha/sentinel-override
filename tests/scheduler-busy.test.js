// tests/scheduler-busy.test.js
// Covers the agent-busy skip path (lines 509-520) in background/scheduler.js.
//
// In Jest ESM, `import * as AgentEngine` captures a snapshot of each export's
// initial value from the mock factory. Setting agentRunning: true as a STATIC
// data property (not a getter) makes the namespace always return true.
// This is the only reliable way to cover the busy-skip path given Jest's ESM
// namespace binding behaviour.

import { jest } from '@jest/globals';

let storageData = {};
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

// agentRunning: true as a static data property — Jest ESM namespaces snapshot this
// value at import time, so AgentEngine.agentRunning is always true in scheduler.js.
jest.unstable_mockModule('../background/agent-engine.js', () => ({
  agentRunning: true,
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
  notifyIfEnabled: jest.fn(),
}));

const { createSchedule, executeScheduledTask } = await import('../background/scheduler.js');

beforeEach(() => {
  storageData = {};
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
  chrome.alarms.create.mockClear();
  chrome.alarms.clear.mockClear();
  chrome.notifications.create.mockClear();
  chrome.tabs.query.mockClear();
  chrome.tabs.create.mockClear();
});

// ── Lines 509-520: agent busy skip path ──────────────────────────────────────

describe('executeScheduledTask — agent busy skip path (lines 509-520)', () => {
  test('recurring schedule: marks skipped, recomputes nextRunAt, re-registers alarm (lines 509-520)', async () => {
    // Recurring daily schedule
    const schedule = await createSchedule({
      name: 'Daily Busy',
      goal: 'do daily check',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00' },
    });

    chrome.alarms.create.mockClear();

    await executeScheduledTask('schedule-' + schedule.id);

    // Line 510: lastRunStatus = 'skipped'
    const saved = storageData['sentinel_schedules'];
    expect(saved[schedule.id].lastRunStatus).toBe('skipped');
    // Line 511: lastRunAt set
    expect(typeof saved[schedule.id].lastRunAt).toBe('number');
    // Lines 512-513: nextRunAt recomputed for recurring
    expect(saved[schedule.id].nextRunAt).toBeGreaterThan(0);
    // Lines 517-518: alarm re-registered
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      `schedule-${schedule.id}`,
      expect.objectContaining({ when: expect.any(Number) })
    );
  });

  test('once-type schedule: marks skipped, no nextRunAt recompute, no alarm re-register', async () => {
    // Once-type schedule — no recurrence
    const schedule = await createSchedule({
      name: 'Once Busy',
      goal: 'run once check',
      type: 'once',
      runAt: Date.now() + 3600000,
    });

    const originalNextRunAt = storageData['sentinel_schedules'][schedule.id].nextRunAt;
    chrome.alarms.create.mockClear();

    await executeScheduledTask('schedule-' + schedule.id);

    const saved = storageData['sentinel_schedules'];
    // Line 510: lastRunStatus = 'skipped'
    expect(saved[schedule.id].lastRunStatus).toBe('skipped');
    // Lines 512-513 NOT entered (no recurrence) — nextRunAt unchanged
    expect(saved[schedule.id].nextRunAt).toBe(originalNextRunAt);
    // Lines 517-518 NOT entered — no alarm for once-type
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
});
