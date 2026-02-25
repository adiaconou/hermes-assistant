/**
 * Unit tests for calendar tools.
 *
 * Tests all five tool handlers: getCalendarEvents, createCalendarEvent,
 * updateCalendarEvent, deleteCalendarEvent, and resolveDateTool.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/domains/calendar/providers/google-calendar.js', () => {
  return {
    listEvents: vi.fn(async () => []),
    createEvent: vi.fn(async (_phone: string, title: string, start: Date, end: Date, location?: string) => ({
      id: 'new-event-id',
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      location,
    })),
    updateEvent: vi.fn(async (_phone: string, eventId: string, updates: Record<string, unknown>) => ({
      id: eventId,
      title: updates.title ?? 'Existing Title',
      start: updates.startTime ? (updates.startTime as Date).toISOString() : '2026-02-10T10:00:00.000Z',
      end: updates.endTime ? (updates.endTime as Date).toISOString() : '2026-02-10T11:00:00.000Z',
      location: updates.location,
    })),
    deleteEvent: vi.fn(async () => {}),
    getEvent: vi.fn(async () => ({
      start: { dateTime: '2026-02-10T10:00:00Z' },
      end: { dateTime: '2026-02-10T11:00:00Z' },
    })),
  };
});

vi.mock('../../../src/providers/auth.js', () => {
  class AuthRequiredError extends Error {
    phoneNumber: string;
    constructor(phone: string) {
      super(`Google authentication required for ${phone}`);
      this.name = 'AuthRequiredError';
      this.phoneNumber = phone;
    }
  }
  return {
    AuthRequiredError,
    generateAuthUrl: vi.fn(() => 'https://example.com/auth/google?state=test'),
  };
});

import {
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  resolveDateTool,
} from '../../../src/domains/calendar/runtime/tools.js';
import type { ToolContext } from '../../../src/tools/types.js';
import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getEvent,
} from '../../../src/domains/calendar/providers/google-calendar.js';
import { AuthRequiredError } from '../../../src/providers/auth.js';

const baseContext: ToolContext = {
  phoneNumber: '+1234567890',
  channel: 'sms',
  userConfig: { name: 'Test', timezone: 'America/Los_Angeles' },
  messageId: 'msg-123',
};

describe('getCalendarEvents', () => {
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

  // Boundary validation tests
  it('rejects empty start_date', async () => {
    const result = await getCalendarEvents.handler(
      { start_date: '' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('start_date must be a non-empty string');
  });

  it('rejects non-string start_date', async () => {
    const result = await getCalendarEvents.handler(
      { start_date: 123 as unknown as string },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('start_date must be a non-empty string');
  });

  it('rejects empty end_date', async () => {
    const result = await getCalendarEvents.handler(
      { start_date: 'today', end_date: '  ' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('end_date must be a non-empty string');
  });

  it('returns error when timezone not set', async () => {
    const result = await getCalendarEvents.handler(
      { start_date: 'today' },
      { ...baseContext, userConfig: { name: 'Test' } }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timezone not set');
  });

  it('returns friendly error on Google API 404', async () => {
    (listEvents as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('404 Not Found')
    );

    const result = await getCalendarEvents.handler(
      { start_date: 'today' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns auth_required on AuthRequiredError', async () => {
    (listEvents as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AuthRequiredError('+1234567890')
    );

    const result = await getCalendarEvents.handler(
      { start_date: 'today' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.auth_required).toBe(true);
    expect(result.auth_url).toBeDefined();
  });
});

describe('createCalendarEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-05T04:33:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates event with end_time', async () => {
    const result = await createCalendarEvent.handler(
      {
        title: 'Team Lunch',
        start_time: 'tomorrow at 12pm',
        end_time: 'tomorrow at 1pm',
      },
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.event).toBeDefined();
    const createEventMock = createEvent as unknown as ReturnType<typeof vi.fn>;
    expect(createEventMock).toHaveBeenCalledTimes(1);
  });

  it('creates event with duration_minutes', async () => {
    const result = await createCalendarEvent.handler(
      {
        title: 'Quick Call',
        start_time: 'tomorrow at 3pm',
        duration_minutes: 30,
      },
      baseContext
    );

    expect(result.success).toBe(true);
    const createEventMock = createEvent as unknown as ReturnType<typeof vi.fn>;
    expect(createEventMock).toHaveBeenCalledTimes(1);

    const [, , start, end] = createEventMock.mock.calls[0] as [string, string, Date, Date];
    expect(end.getTime() - start.getTime()).toBe(30 * 60 * 1000);
  });

  it('creates event with location', async () => {
    const result = await createCalendarEvent.handler(
      {
        title: 'Dinner',
        start_time: 'tomorrow at 7pm',
        duration_minutes: 60,
        location: 'Italian Restaurant',
      },
      baseContext
    );

    expect(result.success).toBe(true);
    const createEventMock = createEvent as unknown as ReturnType<typeof vi.fn>;
    expect(createEventMock).toHaveBeenCalledWith(
      '+1234567890',
      'Dinner',
      expect.any(Date),
      expect.any(Date),
      'Italian Restaurant'
    );
  });

  // Boundary validation
  it('rejects empty title', async () => {
    const result = await createCalendarEvent.handler(
      { title: '', start_time: 'tomorrow at 3pm', duration_minutes: 30 },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('title must be a non-empty string');
  });

  it('rejects non-string title', async () => {
    const result = await createCalendarEvent.handler(
      { title: 42 as unknown as string, start_time: 'tomorrow at 3pm', duration_minutes: 30 },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('title must be a non-empty string');
  });

  it('rejects empty start_time', async () => {
    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: '', duration_minutes: 30 },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('start_time must be a non-empty string');
  });

  it('rejects negative duration_minutes', async () => {
    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: 'tomorrow at 3pm', duration_minutes: -10 },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('duration_minutes must be a positive number');
  });

  it('rejects excessive duration_minutes', async () => {
    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: 'tomorrow at 3pm', duration_minutes: 999999 },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot exceed');
  });

  it('returns clear error when end_time cannot be parsed', async () => {
    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: 'tomorrow at 3pm', end_time: 'garbage' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not parse end time');
  });

  it('fails when neither end_time nor duration_minutes provided', async () => {
    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: 'tomorrow at 3pm' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('end_time or duration_minutes');
  });

  it('fails when start_time cannot be parsed', async () => {
    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: 'not-a-time', duration_minutes: 30 },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not parse start time');
  });

  it('returns error when timezone not set', async () => {
    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: 'tomorrow at 3pm', duration_minutes: 30 },
      { ...baseContext, userConfig: { name: 'Test' } }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Timezone not set');
  });

  it('returns auth_required on AuthRequiredError', async () => {
    (createEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AuthRequiredError('+1234567890')
    );

    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: 'tomorrow at 3pm', duration_minutes: 30 },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.auth_required).toBe(true);
  });

  it('returns friendly error on Google API failure', async () => {
    (createEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('403 Forbidden')
    );

    const result = await createCalendarEvent.handler(
      { title: 'Meeting', start_time: 'tomorrow at 3pm', duration_minutes: 30 },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });
});

describe('updateCalendarEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates event title', async () => {
    const result = await updateCalendarEvent.handler(
      { event_id: 'event-1', title: 'New Title' },
      baseContext
    );

    expect(result.success).toBe(true);
    const updateEventMock = updateEvent as unknown as ReturnType<typeof vi.fn>;
    expect(updateEventMock).toHaveBeenCalledWith(
      '+1234567890',
      'event-1',
      expect.objectContaining({ title: 'New Title' })
    );
  });

  it('updates event location', async () => {
    const result = await updateCalendarEvent.handler(
      { event_id: 'event-1', location: 'Room B' },
      baseContext
    );

    expect(result.success).toBe(true);
    const updateEventMock = updateEvent as unknown as ReturnType<typeof vi.fn>;
    expect(updateEventMock).toHaveBeenCalledWith(
      '+1234567890',
      'event-1',
      expect.objectContaining({ location: 'Room B' })
    );
  });

  it('updates timed event start and end', async () => {
    const result = await updateCalendarEvent.handler(
      {
        event_id: 'event-1',
        start_time: '2026-02-10T14:00:00Z',
        end_time: '2026-02-10T15:00:00Z',
      },
      baseContext
    );

    expect(result.success).toBe(true);
    const updateEventMock = updateEvent as unknown as ReturnType<typeof vi.fn>;
    expect(updateEventMock).toHaveBeenCalledWith(
      '+1234567890',
      'event-1',
      expect.objectContaining({
        startTime: expect.any(Date),
        endTime: expect.any(Date),
      })
    );
  });

  it('handles all-day event updates', async () => {
    (getEvent as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      start: { date: '2026-02-10' },
      end: { date: '2026-02-11' },
    });

    const result = await updateCalendarEvent.handler(
      {
        event_id: 'event-1',
        start_time: '2026-02-12',
        end_time: '2026-02-13',
      },
      baseContext
    );

    expect(result.success).toBe(true);
    const updateEventMock = updateEvent as unknown as ReturnType<typeof vi.fn>;
    const updates = updateEventMock.mock.calls[0][2];
    expect(updates.startDate).toBe('2026-02-12');
    expect(updates.endDate).toBe('2026-02-14'); // +1 day for Google all-day format
  });

  // Boundary validation
  it('rejects empty event_id', async () => {
    const result = await updateCalendarEvent.handler(
      { event_id: '' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('event_id must be a non-empty string');
  });

  it('rejects non-string event_id', async () => {
    const result = await updateCalendarEvent.handler(
      { event_id: 42 as unknown as string },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('event_id must be a non-empty string');
  });

  it('rejects update with no fields', async () => {
    const result = await updateCalendarEvent.handler(
      { event_id: 'event-1' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('at least one field');
  });

  it('returns auth_required on AuthRequiredError', async () => {
    (updateEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AuthRequiredError('+1234567890')
    );

    const result = await updateCalendarEvent.handler(
      { event_id: 'event-1', title: 'New' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.auth_required).toBe(true);
  });

  it('returns friendly error on 404', async () => {
    (updateEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('404 Not Found')
    );

    const result = await updateCalendarEvent.handler(
      { event_id: 'nonexistent', title: 'New' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('deleteCalendarEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes event successfully', async () => {
    const result = await deleteCalendarEvent.handler(
      { event_id: 'event-1' },
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.deleted).toBe('event-1');
    expect(deleteEvent).toHaveBeenCalledWith('+1234567890', 'event-1');
  });

  // Boundary validation
  it('rejects empty event_id', async () => {
    const result = await deleteCalendarEvent.handler(
      { event_id: '' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('event_id must be a non-empty string');
  });

  it('rejects non-string event_id', async () => {
    const result = await deleteCalendarEvent.handler(
      { event_id: null as unknown as string },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('event_id must be a non-empty string');
  });

  it('returns auth_required on AuthRequiredError', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AuthRequiredError('+1234567890')
    );

    const result = await deleteCalendarEvent.handler(
      { event_id: 'event-1' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.auth_required).toBe(true);
  });

  it('returns friendly error on 404', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('404 Not Found')
    );

    const result = await deleteCalendarEvent.handler(
      { event_id: 'nonexistent' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns friendly error on rate limit', async () => {
    (deleteEvent as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('429 Rate Limit Exceeded')
    );

    const result = await deleteCalendarEvent.handler(
      { event_id: 'event-1' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many requests');
  });
});

describe('resolveDateTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-05T04:33:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a single date', async () => {
    const result = await resolveDateTool.handler(
      { input: 'tomorrow at 3pm', timezone: 'America/Los_Angeles' },
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.start).toBeDefined();
    expect(result.formatted).toBeDefined();
  });

  it('resolves a date range', async () => {
    const result = await resolveDateTool.handler(
      { input: 'next week', timezone: 'America/Los_Angeles' },
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.start).toBeDefined();
    expect(result.end).toBeDefined();
    expect(result.granularity).toBe('week');
  });

  it('returns error for unparseable input', async () => {
    const result = await resolveDateTool.handler(
      { input: 'xyzzy', timezone: 'America/Los_Angeles' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not parse');
  });

  it('rejects invalid timezone', async () => {
    const result = await resolveDateTool.handler(
      { input: 'tomorrow', timezone: 'Mars/Olympus_Mons' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid timezone');
  });

  // Boundary validation
  it('rejects empty input', async () => {
    const result = await resolveDateTool.handler(
      { input: '', timezone: 'America/Los_Angeles' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('input must be a non-empty string');
  });

  it('rejects empty timezone', async () => {
    const result = await resolveDateTool.handler(
      { input: 'tomorrow', timezone: '' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('timezone must be a non-empty string');
  });

  it('rejects non-string input', async () => {
    const result = await resolveDateTool.handler(
      { input: 42 as unknown as string, timezone: 'America/Los_Angeles' },
      baseContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('input must be a non-empty string');
  });
});
