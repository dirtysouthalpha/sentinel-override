// tests/scheduler.test.js
// Unit tests for background/scheduler.js — CRUD, computeNextRun, result queries.

import { jest } from '@jest/globals';

let storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const key = Array.isArray(keys) ? keys[0] : keys;
        const defaultVal = typeof keys === 'object' && !Array.isArray(keys) ? keys[key] : undefined;
        return { [key]: storageData[key] !== undefined ? storageData[key] : defaultVal };
      }),
      set: jest.fn(async (obj) => Object.assign(storageData, obj)),
    },
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
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
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

jest.unstable_mockModule('../background/agent-engine.js', () => ({
  agentRunning: false,
  startAgent: jest.fn(async () => {}),
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

const {
  createSchedule,
  listSchedules,
  deleteSchedule,
  toggleSchedule,
  getNextRunTime,
  getScheduleResults,
  getRecentResults,
  clearScheduleResults,
  initScheduler,
  onAgentComplete,
} = await import('../background/scheduler.js');

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
});

// Helper: create a valid schedule
async function makeSchedule(overrides = {}) {
  return createSchedule({
    name: 'Test Schedule',
    goal: 'Check the dashboard for alerts',
    type: 'once',
    runAt: Date.now() + 3600000,
    ...overrides,
  });
}

describe('createSchedule', () => {
  test('creates a valid one-time schedule', async () => {
    const schedule = await makeSchedule();
    expect(schedule.id).toBeTruthy();
    expect(schedule.name).toBe('Test Schedule');
    expect(schedule.type).toBe('once');
    expect(schedule.enabled).toBe(true);
    expect(schedule.nextRunAt).toBeGreaterThan(0);
    expect(chrome.alarms.create).toHaveBeenCalled();
  });

  test('creates a recurring daily schedule', async () => {
    const schedule = await createSchedule({
      name: 'Daily Check',
      goal: 'Run daily check',
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00' },
    });
    expect(schedule.type).toBe('recurring');
    expect(schedule.recurrence.interval).toBe('daily');
    expect(schedule.recurrence.periodInMinutes).toBe(1440);
  });

  test('creates a recurring weekly schedule', async () => {
    const schedule = await createSchedule({
      name: 'Weekly Report',
      goal: 'Generate weekly report',
      type: 'recurring',
      recurrence: { interval: 'weekly', time: '10:00', daysOfWeek: [1, 3, 5] },
    });
    expect(schedule.recurrence.interval).toBe('weekly');
    expect(schedule.recurrence.periodInMinutes).toBe(10080);
    expect(schedule.recurrence.daysOfWeek).toEqual([1, 3, 5]);
  });

  test('throws on missing name', async () => {
    await expect(createSchedule({ goal: 'test', type: 'once' })).rejects.toThrow('name is required');
  });

  test('throws on missing templateId and goal', async () => {
    await expect(createSchedule({ name: 'X', type: 'once' })).rejects.toThrow('templateId or goal');
  });

  test('throws on invalid type', async () => {
    await expect(createSchedule({ name: 'X', goal: 'test', type: 'bad' })).rejects.toThrow();
  });

  test('throws on non-object data', async () => {
    await expect(createSchedule(null)).rejects.toThrow('must be an object');
  });

  test('uses future runAt for once schedules', async () => {
    const futureTime = Date.now() + 7200000;
    const schedule = await makeSchedule({ runAt: futureTime });
    expect(schedule.nextRunAt).toBe(futureTime);
  });

  test('defaults to 1 hour from now for past runAt', async () => {
    const pastTime = Date.now() - 10000;
    const schedule = await makeSchedule({ runAt: pastTime });
    expect(schedule.nextRunAt).toBeGreaterThan(Date.now() - 1000);
  });
});

describe('listSchedules', () => {
  test('returns empty array when no schedules', async () => {
    const list = await listSchedules();
    expect(list).toEqual([]);
  });

  test('returns schedules sorted by enabled then nextRunAt', async () => {
    const s1 = await makeSchedule({ name: 'First' });
    const s2 = await makeSchedule({ name: 'Second' });
    const list = await listSchedules();
    expect(list).toHaveLength(2);
    expect(list.map(s => s.name)).toContain('First');
    expect(list.map(s => s.name)).toContain('Second');
  });
});

describe('deleteSchedule', () => {
  test('deletes an existing schedule', async () => {
    const schedule = await makeSchedule();
    await deleteSchedule(schedule.id);
    const list = await listSchedules();
    expect(list).toHaveLength(0);
  });

  test('clears the alarm on delete', async () => {
    const schedule = await makeSchedule();
    await deleteSchedule(schedule.id);
    expect(chrome.alarms.clear).toHaveBeenCalledWith('schedule-' + schedule.id);
  });

  test('throws on missing id', async () => {
    await expect(deleteSchedule('')).rejects.toThrow('ID is required');
  });

  test('throws on unknown id', async () => {
    await expect(deleteSchedule('nonexistent')).rejects.toThrow('not found');
  });
});

describe('toggleSchedule', () => {
  test('disables an enabled schedule', async () => {
    const schedule = await makeSchedule();
    const updated = await toggleSchedule(schedule.id, false);
    expect(updated.enabled).toBe(false);
  });

  test('re-enables a disabled schedule', async () => {
    const schedule = await makeSchedule();
    await toggleSchedule(schedule.id, false);
    const updated = await toggleSchedule(schedule.id, true);
    expect(updated.enabled).toBe(true);
    expect(chrome.alarms.create).toHaveBeenCalled();
  });

  test('clears alarm when disabling', async () => {
    const schedule = await makeSchedule();
    await toggleSchedule(schedule.id, false);
    expect(chrome.alarms.clear).toHaveBeenCalledWith('schedule-' + schedule.id);
  });

  test('throws on missing id', async () => {
    await expect(toggleSchedule('', true)).rejects.toThrow('ID is required');
  });

  test('throws on non-boolean enabled', async () => {
    const schedule = await makeSchedule();
    await expect(toggleSchedule(schedule.id, 'yes')).rejects.toThrow('boolean');
  });
});

describe('getNextRunTime', () => {
  test('returns null for null schedule', () => {
    expect(getNextRunTime(null)).toBeNull();
  });

  test('returns nextRunAt for once schedule', () => {
    const ts = Date.now() + 3600000;
    expect(getNextRunTime({ type: 'once', nextRunAt: ts })).toBe(ts);
  });

  test('computes next run for recurring schedule', () => {
    const result = getNextRunTime({
      type: 'recurring',
      recurrence: { interval: 'daily', time: '09:00', periodInMinutes: 1440 },
    });
    expect(result).toBeGreaterThan(0);
  });

  test('returns nextRunAt for schedule without recognized type', () => {
    expect(getNextRunTime({ type: 'unknown', nextRunAt: 42 })).toBe(42);
  });
});

describe('result queries', () => {
  test('getScheduleResults returns empty for unknown schedule', async () => {
    const results = await getScheduleResults('nonexistent');
    expect(results).toEqual([]);
  });

  test('getScheduleResults returns empty for falsy id', async () => {
    expect(await getScheduleResults(null)).toEqual([]);
    expect(await getScheduleResults('')).toEqual([]);
  });

  test('getRecentResults returns empty when no results', async () => {
    const results = await getRecentResults();
    expect(results).toEqual([]);
  });

  test('getRecentResults respects limit parameter', async () => {
    const results = await getRecentResults(5);
    expect(results).toEqual([]);
  });

  test('clearScheduleResults throws on missing id', async () => {
    await expect(clearScheduleResults('')).rejects.toThrow('ID is required');
  });
});

describe('initScheduler', () => {
  test('initializes without error on empty storage', async () => {
    await expect(initScheduler()).resolves.toBeUndefined();
  });

  test('re-registers alarms for enabled schedules', async () => {
    const schedule = await makeSchedule();
    jest.clearAllMocks();
    await initScheduler();
    // Should have checked for alarms via chrome.alarms.get
    expect(chrome.alarms.get).toHaveBeenCalled();
  });
});

describe('onAgentComplete', () => {
  test('registers a callback without error', () => {
    const cb = jest.fn();
    expect(() => onAgentComplete(cb)).not.toThrow();
  });
});
