// Sentinel Override v3 -- Unit tests for background/scheduler.js
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../helpers/chrome-mock.js';

describe('scheduler', () => {
  let chrome;

  beforeAll(() => {
    chrome = setupChromeMock();
    // Mock crypto.randomUUID
    if (!globalThis.crypto?.randomUUID) {
      globalThis.crypto = { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) };
    }
  });

  let createSchedule, listSchedules, deleteSchedule, toggleSchedule;
  let getNextRunTime, getScheduleResults, getRecentResults, clearScheduleResults;
  let onAgentComplete, initScheduler;

  beforeAll(async () => {
    // Mock agent-engine dependency
    vi.stubGlobal('agentRunning', false);

    const mod = await import('../../background/scheduler.js');
    createSchedule = mod.createSchedule;
    listSchedules = mod.listSchedules;
    deleteSchedule = mod.deleteSchedule;
    toggleSchedule = mod.toggleSchedule;
    getNextRunTime = mod.getNextRunTime;
    getScheduleResults = mod.getScheduleResults;
    getRecentResults = mod.getRecentResults;
    clearScheduleResults = mod.clearScheduleResults;
    onAgentComplete = mod.onAgentComplete;
    initScheduler = mod.initScheduler;
  });

  // Clear storage between tests
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.alarms.clearAll();
  });

  // ========== createSchedule ==========
  describe('createSchedule', () => {
    it('throws if data is not an object', async () => {
      await expect(createSchedule(null)).rejects.toThrow('must be an object');
      await expect(createSchedule('string')).rejects.toThrow('must be an object');
    });

    it('throws if name is missing or empty', async () => {
      await expect(createSchedule({ goal: 'test' })).rejects.toThrow('name is required');
      await expect(createSchedule({ name: '', goal: 'test' })).rejects.toThrow('name is required');
      await expect(createSchedule({ name: '  ', goal: 'test' })).rejects.toThrow('name is required');
    });

    it('throws if neither templateId nor goal provided', async () => {
      await expect(createSchedule({ name: 'test' })).rejects.toThrow('templateId or goal');
    });

    it('throws for invalid type', async () => {
      await expect(createSchedule({ name: 'test', goal: 'g', type: 'invalid' }))
        .rejects.toThrow('Schedule type must');
    });

    it('creates a one-time schedule with default run time', async () => {
      const s = await createSchedule({ name: 'Test Task', goal: 'do something', type: 'once' });
      expect(s.id).toBeDefined();
      expect(s.name).toBe('Test Task');
      expect(s.goal).toBe('do something');
      expect(s.type).toBe('once');
      expect(s.enabled).toBe(true);
      expect(s.nextRunAt).toBeGreaterThan(Date.now() - 1000);
      expect(s.lastRunAt).toBeNull();
    });

    it('creates a one-time schedule with custom runAt', async () => {
      const futureTime = Date.now() + 86400000; // 24h from now
      const s = await createSchedule({ name: 'Future', goal: 'g', type: 'once', runAt: futureTime });
      expect(s.nextRunAt).toBe(futureTime);
    });

    it('defaults to 1 hour from now if runAt is in the past', async () => {
      const pastTime = Date.now() - 10000;
      const s = await createSchedule({ name: 'Past', goal: 'g', type: 'once', runAt: pastTime });
      expect(s.nextRunAt).toBeGreaterThan(Date.now());
    });

    it('creates a recurring daily schedule', async () => {
      const s = await createSchedule({
        name: 'Daily',
        goal: 'check firewall',
        type: 'recurring',
        recurrence: { interval: 'daily', time: '09:00' },
      });
      expect(s.type).toBe('recurring');
      expect(s.recurrence.interval).toBe('daily');
      expect(s.recurrence.periodInMinutes).toBe(1440);
      expect(s.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    });

    it('creates a recurring weekly schedule', async () => {
      const s = await createSchedule({
        name: 'Weekly',
        goal: 'weekly report',
        type: 'recurring',
        recurrence: { interval: 'weekly', daysOfWeek: [1, 3, 5], time: '10:00' },
      });
      expect(s.recurrence.periodInMinutes).toBe(10080);
      expect(s.recurrence.daysOfWeek).toEqual([1, 3, 5]);
    });

    it('creates a schedule with templateId', async () => {
      const s = await createSchedule({ name: 'Template', templateId: 'tmpl-123', type: 'once' });
      expect(s.templateId).toBe('tmpl-123');
      expect(s.goal).toBeNull();
    });

    it('creates a schedule with params', async () => {
      const s = await createSchedule({
        name: 'Param',
        templateId: 'tmpl-1',
        type: 'once',
        params: { ip: '192.168.1.1' },
      });
      expect(s.params).toEqual({ ip: '192.168.1.1' });
    });

    it('trims the name', async () => {
      const s = await createSchedule({ name: '  spaced  ', goal: 'g', type: 'once' });
      expect(s.name).toBe('spaced');
    });

    it('registers a chrome alarm', async () => {
      await createSchedule({ name: 'Alarm', goal: 'g', type: 'once' });
      const alarms = await chrome.alarms.getAll();
      expect(alarms.length).toBeGreaterThan(0);
      expect(alarms[0].name).toContain('schedule-');
    });
  });

  // ========== listSchedules ==========
  describe('listSchedules', () => {
    it('returns empty array when no schedules', async () => {
      const list = await listSchedules();
      expect(list).toEqual([]);
    });

    it('returns all schedules sorted by enabled then nextRunAt', async () => {
      const s1 = await createSchedule({ name: 'First', goal: 'g1', type: 'once' });
      const s2 = await createSchedule({ name: 'Second', goal: 'g2', type: 'once' });
      await toggleSchedule(s2.id, false);

      const list = await listSchedules();
      expect(list).toHaveLength(2);
      expect(list[0].enabled).toBe(true);
      expect(list[1].enabled).toBe(false);
    });
  });

  // ========== deleteSchedule ==========
  describe('deleteSchedule', () => {
    it('throws if id is missing', async () => {
      await expect(deleteSchedule(null)).rejects.toThrow('ID is required');
      await expect(deleteSchedule('')).rejects.toThrow('ID is required');
    });

    it('throws if schedule not found', async () => {
      await expect(deleteSchedule('nonexistent')).rejects.toThrow('not found');
    });

    it('deletes a schedule and clears its alarm', async () => {
      const s = await createSchedule({ name: 'DeleteMe', goal: 'g', type: 'once' });
      await deleteSchedule(s.id);
      const list = await listSchedules();
      expect(list).toHaveLength(0);
    });

    it('clears associated results when deleting', async () => {
      const s = await createSchedule({ name: 'WithResults', goal: 'g', type: 'once' });
      // Manually add a result
      await chrome.storage.local.set({
        sentinel_schedule_results: {
          'result-1': { scheduleId: s.id, status: 'success', completedAt: Date.now() },
        },
      });
      await deleteSchedule(s.id);
      const stored = await chrome.storage.local.get(['sentinel_schedule_results']);
      expect(stored.sentinel_schedule_results || {}).not.toHaveProperty('result-1');
    });
  });

  // ========== toggleSchedule ==========
  describe('toggleSchedule', () => {
    it('throws if id is missing', async () => {
      await expect(toggleSchedule(null, false)).rejects.toThrow('ID is required');
    });

    it('throws if enabled is not boolean', async () => {
      await expect(toggleSchedule('id', 'yes')).rejects.toThrow('boolean');
    });

    it('throws if schedule not found', async () => {
      await expect(toggleSchedule('nonexistent', false)).rejects.toThrow('not found');
    });

    it('disables a schedule', async () => {
      const s = await createSchedule({ name: 'Toggle', goal: 'g', type: 'once' });
      const updated = await toggleSchedule(s.id, false);
      expect(updated.enabled).toBe(false);
    });

    it('re-enables a schedule and recomputes nextRunAt', async () => {
      const s = await createSchedule({ name: 'ReEnable', goal: 'g', type: 'once' });
      await toggleSchedule(s.id, false);
      const updated = await toggleSchedule(s.id, true);
      expect(updated.enabled).toBe(true);
      expect(updated.nextRunAt).toBeGreaterThan(Date.now() - 1000);
    });
  });

  // ========== getNextRunTime ==========
  describe('getNextRunTime', () => {
    it('returns null for null schedule', () => {
      expect(getNextRunTime(null)).toBeNull();
    });

    it('returns nextRunAt for one-time schedule', () => {
      const ts = Date.now() + 3600000;
      expect(getNextRunTime({ type: 'once', nextRunAt: ts })).toBe(ts);
    });

    it('computes next run for recurring schedule', () => {
      const result = getNextRunTime({
        type: 'recurring',
        recurrence: { interval: 'daily', time: '09:00' },
        nextRunAt: Date.now() - 1000,
      });
      expect(result).toBeGreaterThan(Date.now() - 1000);
    });

    it('returns nextRunAt for unrecognized type', () => {
      const ts = 999;
      expect(getNextRunTime({ type: 'unknown', nextRunAt: ts })).toBe(ts);
    });
  });

  // ========== getScheduleResults ==========
  describe('getScheduleResults', () => {
    it('returns empty array for null scheduleId', async () => {
      expect(await getScheduleResults(null)).toEqual([]);
      expect(await getScheduleResults('')).toEqual([]);
    });

    it('returns results for a specific schedule', async () => {
      await chrome.storage.local.set({
        sentinel_schedule_results: {
          'r1': { scheduleId: 's1', status: 'success', completedAt: 100 },
          'r2': { scheduleId: 's1', status: 'failure', completedAt: 200 },
          'r3': { scheduleId: 's2', status: 'success', completedAt: 300 },
        },
      });
      const results = await getScheduleResults('s1');
      expect(results).toHaveLength(2);
      // Sorted by completedAt desc
      expect(results[0].completedAt).toBe(200);
    });

    it('limits to 20 results', async () => {
      const results = {};
      for (let i = 0; i < 25; i++) {
        results[`r${i}`] = { scheduleId: 's1', status: 'success', completedAt: i };
      }
      await chrome.storage.local.set({ sentinel_schedule_results: results });
      const list = await getScheduleResults('s1');
      expect(list.length).toBeLessThanOrEqual(20);
    });
  });

  // ========== getRecentResults ==========
  describe('getRecentResults', () => {
    it('returns empty array when no results', async () => {
      expect(await getRecentResults()).toEqual([]);
    });

    it('returns results sorted by completedAt desc', async () => {
      await chrome.storage.local.set({
        sentinel_schedule_results: {
          'r1': { scheduleId: 's1', status: 'success', completedAt: 100 },
          'r2': { scheduleId: 's2', status: 'success', completedAt: 300 },
          'r3': { scheduleId: 's1', status: 'failure', completedAt: 200 },
        },
      });
      const results = await getRecentResults();
      expect(results).toHaveLength(3);
      expect(results[0].completedAt).toBe(300);
      expect(results[1].completedAt).toBe(200);
      expect(results[2].completedAt).toBe(100);
    });

    it('respects the limit parameter', async () => {
      const results = {};
      for (let i = 0; i < 30; i++) {
        results[`r${i}`] = { scheduleId: 's1', status: 'success', completedAt: i };
      }
      await chrome.storage.local.set({ sentinel_schedule_results: results });
      const list = await getRecentResults(5);
      expect(list).toHaveLength(5);
    });
  });

  // ========== clearScheduleResults ==========
  describe('clearScheduleResults', () => {
    it('throws if scheduleId is missing', async () => {
      await expect(clearScheduleResults(null)).rejects.toThrow('ID is required');
    });

    it('clears all results for a schedule', async () => {
      await chrome.storage.local.set({
        sentinel_schedule_results: {
          'r1': { scheduleId: 's1', status: 'success', completedAt: 100 },
          'r2': { scheduleId: 's2', status: 'success', completedAt: 200 },
        },
      });
      await clearScheduleResults('s1');
      const results = await getScheduleResults('s1');
      expect(results).toEqual([]);
      // s2 results remain
      const s2 = await getScheduleResults('s2');
      expect(s2).toHaveLength(1);
    });
  });

  // ========== onAgentComplete ==========
  describe('onAgentComplete', () => {
    it('registers a callback without error', () => {
      expect(() => onAgentComplete(() => {})).not.toThrow();
    });
  });

  // ========== initScheduler ==========
  describe('initScheduler', () => {
    it('runs without error on empty storage', async () => {
      await expect(initScheduler()).resolves.toBeUndefined();
    });

    it('re-registers alarms for enabled schedules', async () => {
      await createSchedule({
        name: 'Init Test',
        goal: 'g',
        type: 'recurring',
        recurrence: { interval: 'daily', time: '09:00' },
      });
      // Clear all alarms
      await chrome.alarms.clearAll();

      await initScheduler();

      const alarms = await chrome.alarms.getAll();
      expect(alarms.length).toBeGreaterThan(0);
    });

    it('skips disabled schedules', async () => {
      const s = await createSchedule({ name: 'Disabled', goal: 'g', type: 'once' });
      await toggleSchedule(s.id, false);
      await chrome.alarms.clearAll();

      await initScheduler();

      const alarms = await chrome.alarms.getAll();
      expect(alarms).toHaveLength(0);
    });
  });
});
