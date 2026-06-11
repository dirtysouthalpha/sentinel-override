// tests/popup-helpers.test.js
// Unit tests for popup-modules/helpers.js — formatCountdown, relativeTime, formatDuration.

globalThis.window = globalThis;
globalThis.Helpers = {};

await import('../popup-modules/helpers.js');

describe('Helpers.formatCountdown', () => {
  test('returns "Not scheduled" for falsy timestamp', () => {
    expect(Helpers.formatCountdown(0)).toBe('Not scheduled');
    expect(Helpers.formatCountdown(null)).toBe('Not scheduled');
    expect(Helpers.formatCountdown(undefined)).toBe('Not scheduled');
  });

  test('returns "Overdue" for past timestamp', () => {
    expect(Helpers.formatCountdown(Date.now() - 1000)).toBe('Overdue');
  });

  test('returns minutes format for <60 minutes away', () => {
    const ts = Date.now() + 5 * 60 * 1000 + 500; // 5 minutes from now + buffer for Date.now drift
    expect(Helpers.formatCountdown(ts)).toBe('5m away');
  });

  test('returns hours+minutes format for <24 hours away', () => {
    const ts = Date.now() + 2 * 3600000 + 30 * 60000; // 2h 30m
    const result = Helpers.formatCountdown(ts);
    expect(result).toContain('h');
    expect(result).toContain('m away');
  });

  test('returns days+hours format for <7 days away', () => {
    const ts = Date.now() + 3 * 86400000 + 4 * 3600000; // 3d 4h
    const result = Helpers.formatCountdown(ts);
    expect(result).toContain('d');
    expect(result).toContain('h away');
  });

  test('returns formatted date for >7 days away', () => {
    const ts = Date.now() + 10 * 86400000;
    const result = Helpers.formatCountdown(ts);
    expect(result).not.toContain('away');
  });

  test('handles 0 diff as Overdue', () => {
    expect(Helpers.formatCountdown(Date.now())).toBe('Overdue');
  });
});

describe('Helpers.relativeTime', () => {
  test('returns "Never" for falsy timestamp', () => {
    expect(Helpers.relativeTime(0)).toBe('Never');
    expect(Helpers.relativeTime(null)).toBe('Never');
    expect(Helpers.relativeTime(undefined)).toBe('Never');
  });

  test('returns "Just now" for <1 minute ago', () => {
    expect(Helpers.relativeTime(Date.now())).toBe('Just now');
    expect(Helpers.relativeTime(Date.now() - 30000)).toBe('Just now');
  });

  test('returns minutes format for <60 minutes ago', () => {
    expect(Helpers.relativeTime(Date.now() - 5 * 60000)).toBe('5m ago');
  });

  test('returns hours format for <24 hours ago', () => {
    expect(Helpers.relativeTime(Date.now() - 3 * 3600000)).toBe('3h ago');
  });

  test('returns days format for <30 days ago', () => {
    expect(Helpers.relativeTime(Date.now() - 5 * 86400000)).toBe('5d ago');
  });

  test('returns formatted date for >30 days ago', () => {
    const ts = Date.now() - 60 * 86400000;
    const result = Helpers.relativeTime(ts);
    expect(result).not.toContain('ago');
  });
});

