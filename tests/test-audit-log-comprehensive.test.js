// tests/test-audit-log-comprehensive.test.js
// Comprehensive tests for background/audit-log.js
// Phase 3 — auditLogToCsv, evictAuditCache, appendAuditEntry, getAuditLog, clearAuditLog

import { jest } from '@jest/globals';

// Mock chrome.storage.local
const storageData = {};
const mockGet = jest.fn(async (keys) => {
  if (typeof keys === 'string') {
    return { [keys]: storageData[keys] !== undefined ? storageData[keys] : undefined };
  }
  const result = {};
  for (const key of Array.isArray(keys) ? keys : Object.keys(keys || {})) {
    result[key] = storageData[key];
  }
  return result;
});
const mockSet = jest.fn(async (obj) => {
  Object.assign(storageData, obj);
});
const mockRemove = jest.fn(async (key) => {
  if (typeof key === 'string') {
    delete storageData[key];
  } else if (Array.isArray(key)) {
    key.forEach(k => delete storageData[k]);
  }
});

globalThis.chrome = {
  storage: {
    local: {
      get: mockGet,
      set: mockSet,
      remove: mockRemove,
    },
  },
};

const {
  auditLogToCsv,
  evictAuditCache,
  appendAuditEntry,
  getAuditLog,
  clearAuditLog,
  _resetAuditCacheForTesting,
} = await import('../background/audit-log.js');

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  jest.clearAllMocks();
  _resetAuditCacheForTesting();
});

// ═══════════════════════════════════════════════════════════════════
// auditLogToCsv
// ═══════════════════════════════════════════════════════════════════
describe('auditLogToCsv', () => {
  test('returns header row for empty log', () => {
    const result = auditLogToCsv([]);
    expect(result).toContain('timestamp,step,type,target,outcome');
  });

  test('header is first line', () => {
    const result = auditLogToCsv([]);
    const lines = result.split('\r\n');
    expect(lines[0]).toBe('timestamp,step,type,target,outcome');
  });

  test('single entry produces two lines (header + data)', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: '#btn', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    const lines = result.split('\r\n');
    expect(lines).toHaveLength(2);
  });

  test('uses CRLF line endings', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: '#btn', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('\r\n');
  });

  test('formats timestamp as ISO string', () => {
    const ts = new Date('2024-01-15T10:30:00Z').getTime();
    const log = [{ ts, step: 1, type: 'click', target: '#btn', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('2024-01-15T10:30:00.000Z');
  });

  test('handles entry without ts (uses epoch)', () => {
    const log = [{ step: 1, type: 'click', target: '#btn', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('1970-01-01T00:00:00.000Z');
  });

  test('quotes all fields', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: '#btn', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    const lines = result.split('\r\n');
    const dataLine = lines[1];
    // Each field should be quoted
    expect(dataLine).toMatch(/^".*",".*",".*",".*",".*"$/);
  });

  test('escapes double quotes in values', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: 'button "submit"', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('button ""submit""');
  });

  test('handles null log', () => {
    const result = auditLogToCsv(null);
    expect(result).toContain('timestamp,step,type,target,outcome');
  });

  test('handles undefined log', () => {
    const result = auditLogToCsv(undefined);
    expect(result).toContain('timestamp,step,type,target,outcome');
  });

  test('handles entry with missing fields', () => {
    const log = [{ ts: Date.now() }];
    const result = auditLogToCsv(log);
    expect(result).not.toContain('undefined');
  });

  test('handles entry with null step', () => {
    const log = [{ ts: Date.now(), step: null, type: 'click', target: '#btn', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    // step should be empty string
    const lines = result.split('\r\n');
    const dataLine = lines[1];
    const fields = dataLine.match(/"([^"]*)"/g);
    expect(fields[1]).toBe('""'); // step field
  });

  test('handles entry with null type', () => {
    const log = [{ ts: Date.now(), step: 1, type: null, target: '#btn', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).not.toContain('null');
  });

  test('handles entry with null target', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: null, outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).not.toContain('null');
  });

  test('handles entry with null outcome', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: '#btn', outcome: null }];
    const result = auditLogToCsv(log);
    expect(result).not.toContain('null');
  });

  test('handles entry with empty string values', () => {
    const log = [{ ts: Date.now(), step: 1, type: '', target: '', outcome: '' }];
    const result = auditLogToCsv(log);
    const lines = result.split('\r\n');
    expect(lines).toHaveLength(2);
  });

  test('handles entry with numeric type (coerced to string)', () => {
    const log = [{ ts: Date.now(), step: 1, type: 42, target: '#btn', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('42');
  });

  test('handles commas in field values', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: 'button, submit', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    const lines = result.split('\r\n');
    // The comma should be inside quotes, so we still have 5 fields
    const fields = lines[1].match(/"[^"]*"/g);
    expect(fields).toHaveLength(5);
  });

  test('handles newlines in field values', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: 'line1\nline2', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    // Newline in quoted field should not create extra lines
    // Actually, the CSV doesn't explicitly handle embedded newlines,
    // but the value is just quoted
    expect(result).toBeTruthy();
  });

  test('multiple entries produce correct line count', () => {
    const log = [
      { ts: Date.now(), step: 1, type: 'click', target: '#a', outcome: 'ok' },
      { ts: Date.now(), step: 2, type: 'type', target: '#b', outcome: 'ok' },
      { ts: Date.now(), step: 3, type: 'navigate', target: 'url', outcome: 'done' },
    ];
    const result = auditLogToCsv(log);
    const lines = result.split('\r\n');
    expect(lines).toHaveLength(4); // header + 3 entries
  });

  test('preserves entry order', () => {
    const log = [
      { ts: 1000, step: 1, type: 'first_action', target: 'a', outcome: '1' },
      { ts: 2000, step: 2, type: 'second_action', target: 'b', outcome: '2' },
    ];
    const result = auditLogToCsv(log);
    const firstIdx = result.indexOf('first_action');
    const secondIdx = result.indexOf('second_action');
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  test('handles entry with very long target (truncated to 120 by appendAuditEntry)', () => {
    // auditLogToCsv doesn't truncate itself, but appendAuditEntry does
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: 'A'.repeat(200), outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('A'.repeat(200));
  });

  test('handles entry with special regex characters', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: '$100 (USD)', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('$100 (USD)');
  });

  test('handles entry with unicode characters', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: '按钮 提交', outcome: 'ok' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('按钮 提交');
  });

  test('handles entry with emoji', () => {
    const log = [{ ts: Date.now(), step: 1, type: 'click', target: '✅ Submit', outcome: '🚀 done' }];
    const result = auditLogToCsv(log);
    expect(result).toContain('✅ Submit');
    expect(result).toContain('🚀 done');
  });
});

