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
