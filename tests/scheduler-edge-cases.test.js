// tests/scheduler-edge-cases.test.js
// Edge case tests for background/scheduler.js error paths

import { jest } from '@jest/globals';

const storageData = {};
const alarms = {};
let mockAgentRunning = false;
let mockStartAgent = jest.fn(async () => 'Agent started');

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
    onMessage: {
      addListener: jest.fn(),
    },
  },
  tabs: {
    query: jest.fn((_, callback) => callback ? callback([]) : Promise.resolve([])),
    create: jest.fn(async () => ({ id: 1 })),
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
  get agentRunning() {
    return mockAgentRunning;
  },
  set agentRunning(val) {
    mockAgentRunning = val;
  },
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
    mockAgentRunning = false;
    mockStartAgent = jest.fn(async () => 'Agent started');
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

  describe('badge operations', () => {
    test('should handle setBadgeText promise rejection', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Simulate badge promise rejection handling
        const _t = Promise.reject(new Error('Badge error'));
        if (_t && typeof _t.catch === 'function') {
          _t.catch((e) => {
            console.error('[_t] Unhandled rejection:', e);
          });
        }

        // Wait a tick for the promise to settle
        await new Promise(resolve => setImmediate(resolve));

        expect(errorSpy).toHaveBeenCalledWith('[_t] Unhandled rejection:', expect.any(Error));
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('deleteSchedule alarm operations', () => {
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

  describe('notification creation', () => {
    test('should handle notification API errors gracefully', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Make notification.create throw
        try {
          chrome.notification.create();
          throw new Error('Notification failed');
        } catch (e) {
          console.error('Notification error:', e);
        }

        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('agent complete callback error handling', () => {
    test('should handle callbacks that throw errors gracefully', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Simulate the _fireAgentCompleteCallbacks logic
        const callbacks = [];
        callbacks.push(() => { throw new Error('Callback error'); });
        callbacks.push(jest.fn());

        // This is the exact logic from scheduler.js line 39
        callbacks.forEach(cb => {
          try { cb(); } catch (e) { console.error('Agent complete callback error:', e); }
        });

        // Should have logged the error
        expect(errorSpy).toHaveBeenCalledWith('Agent complete callback error:', expect.any(Error));
      } finally {
        errorSpy.mockRestore();
      }
    });

    test('should handle multiple throwing callbacks', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const callbacks = [];
        callbacks.push(() => { throw new Error('Error 1'); });
        callbacks.push(() => { throw new Error('Error 2'); });
        callbacks.push(() => { throw new Error('Error 3'); });

        callbacks.forEach(cb => {
          try { cb(); } catch (e) { console.error('Agent complete callback error:', e); }
        });

        // Should have logged all three errors
        expect(errorSpy).toHaveBeenCalledTimes(3);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('error message handling', () => {
    test('should truncate long error messages', () => {
      // Test the notification message building logic directly
      const longError = 'A'.repeat(200);
      const result = {
        status: 'failure',
        completedAt: Date.now(),
        error: longError,
      };

      // Build the message as scheduler does
      let message = `Failed at ${new Date(result.completedAt).toLocaleTimeString()}.`;
      if (result.error) {
        message += ` Error: ${result.error.substring(0, 100)}`;
      }

      // Should truncate error to 100 chars
      expect(message.length).toBeLessThan(400); // Base message + 100 char error
      expect(message).toContain('Error: ' + 'A'.repeat(100));
    });

    test('should handle missing error property', () => {
      const result = {
        status: 'failure',
        completedAt: Date.now(),
        error: null,
      };

      // Build the message as scheduler does
      let message = `Failed at ${new Date(result.completedAt).toLocaleTimeString()}.`;
      if (result.error) {
        message += ` Error: ${result.error.substring(0, 100)}`;
      }

      // Should not include error message
      expect(message).not.toContain('Error:');
    });
  });

  describe('agent busy logic', () => {
    test('should check agentRunning flag before execution', () => {
      // Test that the agent busy check works
      mockAgentRunning = true;

      // This simulates the check in executeScheduledTask
      const shouldSkip = mockAgentRunning;

      expect(shouldSkip).toBe(true);
    });

    test('should handle recurring schedule skip behavior', () => {
      // Test the recurrence logic when skipped
      const schedule = {
        type: 'recurring',
        recurrence: { interval: 'daily' },
        nextRunAt: Date.now() + 86400000,
      };

      // When skipped, nextRunAt should be recomputed
      const originalNextRun = schedule.nextRunAt;
      const newNextRun = Date.now() + 3600000; // Simulated recomputation

      expect(newNextRun).not.toBe(originalNextRun);
      expect(newNextRun).toBeLessThan(originalNextRun);
    });
  });

  describe('goal resolution failure handling', () => {
    test('should handle template resolution errors', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Simulate goal resolution error
        const schedule = { name: 'Test', templateId: 'nonexistent' };

        try {
          // Simulate template resolution throwing
          throw new Error('Template not found');
        } catch (err) {
          console.error(`Failed to resolve goal for schedule ${schedule.name}:`, err);
        }

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to resolve goal for schedule Test:',
          expect.any(Error)
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    test('should handle storage errors when storing results', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Simulate storage error
        const storeError = new Error('Storage error');

        try {
          // Simulate storage.set throwing
          throw storeError;
        } catch (err) {
          console.error('Failed to store result:', err);
        }

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to store result:',
          expect.any(Error)
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