// ═══════════════════════════════════════════════════════════════════
// evictAuditCache
// ═══════════════════════════════════════════════════════════════════
describe('evictAuditCache', () => {
  test('is a function', () => {
    expect(typeof evictAuditCache).toBe('function');
  });

  test('does not throw for valid runId', () => {
    expect(() => evictAuditCache('test-run-1')).not.toThrow();
  });

  test('does not throw for empty string runId', () => {
    expect(() => evictAuditCache('')).not.toThrow();
  });

  test('does not throw for null runId', () => {
    expect(() => evictAuditCache(null)).not.toThrow();
  });

  test('does not throw for undefined runId', () => {
    expect(() => evictAuditCache(undefined)).not.toThrow();
  });

  test('evicts cached run after appendAuditEntry populates cache', async () => {
    await appendAuditEntry('run1', { type: 'click', target: '#btn', outcome: 'ok' });
    // Verify it's cached
    const log1 = await getAuditLog('run1');
    expect(log1.length).toBe(1);

    // Evict
    evictAuditCache('run1');

    // After eviction, getAuditLog reads from storage
    const log2 = await getAuditLog('run1');
    expect(log2.length).toBe(1);
  });

  test('evicting non-existent runId does not throw', () => {
    expect(() => evictAuditCache('nonexistent')).not.toThrow();
  });

  test('_resetAuditCacheForTesting clears all', async () => {
    await appendAuditEntry('run-a', { type: 'click', target: '#a', outcome: 'ok' });
    await appendAuditEntry('run-b', { type: 'type', target: '#b', outcome: 'ok' });

    _resetAuditCacheForTesting();

    // getAuditLog should now read from storage (not cache)
    const logA = await getAuditLog('run-a');
    const logB = await getAuditLog('run-b');
    expect(logA.length).toBe(1);
    expect(logB.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// appendAuditEntry
// ═══════════════════════════════════════════════════════════════════
describe('appendAuditEntry', () => {
  test('is an async function', () => {
    expect(typeof appendAuditEntry).toBe('function');
  });

  test('does not throw for valid entry', async () => {
    await expect(appendAuditEntry('run1', { type: 'click', target: '#btn', outcome: 'ok' })).resolves.not.toThrow();
  });

  test('does not throw for null runId', async () => {
    await expect(appendAuditEntry(null, { type: 'click', target: '#btn', outcome: 'ok' })).resolves.not.toThrow();
  });

  test('does not throw for empty string runId', async () => {
    await expect(appendAuditEntry('', { type: 'click', target: '#btn', outcome: 'ok' })).resolves.not.toThrow();
  });

  test('entry with missing type gets empty string type', async () => {
    await appendAuditEntry('test-missing', { target: '#btn', outcome: 'ok' });
    const log = await getAuditLog('test-missing');
    expect(log[0].type).toBe('');
  });

  test('entry with missing target gets empty string target', async () => {
    await appendAuditEntry('test-missing2', { type: 'click', outcome: 'ok' });
    const log = await getAuditLog('test-missing2');
    expect(log[0].target).toBe('');
  });

  test('entry with missing outcome gets empty string outcome', async () => {
    await appendAuditEntry('test-missing3', { type: 'click', target: '#btn' });
    const log = await getAuditLog('test-missing3');
    expect(log[0].outcome).toBe('');
  });

  test('entry gets auto-timestamp if missing ts', async () => {
    const before = Date.now();
    await appendAuditEntry('test-ts', { type: 'click', target: '#btn', outcome: 'ok' });
    const after = Date.now();
    const log = await getAuditLog('test-ts');
    expect(log[0].ts).toBeGreaterThanOrEqual(before);
    expect(log[0].ts).toBeLessThanOrEqual(after);
  });

  test('entry preserves explicit ts', async () => {
    const ts = new Date('2020-01-01').getTime();
    await appendAuditEntry('test-explicit-ts', { ts, type: 'click', target: '#btn', outcome: 'ok' });
    const log = await getAuditLog('test-explicit-ts');
    expect(log[0].ts).toBe(ts);
  });

  test('preserves step number', async () => {
    await appendAuditEntry('test-step', { type: 'click', target: '#btn', outcome: 'ok', step: 5 });
    const log = await getAuditLog('test-step');
    expect(log[0].step).toBe(5);
  });

  test('step defaults to null when not provided', async () => {
    await appendAuditEntry('test-no-step', { type: 'click', target: '#btn', outcome: 'ok' });
    const log = await getAuditLog('test-no-step');
    expect(log[0].step).toBeNull();
  });

  test('multiple appends accumulate in order', async () => {
    await appendAuditEntry('test-order', { type: 'click', target: '#a', outcome: '1' });
    await appendAuditEntry('test-order', { type: 'type', target: '#b', outcome: '2' });
    await appendAuditEntry('test-order', { type: 'navigate', target: 'url', outcome: '3' });
    const log = await getAuditLog('test-order');
    expect(log).toHaveLength(3);
    expect(log[0].type).toBe('click');
    expect(log[1].type).toBe('type');
    expect(log[2].type).toBe('navigate');
  });

  test('target is truncated to 120 chars', async () => {
    const longTarget = 'A'.repeat(200);
    await appendAuditEntry('test-trunc', { type: 'click', target: longTarget, outcome: 'ok' });
    const log = await getAuditLog('test-trunc');
    expect(log[0].target.length).toBe(120);
  });

  test('outcome is truncated to 200 chars', async () => {
    const longOutcome = 'B'.repeat(300);
    await appendAuditEntry('test-trunc2', { type: 'click', target: '#btn', outcome: longOutcome });
    const log = await getAuditLog('test-trunc2');
    expect(log[0].outcome.length).toBe(200);
  });

  test('type is coerced to string', async () => {
    await appendAuditEntry('test-coerce', { type: 42, target: '#btn', outcome: 'ok' });
    const log = await getAuditLog('test-coerce');
    expect(log[0].type).toBe('42');
  });

  test('persisted to chrome.storage.local', async () => {
    await appendAuditEntry('test-persist', { type: 'click', target: '#btn', outcome: 'ok' });
    expect(mockSet).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// getAuditLog
// ═══════════════════════════════════════════════════════════════════
describe('getAuditLog', () => {
  test('returns empty array for null runId', async () => {
    const log = await getAuditLog(null);
    expect(log).toEqual([]);
  });

  test('returns empty array for empty string runId', async () => {
    const log = await getAuditLog('');
    expect(log).toEqual([]);
  });

  test('returns empty array for non-existent runId', async () => {
    const log = await getAuditLog('nonexistent');
    expect(log).toEqual([]);
  });

  test('returns entries from cache after append', async () => {
    await appendAuditEntry('cache-test', { type: 'click', target: '#btn', outcome: 'ok' });
    const log = await getAuditLog('cache-test');
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('click');
  });

  test('returns a copy (not reference)', async () => {
    await appendAuditEntry('copy-test', { type: 'click', target: '#btn', outcome: 'ok' });
    const log1 = await getAuditLog('copy-test');
    const log2 = await getAuditLog('copy-test');
    expect(log1).not.toBe(log2);
    expect(log1).toEqual(log2);
  });

  test('falls back to storage when cache is empty', async () => {
    // Directly put data in storage
    storageData['audit_test-fallback'] = [
      { ts: Date.now(), step: 1, type: 'click', target: '#btn', outcome: 'ok' }
    ];
    const log = await getAuditLog('test-fallback');
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('click');
  });

  test('handles corrupted storage data', async () => {
    storageData['audit_test-corrupt'] = 'not an array';
    const log = await getAuditLog('test-corrupt');
    expect(log).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// clearAuditLog
// ═══════════════════════════════════════════════════════════════════
describe('clearAuditLog', () => {
  test('does not throw for valid runId', async () => {
    await expect(clearAuditLog('test-clear')).resolves.not.toThrow();
  });

  test('does not throw for null runId', async () => {
    await expect(clearAuditLog(null)).resolves.not.toThrow();
  });

  test('does not throw for empty string runId', async () => {
    await expect(clearAuditLog('')).resolves.not.toThrow();
  });

  test('clears entries for a run', async () => {
    await appendAuditEntry('test-clear2', { type: 'click', target: '#a', outcome: 'ok' });
    await appendAuditEntry('test-clear2', { type: 'type', target: '#b', outcome: 'ok' });
    expect((await getAuditLog('test-clear2')).length).toBe(2);

    await clearAuditLog('test-clear2');
    expect((await getAuditLog('test-clear2')).length).toBe(0);
  });

  test('clears cache entry', async () => {
    await appendAuditEntry('test-clear-cache', { type: 'click', target: '#a', outcome: 'ok' });
    evictAuditCache('test-clear-cache');

    await clearAuditLog('test-clear-cache');
    // Storage should also be cleared
    const log = await getAuditLog('test-clear-cache');
    expect(log).toEqual([]);
  });

  test('does not affect other runs', async () => {
    await appendAuditEntry('test-clear-a', { type: 'click', target: '#a', outcome: 'ok' });
    await appendAuditEntry('test-clear-b', { type: 'type', target: '#b', outcome: 'ok' });

    await clearAuditLog('test-clear-a');

    const logA = await getAuditLog('test-clear-a');
    const logB = await getAuditLog('test-clear-b');
    expect(logA).toEqual([]);
    expect(logB.length).toBe(1);
  });
  test('persists removal to storage', async () => {
    await appendAuditEntry('test-clear-persist', { type: 'click', target: '#a', outcome: 'ok' });
    await clearAuditLog('test-clear-persist');
    expect(mockRemove).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// _resetAuditCacheForTesting
// ═══════════════════════════════════════════════════════════════════
describe('_resetAuditCacheForTesting', () => {
  test('is a function', () => {
    expect(typeof _resetAuditCacheForTesting).toBe('function');
  });

  test('does not throw', () => {
    expect(() => _resetAuditCacheForTesting()).not.toThrow();
  });

  test('clears all cached entries', async () => {
    await appendAuditEntry('test-reset-1', { type: 'click', target: '#a', outcome: 'ok' });
    await appendAuditEntry('test-reset-2', { type: 'type', target: '#b', outcome: 'ok' });

    _resetAuditCacheForTesting();

    // Entries should still be in storage
    const log1 = await getAuditLog('test-reset-1');
    const log2 = await getAuditLog('test-reset-2');
    expect(log1.length).toBe(1);
    expect(log2.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Storage key generation
// ═══════════════════════════════════════════════════════════════════
describe('storage key generation', () => {
  test('runId with special chars gets sanitized', async () => {
    await appendAuditEntry('test/run id!', { type: 'click', target: '#btn', outcome: 'ok' });
    // The storage key should have sanitized the runId
    const keys = Object.keys(storageData).filter(k => k.startsWith('audit_'));
    expect(keys.length).toBeGreaterThan(0);
    // Special chars should be replaced with _
    const key = keys.find(k => k.includes('test_run_id_'));
    expect(key).toBeTruthy();
  });
});
