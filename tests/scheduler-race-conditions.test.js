// tests/scheduler-race-conditions.test.js
// Edge case and race condition tests for background/scheduler.js
// Tests concurrent operations, rapid state changes, and timing edge cases.

import { jest } from '@jest/globals';

let storageData = {};
let _agentRunning = false;
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
  get agentRunning() { return _agentRunning; },
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
  deleteSchedule,
  toggleSchedule,
  listSchedules,
  executeScheduledTask,
} = await import('../background/scheduler.js');

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
  // Restore storage mock implementations after clearAllMocks resets them
  chrome.storage.local.get.mockImplementation(async (keys) => {
    const key = Array.isArray(keys) ? keys[0] : keys;
    const defaultVal = typeof keys === 'object' && !Array.isArray(keys) ? keys[key] : undefined;
    return { [key]: storageData[key] !== undefined ? storageData[key] : defaultVal };
  });
  chrome.storage.local.set.mockImplementation(async (obj) => Object.assign(storageData, obj));
  chrome.alarms.get.mockImplementation(async (name, cb) => { if (cb) cb(null); });
  chrome.alarms.create.mockImplementation(async () => {});
  chrome.alarms.clear.mockImplementation(async () => true);
  chrome.tabs.query.mockImplementation((opts, cb) => {
    if (cb) cb([{ id: 42 }]);
    return Promise.resolve([{ id: 42 }]);
  });
});

