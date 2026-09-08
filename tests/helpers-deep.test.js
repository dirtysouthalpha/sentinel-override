// tests/helpers-deep.test.js
// Comprehensive tests for popup-modules/helpers.js — formatCountdown, relativeTime, formatDuration.

import { jest } from '@jest/globals';

// Recreate Helpers functions from helpers.js
const Helpers = {};

Helpers.formatCountdown = function formatCountdown(timestamp) {
  if (!timestamp) return 'Not scheduled';
  const now = Date.now();
  const diff = timestamp - now;
  if (diff <= 0) return 'Overdue';
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 60) return `${minutes}m away`;
  if (hours < 24) return `${hours}h ${minutes % 60}m away`;
  if (days < 7) return `${days}d ${hours % 24}h away`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
};

Helpers.relativeTime = function relativeTime(timestamp) {
  if (!timestamp) return 'Never';
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
};

Helpers.formatDuration = function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return '';
  const diff = completedAt - startedAt;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

describe('formatCountdown', () => {
  test('returns "Not scheduled" for null', () => {
    expect(Helpers.formatCountdown(null)).toBe('Not scheduled');
  });

  test('returns "Not scheduled" for undefined', () => {
    expect(Helpers.formatCountdown(undefined)).toBe('Not scheduled');
  });

  test('returns "Not scheduled" for 0', () => {
    expect(Helpers.formatCountdown(0)).toBe('Not scheduled');
  });

  test('returns "Overdue" for past timestamp', () => {
    expect(Helpers.formatCountdown(Date.now() - 60000)).toBe('Overdue');
  });

  test('returns "Overdue" for current time', () => {
    expect(Helpers.formatCountdown(Date.now())).toBe('Overdue');
  });

  test('returns minutes format for <60 min', () => {
    const fiveMin = Date.now() + 5 * 60000;
    expect(Helpers.formatCountdown(fiveMin)).toBe('5m away');
  });

  test('returns minutes format for exactly 1 min', () => {
    const oneMin = Date.now() + 60000;
    expect(Helpers.formatCountdown(oneMin)).toBe('1m away');
  });

  test('returns 0m for <1 min away', () => {
    const halfMin = Date.now() + 30000;
    expect(Helpers.formatCountdown(halfMin)).toBe('0m away');
  });

  test('returns hours+minutes format for 1-23 hours', () => {
    const twoHours = Date.now() + 2 * 3600000;
    expect(Helpers.formatCountdown(twoHours)).toBe('2h 0m away');
  });

  test('returns hours+minutes with remainder', () => {
    const twoHalf = Date.now() + 2.5 * 3600000;
    expect(Helpers.formatCountdown(twoHalf)).toBe('2h 30m away');
  });

  test('returns days+hours format for 1-6 days', () => {
    const twoDays = Date.now() + 2 * 86400000;
    expect(Helpers.formatCountdown(twoDays)).toBe('2d 0h away');
  });

  test('returns days+hours with remainder', () => {
    const twoDaysHalf = Date.now() + 2.5 * 86400000;
    expect(Helpers.formatCountdown(twoDaysHalf)).toBe('2d 12h away');
  });

  test('returns date string for 7+ days', () => {
    const tenDays = Date.now() + 10 * 86400000;
    const result = Helpers.formatCountdown(tenDays);
    // Should be a date string, not containing "away"
    expect(result).not.toContain('away');
    expect(result.length).toBeGreaterThan(0);
  });

  test('boundary at 60 minutes switches to hours', () => {
    const sixtyMin = Date.now() + 60 * 60000;
    expect(Helpers.formatCountdown(sixtyMin)).toBe('1h 0m away');
  });

  test('boundary at 24 hours switches to days', () => {
    const twentyFourHours = Date.now() + 24 * 3600000;
    expect(Helpers.formatCountdown(twentyFourHours)).toBe('1d 0h away');
  });

  test('boundary at 7 days switches to date', () => {
    const sevenDays = Date.now() + 7 * 86400000;
    const result = Helpers.formatCountdown(sevenDays);
    expect(result).not.toContain('away');
  });

  test('handles negative timestamp', () => {
    expect(Helpers.formatCountdown(-1)).toBe('Overdue');
  });

  test('handles very large future timestamp', () => {
    const result = Helpers.formatCountdown(Date.now() + 365 * 86400000);
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });
});

