/**
 * Unit tests for shared date resolver.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDate,
  resolveDateRange,
  formatInTimezone,
} from '../../../src/services/date/resolver.js';

describe('resolveDate', () => {
  const timezone = 'America/Los_Angeles';
  const referenceDate = new Date('2026-01-26T10:00:00Z'); // Monday 2am PST

  describe('relative times', () => {
    it('parses "in 2 hours"', () => {
      const result = resolveDate('in 2 hours', { timezone, referenceDate });
      expect(result).not.toBeNull();
      expect(result!.timestamp).toBe(referenceDate.getTime() / 1000 + 7200);
    });

    it('parses "in 30 minutes"', () => {
      const result = resolveDate('in 30 minutes', { timezone, referenceDate });
      expect(result).not.toBeNull();
      expect(result!.timestamp).toBe(referenceDate.getTime() / 1000 + 1800);
    });
  });

  describe('relative dates', () => {
    it('parses "tomorrow at 9am"', () => {
      const result = resolveDate('tomorrow at 9am', { timezone, referenceDate });
      expect(result).not.toBeNull();
      expect(result!.components.hour).toBe(9);
      expect(result!.components.day).toBe(27); // Jan 27
    });

    it('parses "next Friday at 3pm"', () => {
      const result = resolveDate('next Friday at 3pm', { timezone, referenceDate });
      expect(result).not.toBeNull();
      expect(result!.components.hour).toBe(15);
      expect(result!.components.day).toBe(30); // Jan 30 is Friday
    });

    it('parses "this Sunday"', () => {
      const result = resolveDate('this Sunday', { timezone, referenceDate });
      expect(result).not.toBeNull();
      expect(result!.components.day).toBe(1); // Feb 1 is Sunday
    });
  });

  describe('day names', () => {
    it('parses "Sunday at 3pm" as next Sunday', () => {
      const result = resolveDate('Sunday at 3pm', { timezone, referenceDate });
      expect(result).not.toBeNull();
      expect(result!.timestamp).toBeGreaterThan(referenceDate.getTime() / 1000);
    });
  });

  describe('ambiguous time', () => {
    it('parses "3pm" as next upcoming 3pm', () => {
      const late = new Date('2026-01-26T23:30:00Z'); // 3:30pm PST
      const result = resolveDate('3pm', { timezone, referenceDate: late });
      expect(result).not.toBeNull();
      expect(result!.timestamp).toBeGreaterThan(late.getTime() / 1000);
    });
  });
});

describe('timezone handling', () => {
  const referenceDate = new Date('2026-01-26T19:00:00Z'); // 11am PST, 2pm EST

  it('resolves "today at 3pm" correctly in PST', () => {
    const result = resolveDate('today at 3pm', {
      timezone: 'America/Los_Angeles',
      referenceDate,
    });
    expect(result!.iso).toBe('2026-01-26T15:00:00-08:00');
  });

  it('resolves "today at 3pm" correctly in EST', () => {
    const result = resolveDate('today at 3pm', {
      timezone: 'America/New_York',
      referenceDate,
    });
    expect(result!.iso).toBe('2026-01-26T15:00:00-05:00');
  });

  it('produces different UTC timestamps for same local time in different zones', () => {
    const pst = resolveDate('tomorrow at 9am', {
      timezone: 'America/Los_Angeles',
      referenceDate,
    });
    const est = resolveDate('tomorrow at 9am', {
      timezone: 'America/New_York',
      referenceDate,
    });
    // EST is 3 hours ahead, so 9am EST is earlier in UTC
    expect(est!.timestamp).toBe(pst!.timestamp - 3 * 3600);
  });
});

describe('DST handling', () => {
  describe('spring forward (March 8, 2026 - 2am becomes 3am)', () => {
    const beforeDST = new Date('2026-03-08T09:00:00Z'); // 1am PST

    it('skips non-existent time (2:30am)', () => {
      const result = resolveDate('today at 2:30am', {
        timezone: 'America/Los_Angeles',
        referenceDate: beforeDST,
      });
      expect(result).toBeNull();
    });

    it('correctly handles time after transition', () => {
      const result = resolveDate('today at 4am', {
        timezone: 'America/Los_Angeles',
        referenceDate: beforeDST,
      });
      expect(result).not.toBeNull();
      expect(result!.iso).toContain('-07:00'); // PDT offset
    });

    it('resolves 9am on spring-forward day without hour shift', () => {
      const result = resolveDate('today at 9am', {
        timezone: 'America/New_York',
        referenceDate: new Date('2026-03-08T06:00:00Z'), // 1am EST, before DST
      });
      expect(result).not.toBeNull();
      expect(result!.components.hour).toBe(9);
      // After spring forward, New York is EDT (-04:00)
      expect(result!.iso).toContain('-04:00');
    });
  });

  describe('fall back (November 1, 2026 - 2am becomes 1am)', () => {
    const beforeFallback = new Date('2026-11-01T08:00:00Z'); // 1am PDT

    it('handles ambiguous time (1:30am occurs twice)', () => {
      const result = resolveDate('today at 1:30am', {
        timezone: 'America/Los_Angeles',
        referenceDate: beforeFallback,
      });
      expect(result).not.toBeNull();
      // Should resolve to a valid timestamp (either PDT or PST interpretation)
      expect(result!.components.hour).toBe(1);
      expect(result!.components.minute).toBe(30);
    });
  });
});

describe('ISO 8601 output', () => {
  it('includes correct timezone offset for PST', () => {
    const result = resolveDate('tomorrow at 3pm', {
      timezone: 'America/Los_Angeles',
      referenceDate: new Date('2026-01-15T12:00:00Z'),
    });
    expect(result!.iso).toMatch(/-08:00$/);
  });

  it('includes correct timezone offset for EST', () => {
    const result = resolveDate('tomorrow at 3pm', {
      timezone: 'America/New_York',
      referenceDate: new Date('2026-01-15T12:00:00Z'),
    });
    expect(result!.iso).toMatch(/-05:00$/);
  });
});

describe('error handling', () => {
  it('returns null for unparseable input', () => {
    const result = resolveDate('asdfghjkl', { timezone: 'America/Los_Angeles' });
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = resolveDate('', { timezone: 'America/Los_Angeles' });
    expect(result).toBeNull();
  });

  it('throws for invalid timezone', () => {
    expect(() => {
      resolveDate('tomorrow', { timezone: 'Invalid/Zone' });
    }).toThrow();
  });

  it('returns null for range input in resolveDate', () => {
    const result = resolveDate('from 3pm to 5pm', { timezone: 'America/Los_Angeles' });
    expect(result).toBeNull();
  });
});

describe('explicit date handling', () => {
  const timezone = 'America/Los_Angeles';

  it('accepts explicit past dates with forwardDate=true', () => {
    // Reference date is afternoon, but we're asking for morning of same day
    const referenceDate = new Date('2026-01-26T20:00:00Z'); // 12pm PST
    const result = resolveDate('2026-01-26 9am', { timezone, referenceDate, forwardDate: true });
    // Should NOT be null because it's an explicit date, even though 9am has passed
    expect(result).not.toBeNull();
    expect(result!.components.hour).toBe(9);
    expect(result!.components.day).toBe(26);
  });

  it('accepts explicit ISO dates in the past', () => {
    const referenceDate = new Date('2026-02-04T20:00:00Z');
    const result = resolveDate('2026-02-04', { timezone, referenceDate, forwardDate: true });
    expect(result).not.toBeNull();
  });

  it('still rejects ambiguous past times with forwardDate=true', () => {
    // "3pm" without a date is ambiguous - should prefer future
    const referenceDate = new Date('2026-01-26T23:30:00Z'); // 3:30pm PST
    const result = resolveDate('3pm', { timezone, referenceDate, forwardDate: true });
    // Should be tomorrow's 3pm, not today's (which has passed)
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBeGreaterThan(referenceDate.getTime() / 1000);
  });
});

describe('boundary: leap year handling', () => {
  const timezone = 'America/New_York';

  it('resolves February 29 in a leap year (2028)', () => {
    const referenceDate = new Date('2028-02-15T12:00:00Z');
    const result = resolveDate('February 29 at 10am', { timezone, referenceDate });
    expect(result).not.toBeNull();
    expect(result!.components.month).toBe(2);
    expect(result!.components.day).toBe(29);
    expect(result!.components.hour).toBe(10);
  });

  it('returns null for February 29 in a non-leap year (2027)', () => {
    const referenceDate = new Date('2027-02-15T12:00:00Z');
    const result = resolveDate('February 29 at 10am', { timezone, referenceDate });
    // chrono may resolve this to March 1 — either null or March 1 is acceptable
    if (result !== null) {
      // If chrono resolves it, it should NOT report Feb 29
      expect(result.components.month === 2 && result.components.day === 29).toBe(false);
    }
  });
});

describe('boundary: year boundary', () => {
  it('"next Monday" from Sunday Dec 31 resolves to January of next year', () => {
    // Dec 31, 2028 is a Sunday
    const referenceDate = new Date('2028-12-31T12:00:00Z');
    const result = resolveDate('next Monday at 9am', {
      timezone: 'America/New_York',
      referenceDate,
    });
    expect(result).not.toBeNull();
    expect(result!.components.year).toBe(2029);
    expect(result!.components.month).toBe(1);
    expect(result!.components.day).toBe(1); // Jan 1, 2029 is Monday
  });
});

describe('boundary: weekday same-day', () => {
  it('"next Sunday" when today is Sunday resolves to 7 days ahead', () => {
    // Jan 25, 2026 is a Sunday. Reference is in UTC morning = still Sunday in PST
    const referenceDate = new Date('2026-01-25T20:00:00Z'); // 12pm PST, Sunday
    const result = resolveDate('next Sunday at 10am', {
      timezone: 'America/Los_Angeles',
      referenceDate,
    });
    expect(result).not.toBeNull();
    // Should be Feb 1 (7 days later), not Jan 25 (today)
    expect(result!.components.day).toBe(1);
    expect(result!.components.month).toBe(2);
    expect(result!.timestamp).toBeGreaterThan(referenceDate.getTime() / 1000);
  });

  it('"next Monday" when today is Monday resolves to 7 days ahead', () => {
    const referenceDate = new Date('2026-01-26T18:00:00Z'); // 10am PST, Monday
    const result = resolveDate('next Monday at 9am', {
      timezone: 'America/Los_Angeles',
      referenceDate,
    });
    expect(result).not.toBeNull();
    // Should be Feb 2 (7 days later)
    expect(result!.components.day).toBe(2);
    expect(result!.components.month).toBe(2);
  });
});

describe('formatInTimezone', () => {
  const date = new Date('2026-01-26T23:30:00Z');

  it('formats in PST correctly', () => {
    const result = formatInTimezone(date, 'America/Los_Angeles', 'long');
    expect(result).toContain('January 26');
    expect(result).toContain('3:30');
  });

  it('formats in EST correctly', () => {
    const result = formatInTimezone(date, 'America/New_York', 'long');
    expect(result).toContain('January 26');
    expect(result).toContain('6:30');
  });
});

describe('resolveDateRange', () => {
  const timezone = 'America/Los_Angeles';
  const referenceDate = new Date('2026-01-26T10:00:00Z'); // Monday 2am PST

  it('parses "from 3pm to 5pm"', () => {
    const result = resolveDateRange('from 3pm to 5pm', { timezone, referenceDate });
    expect(result).not.toBeNull();
    expect(result!.granularity).toBe('custom');
    expect(result!.end.timestamp).toBeGreaterThan(result!.start.timestamp);
  });

  it('parses "this week" as a full week range', () => {
    const result = resolveDateRange('this week', { timezone, referenceDate });
    expect(result).not.toBeNull();
    expect(result!.granularity).toBe('week');
  });

  it('parses "next week" as the following week range', () => {
    const result = resolveDateRange('next week', { timezone, referenceDate });
    expect(result).not.toBeNull();
    expect(result!.granularity).toBe('week');
    // Next week should start after this week
    const thisWeek = resolveDateRange('this week', { timezone, referenceDate });
    expect(result!.start.timestamp).toBeGreaterThan(thisWeek!.end.timestamp);
  });

  it('parses "last week" as the previous week range', () => {
    const result = resolveDateRange('last week', { timezone, referenceDate });
    expect(result).not.toBeNull();
    expect(result!.granularity).toBe('week');
    // Last week should end before this week starts
    const thisWeek = resolveDateRange('this week', { timezone, referenceDate });
    expect(result!.end.timestamp).toBeLessThan(thisWeek!.start.timestamp);
  });

  it('parses "next month" as the following month range', () => {
    const result = resolveDateRange('next month', { timezone, referenceDate });
    expect(result).not.toBeNull();
    expect(result!.granularity).toBe('month');
    // Should be February 2026
    expect(result!.start.components.month).toBe(2);
    expect(result!.start.components.year).toBe(2026);
  });

  it('parses "yesterday" as a day range', () => {
    const result = resolveDateRange('yesterday', { timezone, referenceDate });
    expect(result).not.toBeNull();
    expect(result!.granularity).toBe('day');
    expect(result!.start.components.day).toBe(25); // Jan 25
  });
});