describe('Helpers.formatDuration', () => {
  test('returns empty string for missing timestamps', () => {
    expect(Helpers.formatDuration(0, 0)).toBe('');
    expect(Helpers.formatDuration(null, null)).toBe('');
    expect(Helpers.formatDuration(1000, null)).toBe('');
    expect(Helpers.formatDuration(null, 2000)).toBe('');
  });

  test('returns seconds format for <1 minute', () => {
    const start = Date.now() - 45000;
    const end = Date.now();
    expect(Helpers.formatDuration(start, end)).toBe('45s');
  });

  test('returns minutes+seconds format for <60 minutes', () => {
    const start = Date.now() - 125000; // 2m 5s
    const end = Date.now();
    expect(Helpers.formatDuration(start, end)).toBe('2m 5s');
  });

  test('returns hours+minutes format for >=60 minutes', () => {
    const start = Date.now() - 3725000; // 1h 2m 5s
    const end = Date.now();
    expect(Helpers.formatDuration(start, end)).toBe('1h 2m');
  });

  test('handles 0 duration', () => {
    const ts = Date.now();
    expect(Helpers.formatDuration(ts, ts)).toBe('0s');
  });

  test('handles negative duration (end before start)', () => {
    const start = Date.now();
    const end = Date.now() - 5000;
    // formatDuration returns "-5s" for negative duration
    expect(Helpers.formatDuration(start, end)).toBe('-5s');
  });

  test('handles very large durations', () => {
    const start = Date.now() - 999 * 86400000; // ~999 days
    const end = Date.now();
    const result = Helpers.formatDuration(start, end);
    // Should handle without crashing
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('handles single second precision', () => {
    const start = Date.now() - 1000;
    const end = Date.now();
    expect(Helpers.formatDuration(start, end)).toBe('1s');
  });

  test('rounds seconds correctly', () => {
    const start = Date.now() - 59999; // ~59.999s
    const end = Date.now();
    expect(Helpers.formatDuration(start, end)).toBe('59s');
  });
});

describe('Helpers.formatCountdown — edge cases', () => {
  test('handles exactly 7 days away', () => {
    const ts = Date.now() + 7 * 86400000;
    const result = Helpers.formatCountdown(ts);
    // Should show formatted date, not countdown
    expect(result).not.toContain('away');
  });

  test('handles exactly 24 hours away', () => {
    const ts = Date.now() + 24 * 3600000 + 100; // Add buffer for execution time
    const result = Helpers.formatCountdown(ts);
    // Should show days format
    expect(result).toContain('d');
  });

  test('handles exactly 60 minutes away', () => {
    const ts = Date.now() + 60 * 60000 + 100; // Add buffer for execution time
    const result = Helpers.formatCountdown(ts);
    // Should show hours format
    expect(result).toContain('h');
  });

  test('handles 1 minute away', () => {
    const ts = Date.now() + 60000 + 100; // Add buffer for execution time
    expect(Helpers.formatCountdown(ts)).toBe('1m away');
  });

  test('handles very far future timestamp', () => {
    const ts = Date.now() + 365 * 86400000; // 1 year
    const result = Helpers.formatCountdown(ts);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('Helpers.relativeTime — edge cases', () => {
  test('handles exactly 1 minute ago', () => {
    const ts = Date.now() - 60000 - 100; // Subtract buffer for execution time
    expect(Helpers.relativeTime(ts)).toBe('1m ago');
  });

  test('handles exactly 1 hour ago', () => {
    const ts = Date.now() - 3600000 - 100; // Subtract buffer for execution time
    expect(Helpers.relativeTime(ts)).toBe('1h ago');
  });

  test('handles exactly 1 day ago', () => {
    const ts = Date.now() - 86400000 - 100; // Subtract buffer for execution time
    expect(Helpers.relativeTime(ts)).toBe('1d ago');
  });

  test('handles exactly 30 days ago', () => {
    const ts = Date.now() - 30 * 86400000 - 100; // Subtract buffer for execution time
    const result = Helpers.relativeTime(ts);
    // Should be formatted date, not "30d ago"
    expect(result).not.toContain('ago');
  });

  test('handles very old timestamp', () => {
    const ts = Date.now() - 365 * 86400000; // 1 year ago
    const result = Helpers.relativeTime(ts);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('handles future timestamp', () => {
    const ts = Date.now() + 60000; // 1 minute in future
    const result = Helpers.relativeTime(ts);
    // Should still return something reasonable
    expect(typeof result).toBe('string');
  });
});

describe('global aliases', () => {
  test('window.formatCountdown is Helpers.formatCountdown', () => {
    expect(window.formatCountdown).toBe(Helpers.formatCountdown);
  });

  test('window.relativeTime is Helpers.relativeTime', () => {
    expect(window.relativeTime).toBe(Helpers.relativeTime);
  });

  test('window.formatDuration is Helpers.formatDuration', () => {
    expect(window.formatDuration).toBe(Helpers.formatDuration);
  });
});

describe('Helpers.getErrorMessage (lines 23-25)', () => {
  test('returns string directly when err is a string (line 23)', () => {
    expect(Helpers.getErrorMessage('something failed')).toBe('something failed');
    expect(Helpers.getErrorMessage('')).toBe('');
  });

  test('returns err.message when err is an Error object (line 24)', () => {
    expect(Helpers.getErrorMessage(new Error('oops'))).toBe('oops');
    expect(Helpers.getErrorMessage({ message: 'custom msg' })).toBe('custom msg');
  });

  test('returns String(err) for non-string non-Error value (line 25)', () => {
    expect(Helpers.getErrorMessage(42)).toBe('42');
    expect(Helpers.getErrorMessage(null)).toBe('');
    expect(Helpers.getErrorMessage(undefined)).toBe('');
  });
});