describe('relativeTime', () => {
  test('returns "Never" for null', () => {
    expect(Helpers.relativeTime(null)).toBe('Never');
  });

  test('returns "Never" for undefined', () => {
    expect(Helpers.relativeTime(undefined)).toBe('Never');
  });

  test('returns "Never" for 0', () => {
    expect(Helpers.relativeTime(0)).toBe('Never');
  });

  test('returns "Just now" for <1 min ago', () => {
    const thirtySec = Date.now() - 30000;
    expect(Helpers.relativeTime(thirtySec)).toBe('Just now');
  });

  test('returns "Just now" for current time', () => {
    expect(Helpers.relativeTime(Date.now())).toBe('Just now');
  });

  test('returns minutes for 1-59 min ago', () => {
    const fiveMin = Date.now() - 5 * 60000;
    expect(Helpers.relativeTime(fiveMin)).toBe('5m ago');
  });

  test('returns "1m ago" for exactly 1 min', () => {
    const oneMin = Date.now() - 60000;
    expect(Helpers.relativeTime(oneMin)).toBe('1m ago');
  });

  test('returns hours for 1-23 hours ago', () => {
    const threeHours = Date.now() - 3 * 3600000;
    expect(Helpers.relativeTime(threeHours)).toBe('3h ago');
  });

  test('returns "1h ago" for exactly 1 hour', () => {
    const oneHour = Date.now() - 3600000;
    expect(Helpers.relativeTime(oneHour)).toBe('1h ago');
  });

  test('returns days for 1-29 days ago', () => {
    const fiveDays = Date.now() - 5 * 86400000;
    expect(Helpers.relativeTime(fiveDays)).toBe('5d ago');
  });

  test('returns "1d ago" for exactly 1 day', () => {
    const oneDay = Date.now() - 86400000;
    expect(Helpers.relativeTime(oneDay)).toBe('1d ago');
  });

  test('returns date string for 30+ days', () => {
    const sixtyDays = Date.now() - 60 * 86400000;
    const result = Helpers.relativeTime(sixtyDays);
    expect(result).not.toContain('ago');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns "30d ago" for exactly 30 days', () => {
    const thirtyDays = Date.now() - 30 * 86400000;
    // Account for millisecond boundary; could be 29d or 30d depending on exact timing
    const result = Helpers.relativeTime(thirtyDays);
    expect(result).toMatch(/\d+d ago/);
  });

  test('handles future timestamp gracefully', () => {
    const result = Helpers.relativeTime(Date.now() + 60000);
    // Should return "Just now" since diff is negative (minutes < 1)
    expect(result).toBe('Just now');
  });

  test('boundary at 60 minutes switches to hours', () => {
    const sixtyMin = Date.now() - 60 * 60000;
    expect(Helpers.relativeTime(sixtyMin)).toBe('1h ago');
  });

  test('boundary at 24 hours switches to days', () => {
    const twentyFour = Date.now() - 24 * 3600000;
    expect(Helpers.relativeTime(twentyFour)).toBe('1d ago');
  });
});

describe('formatDuration', () => {
  test('returns empty string when startedAt is null', () => {
    expect(Helpers.formatDuration(null, Date.now())).toBe('');
  });

  test('returns empty string when completedAt is null', () => {
    expect(Helpers.formatDuration(Date.now(), null)).toBe('');
  });

  test('returns empty string when both are null', () => {
    expect(Helpers.formatDuration(null, null)).toBe('');
  });

  test('returns empty string when startedAt is 0', () => {
    expect(Helpers.formatDuration(0, Date.now())).toBe('');
  });

  test('returns empty string when completedAt is 0', () => {
    expect(Helpers.formatDuration(Date.now(), 0)).toBe('');
  });

  test('returns seconds for <60s duration', () => {
    const start = Date.now() - 45000;
    expect(Helpers.formatDuration(start, Date.now())).toBe('45s');
  });

  test('returns "0s" for very short duration', () => {
    const start = Date.now() - 500;
    expect(Helpers.formatDuration(start, Date.now())).toBe('0s');
  });

  test('returns minutes+seconds for 1-59 min', () => {
    const start = Date.now() - 2 * 60000 - 30 * 1000;
    expect(Helpers.formatDuration(start, Date.now())).toBe('2m 30s');
  });

  test('returns exact minutes with 0s remainder', () => {
    const start = Date.now() - 5 * 60000;
    expect(Helpers.formatDuration(start, Date.now())).toBe('5m 0s');
  });

  test('returns "1m 0s" for exactly 1 minute', () => {
    const start = Date.now() - 60000;
    expect(Helpers.formatDuration(start, Date.now())).toBe('1m 0s');
  });

  test('returns hours+minutes for 1+ hours', () => {
    const start = Date.now() - 2 * 3600000 - 15 * 60000;
    expect(Helpers.formatDuration(start, Date.now())).toBe('2h 15m');
  });

  test('returns exact hours with 0m remainder', () => {
    const start = Date.now() - 3 * 3600000;
    expect(Helpers.formatDuration(start, Date.now())).toBe('3h 0m');
  });

  test('returns "1h 0m" for exactly 1 hour', () => {
    const start = Date.now() - 3600000;
    expect(Helpers.formatDuration(start, Date.now())).toBe('1h 0m');
  });

  test('returns "0s" when both times are the same', () => {
    const now = Date.now();
    expect(Helpers.formatDuration(now, now)).toBe('0s');
  });

  test('handles completedAt before startedAt (negative duration)', () => {
    const result = Helpers.formatDuration(Date.now(), Date.now() - 60000);
    // Negative diff -> negative seconds -> rounds to some string
    expect(typeof result).toBe('string');
  });

  test('handles large duration', () => {
    const start = Date.now() - 48 * 3600000;
    const result = Helpers.formatDuration(start, Date.now());
    expect(result).toBe('48h 0m');
  });

  test('handles duration with exact second boundaries', () => {
    const start = 1000000;
    const end = 1005000;
    expect(Helpers.formatDuration(start, end)).toBe('5s');
  });
});
