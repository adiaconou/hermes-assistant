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
  });

  describe('fall back (November 1, 2026 - 2am becomes 1am)', () => {
    const beforeFallback = new Date('2026-11-01T08:00:00Z'); // 1am PDT

    it('handles ambiguous time (1:30am occurs twice)', () => {
      const result = resolveDate('today at 1:30am', {
        timezone: 'America/Los_Angeles',
        referenceDate: beforeFallback,
      });
      expect(result).not.toBeNull();
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
});