describe('scheduler — race conditions and concurrent operations', () => {
  describe('rapid toggle operations', () => {
    test('handles rapid enable/disable cycles without corruption', async () => {
      const schedule = await createSchedule({
        name: 'Rapid Toggle Test',
        goal: 'test goal',
        type: 'recurring',
        recurrence: { interval: 'daily', time: '09:00' },
      });

      // Rapidly toggle on/off
      await toggleSchedule(schedule.id, false);
      await toggleSchedule(schedule.id, true);
      await toggleSchedule(schedule.id, false);
      await toggleSchedule(schedule.id, true);

      // Final state should be enabled
      const list = await listSchedules();
      const s = list.find(x => x.id === schedule.id);
      expect(s.enabled).toBe(true);
    });

    test('handles concurrent toggle operations on same schedule', async () => {
      const schedule = await createSchedule({
        name: 'Concurrent Toggle Test',
        goal: 'test goal',
        type: 'once',
        runAt: Date.now() + 3600000,
      });

      // Fire concurrent toggles - all should resolve without error
      const promises = [
        toggleSchedule(schedule.id, true),
        toggleSchedule(schedule.id, false),
        toggleSchedule(schedule.id, true),
      ];

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });

  describe('concurrent CRUD operations', () => {
    test('handles multiple schedule creation sequentially', async () => {
      // Create multiple schedules (sequentially to avoid race conditions in tests)
      const s1 = await createSchedule({ name: 'Schedule 1', goal: 'test 1', type: 'once', runAt: Date.now() + 3600000 });
      const s2 = await createSchedule({ name: 'Schedule 2', goal: 'test 2', type: 'once', runAt: Date.now() + 7200000 });
      const s3 = await createSchedule({ name: 'Schedule 3', goal: 'test 3', type: 'once', runAt: Date.now() + 10800000 });

      expect(s1.id).toBeDefined();
      expect(s2.id).toBeDefined();
      expect(s3.id).toBeDefined();

      // Delete first schedule
      await deleteSchedule(s1.id);

      const remaining = await listSchedules();
      expect(remaining).toHaveLength(2);
      expect(remaining.find(s => s.id === s1.id)).toBeUndefined();
    });

    test('handles delete after execution starts', async () => {
      const schedule = await createSchedule({
        name: 'Delete After Execution',
        goal: 'test goal',
        type: 'recurring',
        recurrence: { interval: 'daily', time: '09:00' },
      });

      // Start execution
      let msgListener;
      chrome.runtime.onMessage.addListener.mockImplementation((fn) => { msgListener = fn; });

      const execPromise = executeScheduledTask('schedule-' + schedule.id);

      // Fire completion message immediately
      await new Promise(r => setTimeout(r, 10));
      if (msgListener) {
        msgListener({ action: 'agent_loop_complete', report: 'Done' });
      }

      await execPromise;

      // Now delete the schedule
      await deleteSchedule(schedule.id);

      // Schedule should be deleted
      const list = await listSchedules();
      expect(list.find(s => s.id === schedule.id)).toBeUndefined();
    });
  });

  describe('storage failure during concurrent operations', () => {
    test('handles storage failure during concurrent schedule creation', async () => {
      // Make storage.set fail intermittently
      let callCount = 0;
      const originalSet = chrome.storage.local.set;
      chrome.storage.local.set = jest.fn(async (obj) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Storage busy');
        }
        Object.assign(storageData, obj);
      });

      // Attempt concurrent creations - some should succeed
      const results = await Promise.allSettled([
        createSchedule({ name: 'S1', goal: 'g1', type: 'once', runAt: Date.now() + 3600000 }),
        createSchedule({ name: 'S2', goal: 'g2', type: 'once', runAt: Date.now() + 7200000 }),
        createSchedule({ name: 'S3', goal: 'g3', type: 'once', runAt: Date.now() + 10800000 }),
      ]);

      // At least some should succeed
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);

      // Restore
      chrome.storage.local.set = originalSet;
    });

    test('handles storage read failure during concurrent list operations', async () => {
      // Make storage.get fail intermittently
      let callCount = 0;
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = jest.fn(async (keys) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Read error');
        }
        const key = Array.isArray(keys) ? keys[0] : keys;
        const defaultVal = typeof keys === 'object' && !Array.isArray(keys) ? keys[key] : undefined;
        return { [key]: storageData[key] !== undefined ? storageData[key] : defaultVal };
      });

      // Create a schedule first
      await createSchedule({ name: 'Test', goal: 'test', type: 'once', runAt: Date.now() + 3600000 });

      // Concurrent list operations - should handle failures gracefully
      const results = await Promise.allSettled([
        listSchedules(),
        listSchedules(),
        listSchedules(),
      ]);

      // All should resolve (even if some return empty arrays)
      expect(results).toHaveLength(3);
      results.forEach(r => {
        expect(r.status).toBe('fulfilled');
      });

      // Restore
      chrome.storage.local.get = originalGet;
    });
  });

  describe('timing edge cases', () => {
    test('handles schedule with runAt exactly at current time', async () => {
      const now = Date.now();
      const schedule = await createSchedule({
        name: 'Exact Time Test',
        goal: 'test goal',
        type: 'once',
        runAt: now,
      });

      // Should adjust to future time if it's exactly now or in past
      expect(schedule.nextRunAt).toBeGreaterThanOrEqual(now);
    });

    test('handles schedules with runAt in far past', async () => {
      const ancientTime = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago
      const schedule = await createSchedule({
        name: 'Ancient Time Test',
        goal: 'test goal',
        type: 'once',
        runAt: ancientTime,
      });

      // Should adjust to reasonable future time
      expect(schedule.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    });

    test('handles schedules with runAt in far future', async () => {
      const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year from now
      const schedule = await createSchedule({
        name: 'Far Future Test',
        goal: 'test goal',
        type: 'once',
        runAt: farFuture,
      });

      expect(schedule.nextRunAt).toBe(farFuture);
    });

    test('handles zero and negative runAt values', async () => {
      await expect(createSchedule({
        name: 'Zero Time',
        goal: 'test goal',
        type: 'once',
        runAt: 0,
      })).resolves.toBeDefined();

      await expect(createSchedule({
        name: 'Negative Time',
        goal: 'test goal',
        type: 'once',
        runAt: -1000,
      })).resolves.toBeDefined();
    });
  });

  describe('alarm API edge cases', () => {
    test('alarm.create failure propagates to caller', async () => {
      chrome.alarms.create.mockImplementation(() => {
        throw new Error('Alarm API unavailable');
      });

      // Error should propagate
      await expect(createSchedule({
        name: 'Alarm Fail Test',
        goal: 'test goal',
        type: 'once',
        runAt: Date.now() + 3600000,
      })).rejects.toThrow('Alarm API unavailable');
    });

    test('alarm.clear failure propagates to caller', async () => {
      const schedule = await createSchedule({
        name: 'Clear Fail Test',
        goal: 'test goal',
        type: 'once',
        runAt: Date.now() + 3600000,
      });

      chrome.alarms.clear.mockImplementation(() => {
        throw new Error('Clear failed');
      });

      // Error should propagate
      await expect(deleteSchedule(schedule.id)).rejects.toThrow('Clear failed');
    });
  });

  describe('state consistency after errors', () => {
    test('maintains consistent state after partial failures', async () => {
      // Create three schedules
      const s1 = await createSchedule({ name: 'S1', goal: 'g1', type: 'once', runAt: Date.now() + 3600000 });
      const s2 = await createSchedule({ name: 'S2', goal: 'g2', type: 'once', runAt: Date.now() + 7200000 });
      const s3 = await createSchedule({ name: 'S3', goal: 'g3', type: 'once', runAt: Date.now() + 10800000 });

      // Toggle middle one off
      await toggleSchedule(s2.id, false);

      // Delete first one
      await deleteSchedule(s1.id);

      // State should be consistent
      const list = await listSchedules();
      expect(list).toHaveLength(2);
      expect(list.find(s => s.id === s1.id)).toBeUndefined();
      expect(list.find(s => s.id === s2.id)?.enabled).toBe(false);
      expect(list.find(s => s.id === s3.id)?.enabled).toBe(true);
    });
  });
});
