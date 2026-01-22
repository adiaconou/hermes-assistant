/**
 * Unit tests for schedule parser (NL to cron conversion and one-time reminders).
 */

import { describe, it, expect } from 'vitest';
import {
  parseScheduleToCron,
  parseSchedule,
  parseReminderTime,
  isValidCron,
  cronToHuman,
} from '../../../src/services/scheduler/parser.js';

describe('parseScheduleToCron', () => {
  describe('happy paths', () => {
    it('parses "daily at 9am" to "0 9 * * *"', () => {
      expect(parseScheduleToCron('daily at 9am')).toBe('0 9 * * *');
    });

    it('parses "every day at 9:30am" to "30 9 * * *"', () => {
      expect(parseScheduleToCron('every day at 9:30am')).toBe('30 9 * * *');
    });

    it('parses "every weekday at 8am" to "0 8 * * 1-5"', () => {
      expect(parseScheduleToCron('every weekday at 8am')).toBe('0 8 * * 1-5');
    });

    it('parses "every monday at noon" to "0 12 * * 1"', () => {
      expect(parseScheduleToCron('every monday at noon')).toBe('0 12 * * 1');
    });

    it('parses "every hour" to "0 * * * *"', () => {
      expect(parseScheduleToCron('every hour')).toBe('0 * * * *');
    });

    it('parses "hourly" to "0 * * * *"', () => {
      expect(parseScheduleToCron('hourly')).toBe('0 * * * *');
    });

    it('parses "every 30 minutes" to "*/30 * * * *"', () => {
      expect(parseScheduleToCron('every 30 minutes')).toBe('*/30 * * * *');
    });

    it('parses "every weekend at 10am" to "0 10 * * 0,6"', () => {
      expect(parseScheduleToCron('every weekend at 10am')).toBe('0 10 * * 0,6');
    });

    it('parses "every friday at 5pm" to "0 17 * * 5"', () => {
      expect(parseScheduleToCron('every friday at 5pm')).toBe('0 17 * * 5');
    });
  });

  describe('failure cases', () => {
    it('returns null for unparseable input like "banana"', () => {
      expect(parseScheduleToCron('banana')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseScheduleToCron('')).toBeNull();
    });

    it('returns null for null/undefined input', () => {
      expect(parseScheduleToCron(null as unknown as string)).toBeNull();
      expect(parseScheduleToCron(undefined as unknown as string)).toBeNull();
    });
  });
});

describe('isValidCron', () => {
  it('returns true for valid cron expressions', () => {
    expect(isValidCron('0 9 * * *')).toBe(true);
    expect(isValidCron('*/30 * * * *')).toBe(true);
    expect(isValidCron('0 8 * * 1-5')).toBe(true);
  });

  it('returns false for invalid expressions', () => {
    expect(isValidCron('')).toBe(false);
    expect(isValidCron('invalid')).toBe(false);
    expect(isValidCron('0 9 * *')).toBe(false); // Missing field
    expect(isValidCron(null as unknown as string)).toBe(false);
  });
});

describe('cronToHuman', () => {
  it('converts "0 9 * * *" to "daily at 9 AM"', () => {
    expect(cronToHuman('0 9 * * *')).toBe('daily at 9 AM');
  });

  it('converts "30 8 * * *" to "daily at 8:30 AM"', () => {
    expect(cronToHuman('30 8 * * *')).toBe('daily at 8:30 AM');
  });

  it('converts "0 * * * *" to "every hour"', () => {
    expect(cronToHuman('0 * * * *')).toBe('every hour');
  });

  it('converts "*/30 * * * *" to "every 30 minutes"', () => {
    expect(cronToHuman('*/30 * * * *')).toBe('every 30 minutes');
  });

  it('converts "0 8 * * 1-5" to "weekdays at 8 AM"', () => {
    expect(cronToHuman('0 8 * * 1-5')).toBe('weekdays at 8 AM');
  });

  it('converts "0 12 * * 1" to "every Monday at 12 PM"', () => {
    expect(cronToHuman('0 12 * * 1')).toBe('every Monday at 12 PM');
  });
});

describe('parseSchedule', () => {
  const timezone = 'America/New_York';

  describe('recurring schedules', () => {
    it('detects "daily at 9am" as recurring', () => {
      const result = parseSchedule('daily at 9am', timezone);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('recurring');
      expect(result!.cronExpression).toBe('0 9 * * *');
    });

    it('detects "every weekday at 8am" as recurring', () => {
      const result = parseSchedule('every weekday at 8am', timezone);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('recurring');
      expect(result!.cronExpression).toBe('0 8 * * 1-5');
    });

    it('detects "every monday at noon" as recurring', () => {
      const result = parseSchedule('every monday at noon', timezone);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('recurring');
      expect(result!.cronExpression).toBe('0 12 * * 1');
    });

    it('detects "every 30 minutes" as recurring', () => {
      const result = parseSchedule('every 30 minutes', timezone);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('recurring');
      expect(result!.cronExpression).toBe('*/30 * * * *');
    });

    it('detects "hourly" as recurring', () => {
      const result = parseSchedule('hourly', timezone);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('recurring');
      expect(result!.cronExpression).toBe('0 * * * *');
    });
  });

  describe('one-time schedules', () => {
    it('detects "tomorrow at 9am" as one-time', () => {
      const result = parseSchedule('tomorrow at 9am', timezone);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('once');
      expect(result!.runAtTimestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('detects "in 2 hours" as one-time', () => {
      const result = parseSchedule('in 2 hours', timezone);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('once');
      expect(result!.runAtTimestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('detects "next friday at 3pm" as one-time', () => {
      const result = parseSchedule('next friday at 3pm', timezone);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('once');
      expect(result!.runAtTimestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('failure cases', () => {
    it('returns null for unparseable input', () => {
      expect(parseSchedule('banana', timezone)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseSchedule('', timezone)).toBeNull();
    });
  });
});

describe('parseReminderTime', () => {
  const timezone = 'America/New_York';

  it('parses "tomorrow at 9am" to a future timestamp', () => {
    const result = parseReminderTime('tomorrow at 9am', timezone);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('parses "in 1 hour" to approximately 1 hour from now', () => {
    const result = parseReminderTime('in 1 hour', timezone);
    expect(result).not.toBeNull();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const oneHourFromNow = nowSeconds + 3600;
    // Allow some tolerance (within 5 minutes)
    expect(result).toBeGreaterThan(nowSeconds + 3000);
    expect(result).toBeLessThan(oneHourFromNow + 300);
  });

  it('returns null for past times', () => {
    // "yesterday at 9am" should be in the past
    const result = parseReminderTime('yesterday at 9am', timezone);
    expect(result).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseReminderTime('banana', timezone)).toBeNull();
  });
});
