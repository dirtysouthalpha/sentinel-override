// tests/audit-log.test.js
// Unit tests for background/audit-log.js — full coverage of CSV export,
// appendAuditEntry, getAuditLog, and clearAuditLog.

import { jest } from '@jest/globals';

// ---------- chrome mock ----------
let storageData = {};

globalThis.chrome = {
  storage: {
    local: {
      get: jest.fn(async (keys) => {
        const keyList = Array.isArray(keys)
          ? keys
          : typeof keys === 'string'
            ? [keys]
            : Object.keys(keys || {});
        const result = {};
        for (const k of keyList) {
          if (storageData[k] !== undefined) result[k] = storageData[k];
        }
        return result;
      }),
      set: jest.fn(async (obj) => { Object.assign(storageData, obj); }),
      remove: jest.fn(async (key) => { delete storageData[key]; }),
    },
  },
};

const {
  auditLogToCsv,
  appendAuditEntry,
  getAuditLog,
  clearAuditLog,
  _resetAuditCacheForTesting,
} = await import('../background/audit-log.js');

beforeEach(() => {
  storageData = {};
  jest.clearAllMocks();
  _resetAuditCacheForTesting();
});

// ========== auditLogToCsv ==========

describe('auditLogToCsv', () => {
  test('returns header row for empty log', () => {
    const csv = auditLogToCsv([]);
    expect(csv).toBe('timestamp,step,type,target,outcome');
  });

  test('returns header + data row for single entry', () => {
    const entry = {
      ts: new Date('2026-05-13T10:00:00.000Z').getTime(),
      step: 1,
      type: 'click',
      target: '"Save" button',
      outcome: 'clicked',
    };
    const csv = auditLogToCsv([entry]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('timestamp,step,type,target,outcome');
    expect(lines[1]).toContain('2026-05-13T10:00:00.000Z');
    expect(lines[1]).toContain('"click"');
    expect(lines[1]).toContain('"clicked"');
  });

  test('escapes double quotes in field values', () => {
    const entry = {
      ts: Date.now(),
      step: 2,
      type: 'type',
      target: 'input[name="username"]',
      outcome: 'typed "admin"',
    };
    const csv = auditLogToCsv([entry]);
    expect(csv).toContain('""username""');
    expect(csv).toContain('""admin""');
  });

  test('handles null/undefined fields gracefully', () => {
    const entry = { ts: null, step: null, type: undefined, target: null, outcome: null };
    const csv = auditLogToCsv([entry]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBeDefined();
  });

  test('produces correct number of rows for multiple entries', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      ts: Date.now() + i * 1000,
      step: i + 1,
      type: 'click',
      target: 'button',
      outcome: 'ok',
    }));
    const csv = auditLogToCsv(entries);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(6);
  });

  test('handles undefined log argument', () => {
    const csv = auditLogToCsv(undefined);
    expect(csv).toBe('timestamp,step,type,target,outcome');
  });

  test('long outcome is preserved (not truncated by CSV conversion)', () => {
    const longOutcome = 'x'.repeat(250);
    const entry = { ts: Date.now(), step: 1, type: 'note', target: '', outcome: longOutcome };
    const csv = auditLogToCsv([entry]);
    expect(csv).toContain(longOutcome);
  });
});

// ========== appendAuditEntry ==========

