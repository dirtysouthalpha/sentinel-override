// tests/audit-log.test.js
// Unit tests for background/audit-log.js pure functions.
// auditLogToCsv has no chrome.* dependencies — safe to run in Node.

import { auditLogToCsv } from '../background/audit-log.js';

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
    // Double-quotes in values should be escaped as ""
    expect(csv).toContain('""username""');
    expect(csv).toContain('""admin""');
  });

  test('handles null/undefined fields gracefully', () => {
    const entry = { ts: null, step: null, type: undefined, target: null, outcome: null };
    const csv = auditLogToCsv([entry]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    // Should not throw and should produce a data row
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
    // 1 header + 5 data rows = 6 lines
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
