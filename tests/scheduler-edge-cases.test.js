// tests/scheduler-edge-cases.test.js
// Edge case tests for background/scheduler.js error paths

import { jest } from '@jest/globals';

const storageData = {};
const alarms = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of keyList) {
          result[k] = storageData[k] !== undefined ? storageData[k] : (Array.isArray(keys) ? undefined : keys[k]);
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async () => {}),
    },
  },
  alarms: {
    create: jest.fn((name, alarmInfo) => {
      alarms[name] = alarmInfo;
      return Promise.reject(new Error('Alarm create rejected'));
    }),
    clear: jest.fn((name) => {
      delete alarms[name];
      return Promise.reject(new Error('Alarm clear rejected'));
    }),
    get: jest.fn(async () => null),
    getAll: jest.fn(async () => []),
    onAlarm: {
      addListener: jest.fn(),
    },
  },
  notification: {
    create: jest.fn(async () => {}),
    clear: jest.fn(async () => {}),
  },
  action: {
    setBadgeText: jest.fn(() => Promise.reject(new Error('Badge error'))),
    setBadgeBackgroundColor: jest.fn(() => Promise.reject(new Error('Badge color error'))),
  },
  runtime: {
    getURL: jest.fn((p) => p),
  },
};

jest.unstable_mockModule('../background/telemetry.js', () => ({
  emit: jest.fn(),
  tel: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  listCategories: jest.fn(),
  getLevel: jest.fn(),
}));

jest.unstable_mockModule('../background/agent-engine.js', () => ({
  agentRunning: false,
  startAgent: jest.fn(async () => 'Agent started'),
}));

jest.unstable_mockModule('../background/template-manager.js', () => ({
  resolveTemplateGoal: jest.fn(async () => 'Resolved goal'),
}));

describe('scheduler edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(storageData).forEach(k => delete storageData[k]);
    Object.keys(alarms).forEach(k => delete alarms[k]);
  });

  describe('createSchedule with alarm promise rejection', () => {
    test('should handle chrome.alarms.create promise rejection gracefully', async () => {
      const scheduler = await import('../background/scheduler.js');

      const schedule = {
        name: 'Test Schedule',
        goal: 'Test goal',
        type: 'once',
        runAt: Date.now() + 60000,
      };

      // Should not throw despite alarm.create rejecting
      const result = await scheduler.createSchedule(schedule);
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });
  });

  describe('badge operations with promise rejection', () => {
    test('should handle setBadgeText promise rejection in executeScheduledTask', async () => {
      const scheduler = await import('../background/scheduler.js');

      // Set up a schedule with notifyEnabled = true
      const scheduleId = 'test-schedule';
      storageData['sentinel_schedules'] = {
        [scheduleId]: {
          id: scheduleId,
          name: 'Test',
          goal: 'Test goal',
          enabled: true,
          notifyEnabled: true,
          type: 'once',
        },
      };

      // Execute the task - badge operations rejecting should not crash
      await expect(scheduler.executeScheduledTask(`schedule-${scheduleId}`)).resolves.not.toThrow();
    });
  });

  describe('deleteSchedule with alarm promise rejection', () => {
    test('should handle chrome.alarms.clear promise rejection gracefully', async () => {
      const scheduler = await import('../background/scheduler.js');

      const scheduleId = 'test-schedule';
      storageData['sentinel_schedules'] = {
        [scheduleId]: {
          id: scheduleId,
          name: 'Test Schedule',
          goal: 'Test goal',
          enabled: true,
          type: 'recurring',
          recurrence: { interval: 'daily' },
        },
      };

      // Should not throw despite alarm.clear rejecting
      await expect(scheduler.deleteSchedule(scheduleId)).resolves.not.toThrow();
    });
  });

  describe('notification creation edge cases', () => {
    test('should handle notification API errors gracefully', async () => {
      const scheduler = await import('../background/scheduler.js');

      // Make notification.create throw
      chrome.notification.create.mockImplementationOnce(() => {
        throw new Error('Notification failed');
      });

      const scheduleId = 'test-schedule';
      storageData['sentinel_schedules'] = {
        [scheduleId]: {
          id: scheduleId,
          name: 'Test',
          goal: 'Test goal',
          enabled: true,
          notifyEnabled: true,
          type: 'once',
        },
      };

      // Should not throw
      await expect(scheduler.executeScheduledTask(`schedule-${scheduleId}`)).resolves.not.toThrow();
    });
  });
});
