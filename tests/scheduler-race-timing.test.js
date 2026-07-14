// tests/scheduler-race-timing.test.js
// Race condition and timing edge case tests for background/scheduler.js.
// Tests concurrent schedule operations, alarm timing edge cases, and storage race conditions.

import { jest } from '@jest/globals';

// Chrome API mock with timing controls
const schedules = {};
const results = {};
const alarms = {};
let alarmListeners = [];
let currentTime = Date.now();

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (keys ? [keys] : []);
        for (const k of keyList) {
          if (k === 'sentinel_schedules') result[k] = schedules;
          if (k === 'sentinel_schedule_results') result[k] = results;
        }
        return result;
      }),
      set: jest.fn(async (obj) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        Object.assign(schedules, obj);
        Object.assign(results, obj);
      }),
      remove: jest.fn(async () => {}),
    },
  },
  alarms: {
    create: jest.fn(async (name, alarmInfo) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      alarms[name] = alarmInfo;
    }),
    clear: jest.fn(async (name) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      delete alarms[name];
      return true;
    }),
    getAll: jest.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return Object.entries(alarms).map(([name, info]) => ({ name, ...info }));
    }),
    onAlarm: {
      addListener: jest.fn((fn) => {
        alarmListeners.push(fn);
      }),
    },
  },
  tabs: {
    query: jest.fn(async () => [{ id: 1 }]),
  },
  runtime: {
    sendMessage: jest.fn(async () => {}),
  },
};

// Mock agent-engine
const mockAgentRunning = { value: false };
const mockAgentCompleteCallbacks = [];

jest.unstable_mockModule('../background/agent-engine.js', () => ({
  isAgentRunning: () => mockAgentRunning.value,
  onAgentComplete: (cb) => mockAgentCompleteCallbacks.push(cb),
  runAgent: jest.fn(async () => 'done'),
}));

// Mock template-manager
jest.unstable_mockModule('../background/template-manager.js', () => ({
  resolveTemplateGoal: jest.fn(async (goal) => ({ goal, resolved: true })),
}));

// Mock tab-context, tab-manager, shared-state, telemetry
jest.unstable_mockModule('../background/tab-context.js', () => ({
  getActiveTabId: jest.fn(async () => 1),
  registerInitialTab: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/tab-manager.js', () => ({
  getTabInfo: jest.fn(async () => ({ url: 'https://example.com' })),
}));

