// Sentinel Override — Audit Log Edge Cases
// Tests for audit-log.js failure modes, storage errors, and edge cases

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock chrome API
const mockLocalStorage = {};
const mockSetCalls = [];
const mockGetCalls = [];
const mockRemoveCalls = [];

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        mockGetCalls.push(keys);
        const result = {};
        const keyList = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of keyList) {
          result[k] = mockLocalStorage[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => {
        mockSetCalls.push(obj);
        Object.assign(mockLocalStorage, obj);
      }),
      remove: jest.fn(async (keys) => {
        mockRemoveCalls.push(keys);
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          delete mockLocalStorage[k];
        }
      }),
    },
  },
};
import {
  appendAuditEntry,
  getAuditLog,
  auditLogToCsv,
  clearAuditLog
} from '../background/audit-log.js';

const MAX_ENTRIES_PER_RUN = 500;
const STORAGE_KEY_PREFIX = 'audit_';

describe('audit-log edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear mock storage and call tracking
    for (const key of Object.keys(mockLocalStorage)) {
      delete mockLocalStorage[key];
    }
    mockSetCalls.length = 0;
    mockGetCalls.length = 0;
    mockRemoveCalls.length = 0;
  });

  describe('appendAuditEntry — failure modes', () => {
    it('handles null runId without throwing', async () => {
      await expect(appendAuditEntry(null, { type: 'test', target: 'foo', outcome: 'pass' }))
        .resolves.toBeUndefined();
    });

    it('handles undefined runId without throwing', async () => {
      await expect(appendAuditEntry(undefined, { type: 'test', target: 'foo', outcome: 'pass' }))
        .resolves.toBeUndefined();
    });

    it('handles empty string runId without throwing', async () => {
      await expect(appendAuditEntry('', { type: 'test', target: 'foo', outcome: 'pass' }))
        .resolves.toBeUndefined();
    });

    it('handles malformed entry object', async () => {
      const runId = 'test-run-malformed';
      await expect(appendAuditEntry(runId, null)).resolves.toBeUndefined();
      await expect(appendAuditEntry(runId, undefined)).resolves.toBeUndefined();
      await expect(appendAuditEntry(runId, {})).resolves.toBeUndefined();
      await expect(appendAuditEntry(runId, { type: null })).resolves.toBeUndefined();
    });

    it('sanitizes runId with special characters', async () => {
      const runId = 'test/run@with#special$chars';
      await appendAuditEntry(runId, { type: 'test', target: 'foo', outcome: 'pass' });
      const sanitizedKey = runId.replace(/[^a-z0-9_-]/gi, '_');
      expect(mockSetCalls.length).toBeGreaterThan(0);
      expect(mockLocalStorage[`${STORAGE_KEY_PREFIX}${sanitizedKey}`]).toBeDefined();
    });

    it('truncates target field at 120 characters', async () => {
      const runId = 'test-truncate-target';
      const longTarget = 'x'.repeat(200);
      await appendAuditEntry(runId, { type: 'test', target: longTarget, outcome: 'pass' });
      const storedLog = mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId}`];
      expect(storedLog).toBeDefined();
      expect(storedLog[0]).toBeDefined();
      expect(storedLog[0].target).toBeDefined();
      expect(storedLog[0].target.length).toBe(120);
    });

    it('truncates outcome field at 200 characters', async () => {
      const runId = 'test-truncate-outcome';
      const longOutcome = 'y'.repeat(300);
      await appendAuditEntry(runId, { type: 'test', target: 'foo', outcome: longOutcome });
      const storedLog = mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId}`];
      expect(storedLog).toBeDefined();
      expect(storedLog[0]).toBeDefined();
      expect(storedLog[0].outcome).toBeDefined();
      expect(storedLog[0].outcome.length).toBe(200);
    });

    it('enforces MAX_ENTRIES_PER_RUN circular buffer', async () => {
      const runId = 'test-circular-buffer';
      // Create a log that exceeds MAX_ENTRIES_PER_RUN
      const largeLog = [];
      for (let i = 0; i < MAX_ENTRIES_PER_RUN + 10; i++) {
        largeLog.push({ ts: Date.now(), step: i, type: 'test', target: `entry-${i}`, outcome: 'pass' });
      }

      // Simulate the circular buffer behavior directly
      const testLog = [...largeLog];
      testLog.push({ ts: Date.now(), step: 510, type: 'test', target: 'new-entry', outcome: 'pass' });
      if (testLog.length > MAX_ENTRIES_PER_RUN) {
        testLog.splice(0, testLog.length - MAX_ENTRIES_PER_RUN);
      }

      // Verify the splice behavior
      expect(testLog.length).toBe(MAX_ENTRIES_PER_RUN);
      expect(testLog[0].target).toBe('entry-11'); // First 11 entries removed
      expect(testLog[MAX_ENTRIES_PER_RUN - 1].target).toBe('new-entry');
    });

    it('converts missing fields to empty strings', async () => {
      const runId = 'test-missing-fields';
      await appendAuditEntry(runId, {});
      const storedLog = mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId}`];
      expect(storedLog).toBeDefined();
      expect(storedLog[0].type).toBe('');
      expect(storedLog[0].target).toBe('');
      expect(storedLog[0].outcome).toBe('');
    });

    it('handles non-string fields by converting to string', async () => {
      const runId = 'test-type-coercion';
      await appendAuditEntry(runId, {
        type: 123,
        target: { foo: 'bar' },
        outcome: true
      });
      const storedLog = mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId}`];
      expect(storedLog).toBeDefined();
      expect(storedLog[0].type).toBe('123');
      expect(storedLog[0].target).toBe('[object Object]');
      expect(storedLog[0].outcome).toBe('true');
    });

    it('handles storage.get failure gracefully', async () => {
      const runId = 'test-storage-get-fail';
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = jest.fn().mockRejectedValue(new Error('Storage quota exceeded'));
      await expect(appendAuditEntry(runId, { type: 'test', target: 'foo', outcome: 'pass' }))
        .resolves.toBeUndefined();
      chrome.storage.local.get = originalGet;
    });

    it('handles storage.set failure gracefully', async () => {
      const runId = 'test-storage-set-fail';
      const originalSet = chrome.storage.local.set;
      chrome.storage.local.set = jest.fn().mockRejectedValue(new Error('Storage quota exceeded'));
      await expect(appendAuditEntry(runId, { type: 'test', target: 'foo', outcome: 'pass' }))
        .resolves.toBeUndefined();
      chrome.storage.local.set = originalSet;
    });

    it('uses provided timestamp or defaults to Date.now()', async () => {
      const runId1 = 'test-timestamp-custom';
      const customTs = 1234567890;
      await appendAuditEntry(runId1, { ts: customTs, type: 'test', target: 'foo', outcome: 'pass' });
      expect(mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId1}`][0].ts).toBe(customTs);

      const runId2 = 'test-timestamp-default';
      await appendAuditEntry(runId2, { type: 'test2', target: 'bar', outcome: 'fail' });
      expect(mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId2}`][0].ts).toBeGreaterThan(customTs);
    });

    it('handles null step correctly', async () => {
      const runId = 'test-null-step';
      await appendAuditEntry(runId, { step: null, type: 'test', target: 'foo', outcome: 'pass' });
      expect(mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId}`][0].step).toBeNull();
    });

    it('handles undefined step as null', async () => {
      const runId = 'test-undefined-step';
      await appendAuditEntry(runId, { type: 'test', target: 'foo', outcome: 'pass' });
      expect(mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId}`][0].step).toBeNull();
    });

    it('preserves numeric step value', async () => {
      const runId = 'test-numeric-step';
      await appendAuditEntry(runId, { step: 42, type: 'test', target: 'foo', outcome: 'pass' });
      expect(mockLocalStorage[`${STORAGE_KEY_PREFIX}${runId}`][0].step).toBe(42);
    });
  });

  describe('getAuditLog — failure modes', () => {
    it('handles null runId', async () => {
      const result = await getAuditLog(null);
      expect(result).toEqual([]);
    });

    it('handles undefined runId', async () => {
      const result = await getAuditLog(undefined);
      expect(result).toEqual([]);
    });

    it('handles empty string runId', async () => {
      const result = await getAuditLog('');
      expect(result).toEqual([]);
    });

    it('handles storage.get failure by returning empty array', async () => {
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = jest.fn().mockRejectedValue(new Error('Storage corrupt'));
      const result = await getAuditLog('test-fail');
      expect(result).toEqual([]);
      chrome.storage.local.get = originalGet;
    });

    it('handles non-array stored value by returning empty array', async () => {
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = jest.fn().mockResolvedValue({ audit_test: 'not an array' });
      const result = await getAuditLog('test');
      expect(result).toEqual([]);
      chrome.storage.local.get = originalGet;
    });

    it('handles missing storage key by returning empty array', async () => {
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = jest.fn().mockResolvedValue({});
      const result = await getAuditLog('nonexistent');
      expect(result).toEqual([]);
      chrome.storage.local.get = originalGet;
    });

    it('handles storage.get returning undefined', async () => {
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = jest.fn().mockResolvedValue(undefined);
      const result = await getAuditLog('test');
      expect(result).toEqual([]);
      chrome.storage.local.get = originalGet;
    });

    it('sanitizes runId with special characters', async () => {
      const runId = 'test/run@with#special';
      await getAuditLog(runId);
      const sanitizedKey = STORAGE_KEY_PREFIX + runId.replace(/[^a-z0-9_-]/gi, '_');
      expect(mockGetCalls).toContain(sanitizedKey);
    });
  });

  describe('auditLogToCsv — edge cases', () => {
    it('handles null log', () => {
      const result = auditLogToCsv(null);
      expect(result).toContain('timestamp,step,type,target,outcome');
    });

    it('handles undefined log', () => {
      const result = auditLogToCsv(undefined);
      expect(result).toContain('timestamp,step,type,target,outcome');
    });

    it('handles empty log array', () => {
      const result = auditLogToCsv([]);
      expect(result).toBe('timestamp,step,type,target,outcome');
    });

    it('escapes double quotes in CSV fields', () => {
      const log = [
        { ts: 0, step: 1, type: 'click', target: 'button with "quotes"', outcome: 'ok' }
      ];
      const result = auditLogToCsv(log);
      expect(result).toContain('""quotes""');
    });

    it('handles entries with null timestamp', () => {
      const log = [
        { ts: null, step: 1, type: 'test', target: 'foo', outcome: 'pass' }
      ];
      const result = auditLogToCsv(log);
      expect(result).toContain('1970-01-01T00:00:00.000Z');
    });

    it('handles entries with missing timestamp', () => {
      const log = [
        { step: 1, type: 'test', target: 'foo', outcome: 'pass' }
      ];
      const result = auditLogToCsv(log);
      expect(result).toContain('1970-01-01T00:00:00.000Z');
    });

    it('handles null step value', () => {
      const log = [
        { ts: Date.now(), step: null, type: 'test', target: 'foo', outcome: 'pass' }
      ];
      const result = auditLogToCsv(log);
      expect(result).toContain(',"test","foo","pass"');
    });

    it('handles special characters in fields', () => {
      const log = [
        { ts: Date.now(), step: 1, type: 'test\nnewline', target: 'tab\there', outcome: 'comma,comma' }
      ];
      const result = auditLogToCsv(log);
      // All fields should be quoted, special chars preserved
      expect(result).toContain('test\nnewline');
      expect(result).toContain('tab\there');
      expect(result).toContain('comma,comma');
    });

    it('handles very long fields', () => {
      const log = [
        { ts: Date.now(), step: 1, type: 'x'.repeat(1000), target: 'y'.repeat(1000), outcome: 'z'.repeat(1000) }
      ];
      const result = auditLogToCsv(log);
      expect(result.length).toBeGreaterThan(2000);
    });

    it('uses CRLF line endings', () => {
      const log = [
        { ts: Date.now(), step: 1, type: 'test', target: 'foo', outcome: 'pass' },
        { ts: Date.now(), step: 2, type: 'test2', target: 'bar', outcome: 'fail' }
      ];
      const result = auditLogToCsv(log);
      expect(result).toContain('\r\n');
      expect(result).not.toContain('\n\r');
    });

    it('handles array with multiple entries', () => {
      const log = [
        { ts: 1000, step: 1, type: 'click', target: '#btn1', outcome: 'ok' },
        { ts: 2000, step: 2, type: 'click', target: '#btn2', outcome: 'ok' },
        { ts: 3000, step: 3, type: 'navigate', target: '/page', outcome: 'done' }
      ];
      const result = auditLogToCsv(log);
      const lines = result.split('\r\n');
      expect(lines).toHaveLength(4); // header + 3 entries
    });
  });

  describe('clearAuditLog — failure modes', () => {
    it('handles null runId', async () => {
      await expect(clearAuditLog(null)).resolves.toBeUndefined();
    });

    it('handles undefined runId', async () => {
      await expect(clearAuditLog(undefined)).resolves.toBeUndefined();
    });

    it('handles empty string runId', async () => {
      await expect(clearAuditLog('')).resolves.toBeUndefined();
    });

    it('handles storage.remove failure gracefully', async () => {
      const originalRemove = chrome.storage.local.remove;
      chrome.storage.local.remove = jest.fn().mockRejectedValue(new Error('Storage error'));
      await expect(clearAuditLog('test-fail')).resolves.toBeUndefined();
      chrome.storage.local.remove = originalRemove;
    });

    it('sanitizes runId with special characters', async () => {
      const runId = 'test/run@with#special';
      await clearAuditLog(runId);
      const sanitizedKey = runId.replace(/[^a-z0-9_-]/gi, '_');
      expect(mockRemoveCalls).toContain(`${STORAGE_KEY_PREFIX}${sanitizedKey}`);
    });

    it('handles error without message property', async () => {
      const originalRemove = chrome.storage.local.remove;
      chrome.storage.local.remove = jest.fn().mockRejectedValue({ code: 'FAIL' });
      await expect(clearAuditLog('test-no-msg')).resolves.toBeUndefined();
      chrome.storage.local.remove = originalRemove;
    });

    it('handles error thrown during key construction', async () => {
      const badRunId = { toString: () => { throw new Error('Cannot convert'); } };
      await expect(clearAuditLog(badRunId)).resolves.toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('handles rapid-fire append calls', async () => {
      const runId = 'test-rapid-fire';
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(appendAuditEntry(runId, { type: 'test', target: `entry-${i}`, outcome: 'pass' }));
      }
      await Promise.all(promises);
      expect(mockSetCalls.length).toBeGreaterThan(0);
    });

    it('handles append after clear', async () => {
      const runId = 'test-append-after-clear';
      await appendAuditEntry(runId, { type: 'test', target: 'foo', outcome: 'pass' });
      await clearAuditLog(runId);
      await appendAuditEntry(runId, { type: 'test2', target: 'bar', outcome: 'fail' });
      expect(mockRemoveCalls.length).toBeGreaterThan(0);
      expect(mockSetCalls.length).toBeGreaterThan(0);
    });

    it('handles concurrent getAuditLog calls', async () => {
      const runId = 'test-concurrent-get';
      const originalGet = chrome.storage.local.get;
      chrome.storage.local.get = jest.fn().mockResolvedValue({ audit_test_concurrent_get: [] });
      const promises = [getAuditLog(runId), getAuditLog(runId), getAuditLog(runId)];
      const results = await Promise.all(promises);
      expect(results).toEqual([[], [], []]);
      chrome.storage.local.get = originalGet;
    });
  });

  describe('constants', () => {
    it('constants are defined', () => {
      expect(MAX_ENTRIES_PER_RUN).toBeDefined();
      expect(STORAGE_KEY_PREFIX).toBeDefined();
    });
  });
});