describe('appendAuditEntry', () => {
  test('appends an entry to the audit log', async () => {
    await appendAuditEntry('run1', {
      ts: 1000,
      step: 1,
      type: 'click',
      target: '#btn',
      outcome: 'clicked',
    });
    const log = storageData['audit_run1'];
    expect(Array.isArray(log)).toBe(true);
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('click');
    expect(log[0].target).toBe('#btn');
  });

  test('uses Date.now() when ts is missing', async () => {
    const before = Date.now();
    await appendAuditEntry('run1', { step: 1, type: 'navigate' });
    const after = Date.now();
    const log = storageData['audit_run1'];
    expect(log[0].ts).toBeGreaterThanOrEqual(before);
    expect(log[0].ts).toBeLessThanOrEqual(after);
  });

  test('defaults step to null when not provided', async () => {
    await appendAuditEntry('run1', { type: 'observe' });
    const log = storageData['audit_run1'];
    expect(log[0].step).toBeNull();
  });

  test('coerces type/target/outcome to strings', async () => {
    await appendAuditEntry('run1', { type: 42, target: null, outcome: undefined });
    const log = storageData['audit_run1'];
    expect(log[0].type).toBe('42');
    expect(log[0].target).toBe('');
    expect(log[0].outcome).toBe('');
  });

  test('truncates target to 120 chars', async () => {
    const longTarget = 'x'.repeat(200);
    await appendAuditEntry('run1', { type: 'click', target: longTarget });
    const log = storageData['audit_run1'];
    expect(log[0].target.length).toBeLessThanOrEqual(120);
  });

  test('truncates outcome to 200 chars', async () => {
    const longOutcome = 'y'.repeat(300);
    await appendAuditEntry('run1', { type: 'click', outcome: longOutcome });
    const log = storageData['audit_run1'];
    expect(log[0].outcome.length).toBeLessThanOrEqual(200);
  });

  test('appends multiple entries in order', async () => {
    await appendAuditEntry('run1', { type: 'click', step: 1 });
    await appendAuditEntry('run1', { type: 'type', step: 2 });
    const log = storageData['audit_run1'];
    expect(log).toHaveLength(2);
    expect(log[0].step).toBe(1);
    expect(log[1].step).toBe(2);
  });

  test('trims to MAX_ENTRIES_PER_RUN (500)', async () => {
    // Pre-fill with 500 entries
    const existing = Array.from({ length: 500 }, (_, i) => ({
      ts: i, step: i, type: 'old', target: '', outcome: '',
    }));
    storageData['audit_run1'] = existing;

    await appendAuditEntry('run1', { type: 'new', step: 999 });
    const log = storageData['audit_run1'];
    expect(log).toHaveLength(500);
    expect(log[0].step).toBe(1); // oldest trimmed
    expect(log[499].step).toBe(999); // newest at end
  });

  test('no-ops when runId is falsy', async () => {
    await appendAuditEntry(null, { type: 'click' });
    await appendAuditEntry('', { type: 'click' });
    await appendAuditEntry(undefined, { type: 'click' });
    // Should not have written anything to storage
    const keys = Object.keys(storageData);
    expect(keys).toHaveLength(0);
  });

  test('sanitizes runId for use as storage key', async () => {
    await appendAuditEntry('run/with special!', { type: 'click' });
    const log = storageData['audit_run_with_special_'];
    expect(Array.isArray(log)).toBe(true);
  });

  test('handles storage.get rejection gracefully', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage fail'));
    // Should not throw
    await appendAuditEntry('run1', { type: 'click' });
  });

  test('handles storage.set rejection gracefully', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('quota'));
    // Should not throw
    await appendAuditEntry('run1', { type: 'click' });
  });
});

// ========== getAuditLog ==========

describe('getAuditLog', () => {
  test('returns empty array when no log exists', async () => {
    const log = await getAuditLog('nonexistent');
    expect(log).toEqual([]);
  });

  test('returns stored log entries', async () => {
    const entries = [
      { ts: 1, step: 1, type: 'click', target: '#btn', outcome: 'ok' },
      { ts: 2, step: 2, type: 'type', target: '#input', outcome: 'typed' },
    ];
    storageData['audit_run1'] = entries;
    const log = await getAuditLog('run1');
    expect(log).toEqual(entries);
  });

  test('returns empty array when stored value is not an array', async () => {
    storageData['audit_run1'] = 'not an array';
    const log = await getAuditLog('run1');
    expect(log).toEqual([]);
  });

  test('returns empty array for falsy runId', async () => {
    expect(await getAuditLog(null)).toEqual([]);
    expect(await getAuditLog('')).toEqual([]);
    expect(await getAuditLog(undefined)).toEqual([]);
  });

  test('sanitizes runId for storage key lookup', async () => {
    storageData['audit_run_with_special_'] = [{ ts: 1, step: 1, type: 'x', target: '', outcome: '' }];
    const log = await getAuditLog('run/with special!');
    expect(log).toHaveLength(1);
  });

  test('handles storage.get rejection gracefully', async () => {
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage fail'));
    const log = await getAuditLog('run1');
    expect(log).toEqual([]);
  });
});

// ========== clearAuditLog ==========

describe('clearAuditLog', () => {
  test('removes the audit log from storage', async () => {
    storageData['audit_run1'] = [{ ts: 1, step: 1, type: 'x', target: '', outcome: '' }];
    await clearAuditLog('run1');
    expect(storageData['audit_run1']).toBeUndefined();
  });

  test('no-ops for falsy runId', async () => {
    await clearAuditLog(null);
    await clearAuditLog('');
    await clearAuditLog(undefined);
    // Should not call remove
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });

  test('sanitizes runId for storage key removal', async () => {
    storageData['audit_run_with_special_'] = [{ ts: 1, step: 1, type: 'x', target: '', outcome: '' }];
    await clearAuditLog('run/with special!');
    expect(storageData['audit_run_with_special_']).toBeUndefined();
  });

  test('handles storage.remove rejection gracefully', async () => {
    storageData['audit_run1'] = [];
    chrome.storage.local.remove.mockRejectedValueOnce(new Error('remove fail'));
    // Should not throw
    await clearAuditLog('run1');
  });

  test('handles outer try block errors gracefully', async () => {
    // Test the outer catch block (line 113 in audit-log.js) that catches errors
    // from _storageKey(runId) computation before the inner remove call
    const badRunId = {
      toString: () => { throw new Error('toString failed'); },
    };
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Should not throw - outer catch should handle the error
    await clearAuditLog(badRunId);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Sentinel/audit-log] clearAuditLog failed:',
      'toString failed'
    );
    consoleSpy.mockRestore();
  });
});