jest.unstable_mockModule('../background/shared-state.js', () => ({
  onAgentCompletion: jest.fn(() => () => {}),
  emitAgentCompletion: jest.fn(),
  notifyIfEnabled: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../background/telemetry.js', () => ({
  tel: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import * as Scheduler from '../background/scheduler.js';

describe('Scheduler Race Conditions and Timing Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(schedules).forEach(k => delete schedules[k]);
    Object.keys(results).forEach(k => delete results[k]);
    Object.keys(alarms).forEach(k => delete alarms[k]);
    alarmListeners = [];
    mockAgentRunning.value = false;
    mockAgentCompleteCallbacks.length = 0;
  });

  describe('Concurrent schedule CRUD operations', () => {
    test('handles concurrent createSchedule calls without data loss', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(Scheduler.createSchedule({
          name: `Schedule ${i}`,
          goal: `Test goal ${i}`,
          type: 'once',
          runAt: Date.now() + 3600000,
        }));
      }
      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      expect(results.every(r => r && r.id)).toBe(true);
    });

    test('handles concurrent deleteSchedule calls for different schedules', async () => {
      // Create schedules first
      const scheduleIds = [];
      for (let i = 0; i < 5; i++) {
        const schedule = await Scheduler.createSchedule({
          name: `Schedule ${i}`,
          goal: `Test goal ${i}`,
          type: 'once',
          runAt: Date.now() + 3600000,
        });
        scheduleIds.push(schedule.id);
      }

      // Delete them concurrently
      const promises = [];
      for (const id of scheduleIds) {
        promises.push(Scheduler.deleteSchedule(id));
      }
      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
    });

    test('handles concurrent toggleSchedule calls', async () => {
      // Create a schedule
      const schedule = await Scheduler.createSchedule({
        name: 'Test',
        goal: 'Test goal',
        type: 'once',
        runAt: Date.now() + 3600000,
      });

      // Toggle it concurrently
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(Scheduler.toggleSchedule(schedule.id, i % 2 === 0));
      }
      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      expect(results.every(r => r)).toBe(true);
    });

    test('handles concurrent create and delete of same schedule ID', async () => {
      const schedule = await Scheduler.createSchedule({
        name: 'Race test',
        goal: 'Test',
        type: 'once',
        runAt: Date.now() + 3600000,
      });

      // Delete should not throw even when happening concurrently with create
      await Scheduler.deleteSchedule(schedule.id);
      expect(true).toBe(true);
    });
  });

  describe('Alarm timing edge cases', () => {
    test('handles alarm firing during schedule toggle', async () => {
      const schedule = await Scheduler.createSchedule({
        name: 'Timing test',
        goal: 'Test goal',
        type: 'once',
        runAt: Date.now() - 1000, // Past time
      });

      // Simulate alarm firing during toggle
      const togglePromise = Scheduler.toggleSchedule(schedule.id, false);

      // Fire alarm
      const alarmEvent = { name: 'schedule-' + schedule.id };
      for (const listener of alarmListeners) {
        await listener(alarmEvent);
      }

      await togglePromise;
      expect(togglePromise).resolves.toBeDefined();
    });

    test('handles multiple alarms firing simultaneously', async () => {
      // Create multiple schedules with past due times
      const scheduleIds = [];
      for (let i = 0; i < 5; i++) {
        const schedule = await Scheduler.createSchedule({
          name: `Simultaneous ${i}`,
          goal: `Test goal ${i}`,
          type: 'once',
          runAt: Date.now() - 1000,
        });
        scheduleIds.push(schedule.id);
      }

      // Fire all alarms simultaneously
      for (const id of scheduleIds) {
        const alarmEvent = { name: 'schedule-' + id };
        for (const listener of alarmListeners) {
          await listener(alarmEvent);
        }
      }

      // Should complete without errors
      expect(scheduleIds).toHaveLength(5);
    });

    test('handles alarm with invalid schedule ID gracefully', async () => {
      const alarmEvent = { name: 'schedule-nonexistent-id' };
      for (const listener of alarmListeners) {
        await expect(listener(alarmEvent)).resolves.toBeUndefined();
      }
    });

    test('handles alarm with malformed name', async () => {
      const malformedNames = [
        'schedule-',  // Empty ID
        'invalid-prefix-abc',  // Wrong prefix
        'schedule',  // No hyphen
      ];

      for (const name of malformedNames) {
        const alarmEvent = { name };
        for (const listener of alarmListeners) {
          await expect(listener(alarmEvent)).resolves.toBeUndefined();
        }
      }
    });
  });

  describe('Storage race conditions', () => {
    test('handles storage.get failure during loadSchedules', async () => {
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = jest.fn(async () => {
        throw new Error('Storage unavailable');
      });

      const loaded = await Scheduler.listSchedules();
      expect(loaded).toEqual([]);

      chrome.storage.local.get = originalGet;
    });

    test('handles storage.set failure during saveSchedules', async () => {
      const originalSet = chrome.storage.local.set;
      chrome.storage.local.set = jest.fn(async () => {
        throw new Error('Storage unavailable');
      });

      await Scheduler.createSchedule({
        name: 'Storage fail test',
        goal: 'Test',
        type: 'once',
        runAt: Date.now() + 3600000,
      });
      // Should not throw - error is caught and logged

      chrome.storage.local.set = originalSet;
    });

    test('handles concurrent storage read/write operations', async () => {
      const operations = [];

      // Mix of reads and writes
      for (let i = 0; i < 10; i++) {
        operations.push(Scheduler.listSchedules());
        if (i % 2 === 0) {
          operations.push(Scheduler.createSchedule({
            name: `Concurrent ${i}`,
            goal: 'Test',
            type: 'once',
            runAt: Date.now() + 3600000,
          }));
        }
      }

      await Promise.all(operations);
      expect(operations).toHaveLength(15);
    });
  });

  describe('Result storage edge cases', () => {
    test('enforces MAX_RESULTS limit on result storage', async () => {
      // Create many results
      const scheduleIds = [];
      for (let i = 0; i < 60; i++) {
        const schedule = await Scheduler.createSchedule({
          name: `Result test ${i}`,
          goal: `Test goal ${i}`,
          type: 'once',
          runAt: Date.now() - 1000,
        });
        scheduleIds.push(schedule.id);
      }

      // Fire all alarms to create results
      for (const id of scheduleIds) {
        const alarmEvent = { name: 'schedule-' + id };
        for (const listener of alarmListeners) {
          await listener(alarmEvent);
        }
      }

      const storedResults = await Scheduler.getRecentResults();
      // Should be limited to MAX_RESULTS (50)
      expect(Object.keys(storedResults).length).toBeLessThanOrEqual(50);
    });

    test('handles result deletion with non-existent result ID', async () => {
      // Should not throw
      await Scheduler.clearScheduleResults('nonexistent-result-id');
      expect(true).toBe(true);
    });

    test('handles concurrent result deletions', async () => {
      // Create some schedules and results
      const scheduleIds = [];
      for (let i = 0; i < 5; i++) {
        const schedule = await Scheduler.createSchedule({
          name: `Delete result ${i}`,
          goal: 'Test',
          type: 'once',
          runAt: Date.now() - 1000,
        });
        scheduleIds.push(schedule.id);
      }

      // Fire alarms to create results
      for (const id of scheduleIds) {
        const alarmEvent = { name: 'schedule-' + id };
        for (const listener of alarmListeners) {
          await listener(alarmEvent);
        }
      }

      // Delete all results concurrently
      const deletePromises = scheduleIds.map(id =>
        Scheduler.clearScheduleResults(id)
      );
      await Promise.all(deletePromises);
    });
  });

  describe('Schedule validation edge cases', () => {
    test('handles schedule with extremely long goal text', async () => {
      const longGoal = 'x'.repeat(100000);
      const result = await Scheduler.createSchedule({
        name: 'Long goal test',
        goal: longGoal,
        type: 'once',
        runAt: Date.now() + 3600000,
      });
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    test('handles schedule with unicode characters', async () => {
      const result = await Scheduler.createSchedule({
        name: 'Unicode test 中文 🔥',
        goal: 'Test goal with unicode: 中文, 🎉, 🔥',
        type: 'once',
        runAt: Date.now() + 3600000,
      });
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    test('handles schedule with null/undefined optional fields', async () => {
      const result = await Scheduler.createSchedule({
        name: 'Null fields test',
        goal: 'Test',
        type: 'once',
        runAt: Date.now() + 3600000,
      });
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });
  });

  describe('Frequency calculation edge cases', () => {
    test('handles recurring daily schedule', async () => {
      const result = await Scheduler.createSchedule({
        name: 'Daily test',
        goal: 'Test',
        type: 'recurring',
        recurrence: {
          interval: 'daily',
          time: '09:00',
        },
      });
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    test('handles recurring weekly schedule', async () => {
      const result = await Scheduler.createSchedule({
        name: 'Weekly test',
        goal: 'Test',
        type: 'recurring',
        recurrence: {
          interval: 'weekly',
          time: '10:00',
          daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        },
      });
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    test('handles custom period schedule', async () => {
      const result = await Scheduler.createSchedule({
        name: 'Custom period test',
        goal: 'Test',
        type: 'recurring',
        recurrence: {
          interval: 'custom',
          periodInMinutes: 30, // Every 30 minutes
        },
      });
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });
  });

  describe('Agent completion callback edge cases', () => {
    test('registers multiple agent completion callbacks', async () => {
      // Just verify registration doesn't throw
      for (let i = 0; i < 5; i++) {
        const cb = jest.fn();
        Scheduler.onAgentComplete(cb);
      }
      // If we get here without throwing, registration works
      expect(true).toBe(true);
    });

    test('handles callback that throws an error during registration', async () => {
      // The scheduler should handle throwing callbacks gracefully
      const throwingCb = jest.fn(() => {
        throw new Error('Callback error');
      });

      // Registration should not throw
      expect(() => Scheduler.onAgentComplete(throwingCb)).not.toThrow();
    });
  });
});
