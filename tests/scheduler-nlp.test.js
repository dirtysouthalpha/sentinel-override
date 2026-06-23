import { jest } from '@jest/globals';
import { parseNaturalLanguageSchedule, formatSchedulePreview } from '../background/scheduler-nlp.js';

describe('scheduler-nlp', () => {
  describe('parseNaturalLanguageSchedule — Daily schedules', () => {
    test('parses "every morning at 8am" as daily at 08:00', () => {
      const result = parseNaturalLanguageSchedule('Check SonicWall every morning at 8am');
      expect(result.schedule.type).toBe('recurring');
      expect(result.schedule.recurrence.interval).toBe('daily');
      expect(result.schedule.recurrence.time).toBe('08:00');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    test('parses "8:00am" format', () => {
      const result = parseNaturalLanguageSchedule('Check status every day at 8:00am');
      expect(result.schedule.recurrence.time).toBe('08:00');
      expect(result.schedule.recurrence.interval).toBe('daily');
    });

    test('parses 24-hour format "08:00"', () => {
      const result = parseNaturalLanguageSchedule('Check status every day at 08:00');
      expect(result.schedule.recurrence.time).toBe('08:00');
    });

    test('parses "3pm" as 15:00', () => {
      const result = parseNaturalLanguageSchedule('Verify backups daily at 3pm');
      expect(result.schedule.recurrence.time).toBe('15:00');
      expect(result.schedule.recurrence.interval).toBe('daily');
    });

    test('parses 24-hour format "15:00"', () => {
      const result = parseNaturalLanguageSchedule('Verify backups daily at 15:00');
      expect(result.schedule.recurrence.time).toBe('15:00');
    });

    test('parses "daily" keyword', () => {
      const result = parseNaturalLanguageSchedule('Run health check daily at 09:00');
      expect(result.schedule.recurrence.interval).toBe('daily');
      expect(result.schedule.recurrence.time).toBe('09:00');
    });

    test('parses "every day" keyword', () => {
      const result = parseNaturalLanguageSchedule('Check logs every day at 6pm');
      expect(result.schedule.recurrence.interval).toBe('daily');
      expect(result.schedule.recurrence.time).toBe('18:00');
    });

    test('parses "every evening" as daily', () => {
      const result = parseNaturalLanguageSchedule('Run report every evening at 5pm');
      expect(result.schedule.recurrence.interval).toBe('daily');
      expect(result.schedule.recurrence.time).toBe('17:00');
    });
  });

  describe('parseNaturalLanguageSchedule — Weekly schedules', () => {
    test('parses "every Monday" as weekly on Monday (day 1)', () => {
      const result = parseNaturalLanguageSchedule('Check backups every Monday at 10am');
      expect(result.schedule.type).toBe('recurring');
      expect(result.schedule.recurrence.interval).toBe('weekly');
      expect(result.schedule.recurrence.dayOfWeek).toBe(1);
      expect(result.schedule.recurrence.time).toBe('10:00');
    });

    test('parses "Tuesday" as day 2', () => {
      const result = parseNaturalLanguageSchedule('Run scan every Tuesday at 2pm');
      expect(result.schedule.recurrence.dayOfWeek).toBe(2);
      expect(result.schedule.recurrence.time).toBe('14:00');
    });

    test('parses "Friday" as day 5', () => {
      const result = parseNaturalLanguageSchedule('Submit report every Friday at 4pm');
      expect(result.schedule.recurrence.dayOfWeek).toBe(5);
    });

    test('parses "Sunday" as day 0', () => {
      const result = parseNaturalLanguageSchedule('Run cleanup every Sunday at 1am');
      expect(result.schedule.recurrence.dayOfWeek).toBe(0);
      expect(result.schedule.recurrence.time).toBe('01:00');
    });

    test('parses abbreviated day "Mon"', () => {
      const result = parseNaturalLanguageSchedule('Check status every Mon at 9am');
      expect(result.schedule.recurrence.dayOfWeek).toBe(1);
    });

    test('parses "weekly" generic keyword', () => {
      const result = parseNaturalLanguageSchedule('Run audit weekly at 10am');
      expect(result.schedule.recurrence.interval).toBe('weekly');
    });
  });

  describe('parseNaturalLanguageSchedule — Weekday schedules', () => {
    test('parses "every weekday" as Mon-Fri', () => {
      const result = parseNaturalLanguageSchedule('Run ticket triage every weekday at 9am');
      expect(result.schedule.recurrence.interval).toBe('weekly');
      expect(result.schedule.recurrence.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
      expect(result.schedule.recurrence.time).toBe('09:00');
    });

    test('parses "weekdays" as Mon-Fri', () => {
      const result = parseNaturalLanguageSchedule('Check email weekdays at 8am');
      expect(result.schedule.recurrence.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    test('parses "Mon-Fri" range', () => {
      const result = parseNaturalLanguageSchedule('Monitor system Mon-Fri at 7am');
      expect(result.schedule.recurrence.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    test('parses "Monday through Friday"', () => {
      const result = parseNaturalLanguageSchedule('Run checks Monday through Friday at 9am');
      expect(result.schedule.recurrence.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('parseNaturalLanguageSchedule — Monthly schedules', () => {
    test('parses "1st of every month" as monthly day 1', () => {
      const result = parseNaturalLanguageSchedule('Run security scan on the 1st of every month at 2pm');
      expect(result.schedule.type).toBe('recurring');
      expect(result.schedule.recurrence.interval).toBe('monthly');
      expect(result.schedule.recurrence.dayOfMonth).toBe(1);
      expect(result.schedule.recurrence.time).toBe('14:00');
    });

    test('parses "15th" ordinal', () => {
      const result = parseNaturalLanguageSchedule('Generate report on the 15th monthly at 10am');
      expect(result.schedule.recurrence.interval).toBe('monthly');
      expect(result.schedule.recurrence.dayOfMonth).toBe(15);
    });

    test('parses "monthly" keyword', () => {
      const result = parseNaturalLanguageSchedule('Run audit monthly at 9am');
      expect(result.schedule.recurrence.interval).toBe('monthly');
    });

    test('parses "last day of month" as day 31', () => {
      const result = parseNaturalLanguageSchedule('Backup data last day of month at 11pm');
      expect(result.schedule.recurrence.interval).toBe('monthly');
      expect(result.schedule.recurrence.dayOfMonth).toBe(31);
    });
  });

  describe('parseNaturalLanguageSchedule — One-time schedules', () => {
    test('parses "once at 3pm" as one-time', () => {
      const result = parseNaturalLanguageSchedule('Check email once at 3pm');
      expect(result.schedule.type).toBe('once');
      expect(result.schedule.runAt).toBeDefined();
      expect(typeof result.schedule.runAt).toBe('number');
    });

    test('parses "tomorrow at 3pm" as once', () => {
      const result = parseNaturalLanguageSchedule('Send report tomorrow at 3pm');
      expect(result.schedule.type).toBe('once');
      expect(result.schedule.runAt).toBeGreaterThan(Date.now());
    });

    test('parses "today at 5pm" as once', () => {
      const result = parseNaturalLanguageSchedule('Check status today at 5pm');
      expect(result.schedule.type).toBe('once');
    });

    test('one-time runAt is in the future', () => {
      const result = parseNaturalLanguageSchedule('Check email once at 3pm');
      expect(result.schedule.runAt).toBeGreaterThan(Date.now());
    });
  });

  describe('parseNaturalLanguageSchedule — Hourly schedules', () => {
    test('parses "every 2 hours" as hourly with 120 min period', () => {
      const result = parseNaturalLanguageSchedule('Check system every 2 hours');
      expect(result.schedule.type).toBe('recurring');
      expect(result.schedule.recurrence.interval).toBe('hourly');
      expect(result.schedule.recurrence.periodInMinutes).toBe(120);
    });

    test('parses "hourly" as 60 min', () => {
      const result = parseNaturalLanguageSchedule('Ping server hourly');
      expect(result.schedule.recurrence.interval).toBe('hourly');
      expect(result.schedule.recurrence.periodInMinutes).toBe(60);
    });
  });

  describe('parseNaturalLanguageSchedule — Goal extraction', () => {
    test('extracts goal from schedule sentence', () => {
      const result = parseNaturalLanguageSchedule('Check SonicWall firewall status every morning at 8am');
      expect(result.parsed.goal).toBeDefined();
      expect(result.parsed.goal.length).toBeGreaterThan(0);
      expect(result.parsed.goal).toMatch(/SonicWall/i);
    });

    test('goal removes time and frequency keywords', () => {
      const result = parseNaturalLanguageSchedule('Run ticket triage every weekday at 9am');
      expect(result.parsed.goal).not.toMatch(/every|weekday|9am|at\s+9/i);
      expect(result.parsed.goal).toMatch(/ticket/i);
    });

    test('goal preserves multi-word descriptions', () => {
      const result = parseNaturalLanguageSchedule('Check exchange database integrity every day at midnight');
      expect(result.parsed.goal).toMatch(/exchange|database|integrity/i);
    });
  });

  describe('parseNaturalLanguageSchedule — Name generation', () => {
    test('generates a name from goal', () => {
      const result = parseNaturalLanguageSchedule('Check SonicWall every morning at 8am');
      expect(result.schedule.name).toBeDefined();
      expect(result.schedule.name.length).toBeGreaterThan(2);
    });

    test('name uses Title Case', () => {
      const result = parseNaturalLanguageSchedule('check server health daily at 9am');
      expect(result.schedule.name).toMatch(/^[A-Z]/);
    });

    test('falls back to Scheduled Task for empty goal', () => {
      const result = parseNaturalLanguageSchedule('daily at 9am');
      expect(result.schedule.name).toBeDefined();
      expect(result.schedule.name.length).toBeGreaterThan(0);
    });
  });

  describe('parseNaturalLanguageSchedule — Edge cases', () => {
    test('handles empty input gracefully', () => {
      const result = parseNaturalLanguageSchedule('');
      expect(result.schedule).toBeNull();
      expect(result.error).toBeDefined();
    });

    test('handles null input', () => {
      const result = parseNaturalLanguageSchedule(null);
      expect(result.schedule).toBeNull();
      expect(result.error).toBeDefined();
    });

    test('handles undefined input', () => {
      const result = parseNaturalLanguageSchedule(undefined);
      expect(result.schedule).toBeNull();
    });

    test('handles whitespace-only input', () => {
      const result = parseNaturalLanguageSchedule('   ');
      expect(result.schedule).toBeNull();
    });

    test('handles missing time — defaults to 09:00', () => {
      const result = parseNaturalLanguageSchedule('Check logs daily');
      expect(result.schedule.recurrence.time).toBe('09:00');
    });

    test('handles missing frequency — defaults to daily', () => {
      const result = parseNaturalLanguageSchedule('Check server health at 9am');
      expect(result.schedule.recurrence.interval).toBe('daily');
    });

    test('produces alternatives for low confidence input', () => {
      const result = parseNaturalLanguageSchedule('check');
      // Very short input, no time, no frequency — should have alternatives
      if (result.confidence < 0.7) {
        expect(result.alternatives).toBeDefined();
        expect(Array.isArray(result.alternatives)).toBe(true);
      }
    });

    test('confidence is between 0 and 1', () => {
      const result = parseNaturalLanguageSchedule('Check logs daily at 9am');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    test('cleans internal fields from output schedule', () => {
      const result = parseNaturalLanguageSchedule('Check logs daily at 9am');
      expect(result.schedule._time).toBeUndefined();
      expect(result.schedule._timeFound).toBeUndefined();
      expect(result.schedule._frequencyFound).toBeUndefined();
    });

    test('handles non-string input', () => {
      const result = parseNaturalLanguageSchedule(42);
      expect(result.schedule).toBeNull();
      expect(result.error).toBeDefined();
    });
  });

  describe('parseNaturalLanguageSchedule — PM conversion', () => {
    test('12pm stays as 12:00', () => {
      const result = parseNaturalLanguageSchedule('Lunch check daily at 12pm');
      expect(result.schedule.recurrence.time).toBe('12:00');
    });

    test('12am converts to 00:00', () => {
      const result = parseNaturalLanguageSchedule('Midnight scan daily at 12am');
      expect(result.schedule.recurrence.time).toBe('00:00');
    });

    test('5pm converts to 17:00', () => {
      const result = parseNaturalLanguageSchedule('End of day check at 5pm daily');
      expect(result.schedule.recurrence.time).toBe('17:00');
    });

    test('11pm converts to 23:00', () => {
      const result = parseNaturalLanguageSchedule('Nightly backup at 11pm daily');
      expect(result.schedule.recurrence.time).toBe('23:00');
    });
  });

  describe('formatSchedulePreview', () => {
    test('formats daily schedule', () => {
      const schedule = {
        type: 'recurring',
        recurrence: { interval: 'daily', time: '08:00' },
        goal: 'Check logs',
      };
      const preview = formatSchedulePreview(schedule);
      expect(preview).toContain('Daily');
      expect(preview).toContain('08:00');
      expect(preview).toContain('Check logs');
      expect(preview).toContain('📅');
    });

    test('formats weekly schedule', () => {
      const schedule = {
        type: 'recurring',
        recurrence: { interval: 'weekly', time: '10:00', dayOfWeek: 1, daysOfWeek: [1] },
        goal: 'Backups',
      };
      const preview = formatSchedulePreview(schedule);
      expect(preview).toContain('Weekly');
      expect(preview).toContain('Mon');
    });

    test('formats weekdays schedule', () => {
      const schedule = {
        type: 'recurring',
        recurrence: { interval: 'weekly', time: '09:00', daysOfWeek: [1, 2, 3, 4, 5] },
        goal: 'Triage',
      };
      const preview = formatSchedulePreview(schedule);
      expect(preview).toContain('Mon');
      expect(preview).toContain('Fri');
    });

    test('formats monthly schedule', () => {
      const schedule = {
        type: 'recurring',
        recurrence: { interval: 'monthly', time: '14:00', dayOfMonth: 1 },
        goal: 'Security scan',
      };
      const preview = formatSchedulePreview(schedule);
      expect(preview).toContain('Monthly');
      expect(preview).toContain('1st');
    });

    test('formats once schedule', () => {
      const schedule = {
        type: 'once',
        runAt: Date.now() + 86400000,
        goal: 'Email check',
      };
      const preview = formatSchedulePreview(schedule);
      expect(preview).toContain('Once');
    });

    test('handles null schedule', () => {
      expect(formatSchedulePreview(null)).toBe('');
    });

    test('formats hourly schedule', () => {
      const schedule = {
        type: 'recurring',
        recurrence: { interval: 'hourly', periodInMinutes: 120, time: '09:00' },
        goal: 'Ping',
      };
      const preview = formatSchedulePreview(schedule);
      expect(preview).toContain('120');
    });
  });
});
