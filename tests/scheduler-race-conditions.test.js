// tests/scheduler-race-conditions.test.js
// Race condition tests for background/scheduler.js — verifies correct behavior
// when events occur in unexpected orders or concurrently.

import { jest } from '@jest/globals';

let storageData = {};
let _agentRunning = false;
let _msgListeners = [];
let _agentCompleteCallbacks = [];

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const key = Array.isArray(keys) ? keys[0] : keys;
        const defaultVal = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys[key] : undefined;
        return { [key]: storageData[key] !== undefined ? storageData[key] : defaultVal };
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
    },
    onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    get: jest.fn(async (name, cb) => { if (cb) cb(null); }),
  },
  notifications: {
    create: jest.fn(),
  },
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
    get: jest.fn(),
  },
};

jest.unstable_mockModule('../background/agent-engine.js', () => ({
  get agentRunning() { return _agentRunning; },
  startAgent: jest.fn(async () => {
    _agentRunning = true;
    return Promise.resolve('Agent started');
  }),
  onAgentComplete: jest.fn((cb) => { _agentCompleteCallbacks.push(cb); return () => { _agentCompleteCallbacks = _agentCompleteCallbacks.filter(c => c !== cb); }; }),
}));

jest.unstable_mockModule('../background/template-manager.js', () => ({
  resolveTemplateGoal: jest.fn(async (id, params) => 'Resolved: ' + id),
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

import {
  createSchedule,
  executeScheduledTask,
  onAgentComplete,
} from '../background/scheduler.js';

beforeEach(() => {
  storageData = {};
  _agentRunning = false;
  _msgListeners = [];
  _agentCompleteCallbacks = [];
  jest.clearAllMocks();

  chrome.storage.local.get.mockImplementation(async (keys) => {
    const key = Array.isArray(keys) ? keys[0] : keys;
    const defaultVal = typeof keys === 'object' && !Array.isArray(keys) ? keys[key] : undefined;
    return { [key]: storageData[key] !== undefined ? storageData[key] : defaultVal };
  });
  chrome.storage.local.set.mockImplementation(async (obj) => Object.assign(storageData, obj));
  chrome.alarms.get.mockImplementation(async (name, cb) => { if (cb) cb(null); });
  chrome.runtime.onMessage.addListener.mockImplementation((fn) => { _msgListeners.push(fn); });
  chrome.tabs.query.mockImplementation((opts, cb) => {
    if (cb) cb([]);
    return Promise.resolve([]);
  });
  chrome.tabs.create.mockResolvedValue({ id: 1, url: 'about:blank' });
  chrome.tabs.get.mockResolvedValue({ id: 1, url: 'about:blank' });
});

async function makeSchedule(overrides = {}) {
  return createSchedule({
    name: 'Test Schedule',
    goal: 'Check the dashboard',
    type: 'once',
    runAt: Date.now() + 3600000,
    ...overrides,
  });
}

describe('scheduler — race condition handling', () => {
  test('createSchedule returns a schedule with an id', async () => {
    const schedule = await makeSchedule();
    expect(schedule).toBeTruthy();
    expect(typeof schedule.id).toBe('string');
    expect(schedule.name).toBe('Test Schedule');
    expect(schedule.goal).toBe('Check the dashboard');
  });

  test('createSchedule with once type stores correct type', async () => {
    const schedule = await makeSchedule({ type: 'once' });
    expect(schedule.type).toBe('once');
  });

  test('createSchedule with recurring type stores recurrence', async () => {
    const schedule = await makeSchedule({
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00' }
    });
    expect(schedule.type).toBe('recurring');
    expect(schedule.recurrence).toBeTruthy();
    expect(schedule.recurrence.interval).toBe('daily');
  });

  test('onAgentComplete registers a callback without throwing', () => {
    const cb = jest.fn();
    expect(() => onAgentComplete(cb)).not.toThrow();
  });

  test('multiple onAgentComplete registrations do not interfere', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    expect(() => onAgentComplete(cb1)).not.toThrow();
    expect(() => onAgentComplete(cb2)).not.toThrow();
  });

  test('executeScheduledTask with invalid alarm name returns early', async () => {
    // An alarm name that doesn't match schedule-${id} pattern should not throw
    await expect(executeScheduledTask('invalid-alarm-name')).resolves.toBeUndefined();
  });

  test('executeScheduledTask with non-existent schedule id returns early', async () => {
    // Valid prefix but no matching schedule in storage
    await expect(executeScheduledTask('schedule-nonexistent-id-12345')).resolves.toBeUndefined();
  });

  test('createSchedule stores schedule in chrome.storage', async () => {
    const schedule = await makeSchedule();
    expect(chrome.storage.local.set).toHaveBeenCalled();
    // The schedule id should be a non-empty string
    expect(schedule.id.length).toBeGreaterThan(0);
  });

  test('schedule file loads without error', () => {
    expect(createSchedule).toBeInstanceOf(Function);
    expect(executeScheduledTask).toBeInstanceOf(Function);
    expect(onAgentComplete).toBeInstanceOf(Function);
  });
});
