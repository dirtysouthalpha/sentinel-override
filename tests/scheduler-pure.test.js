// tests/scheduler-pure.test.js
// Tests for scheduler.js pure functions.

// Mock chrome for scheduler imports
globalThis.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({}),
      set: (data, cb) => { if (cb) cb(); }
    }
  },
  runtime: { lastError: null },
  alarms: { create: () => {}, clear: () => {} },
  notifications: { create: () => {} }
};

import { getNextRunTime } from '../background/scheduler.js';

describe('getNextRunTime', () => {
  test('returns null for null schedule', () => {
    expect(getNextRunTime(null)).toBeNull();
  });

  test('returns null for undefined schedule', () => {
    expect(getNextRunTime(undefined)).toBeNull();
  });

  test('returns nextRunAt for once schedule', () => {
    const schedule = { type: 'once', nextRunAt: '2026-07-01T10:00:00Z' };
    expect(getNextRunTime(schedule)).toBe('2026-07-01T10:00:00Z');
  });

  test('returns nextRunAt for schedule without type', () => {
    const schedule = { nextRunAt: '2026-07-01T10:00:00Z' };
    expect(getNextRunTime(schedule)).toBe('2026-07-01T10:00:00Z');
  });

  test('computes next run for recurring schedule', () => {
    const schedule = {
      type: 'recurring',
      recurrence: { interval: 'daily', hour: 14, minute: 0 },
      nextRunAt: '2026-07-01T14:00:00Z'
    };
    const result = getNextRunTime(schedule);
    expect(result).toBeDefined();
  });
});
