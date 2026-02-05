/**
 * Unit tests for calendar tools.
 *
 * Focuses on date parsing behavior in get_calendar_events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/services/google/calendar.js', () => {
  class AuthRequiredError extends Error {}

  return {
    listEvents: vi.fn(async () => []),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    getEvent: vi.fn(),
    AuthRequiredError,
  };
});

import { getCalendarEvents } from '../../../src/tools/calendar.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { listEvents } from '../../../src/services/google/calendar.js';

describe('getCalendarEvents', () => {
  const baseContext: ToolContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
    userConfig: { name: 'Test', timezone: 'America/Los_Angeles' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Feb 4, 2026 8:33 PM PST
    vi.setSystemTime(new Date('2026-02-05T04:33:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles period start + period end when both dates are provided', async () => {
    const result = await getCalendarEvents.handler(
      { start_date: 'today', end_date: 'next week' },
      baseContext
    );

    expect(result.success).toBe(true);

    const listEventsMock = listEvents as unknown as ReturnType<typeof vi.fn>;
    expect(listEventsMock).toHaveBeenCalledTimes(1);

    const [, startDate, endDate] = listEventsMock.mock.calls[0] as [string, Date, Date];
    expect(startDate.toISOString()).toBe('2026-02-04T08:00:00.000Z');
    expect(endDate.toISOString()).toBe('2026-02-16T07:59:59.000Z');
  });

  it('uses a full period range when only start_date is a period phrase', async () => {
    const result = await getCalendarEvents.handler(
      { start_date: 'next week' },
      baseContext
    );

    expect(result.success).toBe(true);

    const listEventsMock = listEvents as unknown as ReturnType<typeof vi.fn>;
    const [, startDate, endDate] = listEventsMock.mock.calls[0] as [string, Date, Date];
    expect(startDate.toISOString()).toBe('2026-02-09T08:00:00.000Z');
    expect(endDate.toISOString()).toBe('2026-02-16T07:59:59.000Z');
  });

  it('returns a clear error when start date is unparseable', async () => {
    const result = await getCalendarEvents.handler(
      { start_date: 'not-a-date', end_date: 'next week' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not parse start date');
  });
});
