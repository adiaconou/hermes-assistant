/**
 * Calendar and date resolution tools.
 */

import type { ToolDefinition } from '../../../tools/types.js';
import { requirePhoneNumber, handleAuthError } from '../../../tools/utils.js';
import { listEvents, createEvent, updateEvent, deleteEvent, getEvent } from '../providers/google-calendar.js';
import { DateTime } from 'luxon';
import {
  resolveDate,
  resolveDateRange,
  isValidTimezone,
} from '../../../services/date/resolver.js';

/** Max event duration: 7 days in minutes */
const MAX_DURATION_MINUTES = 7 * 24 * 60;

/**
 * Translate common Google Calendar API errors to user-friendly messages.
 */
function friendlyCalendarError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('404') || message.includes('Not Found')) {
    return 'Event not found. It may have been deleted.';
  }
  if (message.includes('403') || message.includes('Forbidden')) {
    return 'Permission denied. You may not have access to this event.';
  }
  if (message.includes('Rate Limit') || message.includes('429')) {
    return 'Too many requests. Please try again in a moment.';
  }
  return message;
}

export const getCalendarEvents: ToolDefinition = {
  tool: {
    name: 'get_calendar_events',
    description: "Get events from the user's Google Calendar. Dates can be natural language like 'today', 'tomorrow', 'this week', or 'next Monday'.",
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string',
          description: 'Start of time range (e.g. "today", "next Monday", "2026-01-20 9am").',
        },
        end_date: {
          type: 'string',
          description: 'End of time range (optional). If not provided, use end of the start_date day or the period range.',
        },
      },
      required: ['start_date'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { start_date, end_date } = input as {
      start_date: string;
      end_date?: string;
    };

    // Boundary validation
    if (typeof start_date !== 'string' || !start_date.trim()) {
      return { success: false, error: 'start_date must be a non-empty string.' };
    }
    if (end_date !== undefined && (typeof end_date !== 'string' || !end_date.trim())) {
      return { success: false, error: 'end_date must be a non-empty string when provided.' };
    }

    try {
      const timezone = context.userConfig?.timezone;
      if (!timezone) {
        return { success: false, error: 'Timezone not set. Ask the user for their timezone first.' };
      }
      if (!isValidTimezone(timezone)) {
        return { success: false, error: `Invalid timezone: "${timezone}".` };
      }

      let startDate: Date | null = null;
      let endDate: Date | null = null;
      const now = new Date();

      const startRange = resolveDateRange(start_date, {
        timezone,
        referenceDate: now,
        forwardDate: true,
      });

      if (startRange) {
        startDate = new Date(startRange.start.timestamp * 1000);
        endDate = new Date(startRange.end.timestamp * 1000);
      } else {
        const startResult = resolveDate(start_date, {
          timezone,
          referenceDate: now,
          forwardDate: true,
        });
        if (!startResult) {
          return { success: false, error: `Could not parse start date: "${start_date}"` };
        }

        startDate = new Date(startResult.timestamp * 1000);
        const startLocal = DateTime.fromSeconds(startResult.timestamp, { zone: timezone });
        endDate = startLocal.endOf('day').toUTC().toJSDate();
      }

      if (end_date) {
        const endReference = startDate ?? now;
        const endRange = resolveDateRange(end_date, {
          timezone,
          referenceDate: endReference,
          forwardDate: true,
        });

        if (endRange) {
          endDate = new Date(endRange.end.timestamp * 1000);
        } else {
          const endResult = resolveDate(end_date, {
            timezone,
            referenceDate: endReference,
            forwardDate: true,
          });
          if (!endResult) {
            return { success: false, error: `Could not parse end date: "${end_date}"` };
          }
          endDate = new Date(endResult.timestamp * 1000);
        }
      }

      if (!startDate || !endDate) {
        return { success: false, error: 'Could not resolve date range.' };
      }

      if (endDate.getTime() <= startDate.getTime()) {
        return { success: false, error: 'End date must be after start date.' };
      }

      console.log(JSON.stringify({
        level: 'info',
        message: 'Fetching calendar events',
        phoneNumber,
        messageId: context.messageId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        timestamp: new Date().toISOString(),
      }));

      const events = await listEvents(phoneNumber, startDate, endDate);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Calendar events fetched',
        phoneNumber,
        eventCount: events.length,
        timestamp: new Date().toISOString(),
      }));

      return { success: true, events };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar query failed',
        phoneNumber,
        messageId: context.messageId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: friendlyCalendarError(error),
      };
    }
  },
};

export const createCalendarEvent: ToolDefinition = {
  tool: {
    name: 'create_calendar_event',
    description: "Create a new event on the user's Google Calendar. Dates can be natural language like 'tomorrow at 3pm'.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Event title',
        },
        start_time: {
          type: 'string',
          description: 'When the event starts (e.g., "tomorrow at 3pm", "next Monday at 10am")',
        },
        end_time: {
          type: 'string',
          description: 'When the event ends (e.g., "tomorrow at 4pm")',
        },
        duration_minutes: {
          type: 'number',
          description: 'Optional duration in minutes if end_time is not provided',
        },
        location: {
          type: 'string',
          description: 'Location (optional)',
        },
      },
      required: ['title', 'start_time'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { title, start_time, end_time, duration_minutes, location } = input as {
      title: string;
      start_time: string;
      end_time?: string;
      duration_minutes?: number;
      location?: string;
    };

    // Boundary validation
    if (typeof title !== 'string' || !title.trim()) {
      return { success: false, error: 'title must be a non-empty string.' };
    }
    if (typeof start_time !== 'string' || !start_time.trim()) {
      return { success: false, error: 'start_time must be a non-empty string.' };
    }
    if (end_time !== undefined && (typeof end_time !== 'string' || !end_time.trim())) {
      return { success: false, error: 'end_time must be a non-empty string when provided.' };
    }
    if (duration_minutes !== undefined) {
      if (typeof duration_minutes !== 'number' || duration_minutes <= 0) {
        return { success: false, error: 'duration_minutes must be a positive number.' };
      }
      if (duration_minutes > MAX_DURATION_MINUTES) {
        return { success: false, error: `duration_minutes cannot exceed ${MAX_DURATION_MINUTES} (7 days).` };
      }
    }

    try {
      const timezone = context.userConfig?.timezone;
      if (!timezone) {
        return { success: false, error: 'Timezone not set. Ask the user for their timezone first.' };
      }
      if (!isValidTimezone(timezone)) {
        return { success: false, error: `Invalid timezone: "${timezone}".` };
      }

      const startResult = resolveDate(start_time, { timezone, referenceDate: new Date(), forwardDate: true });
      if (!startResult) {
        return { success: false, error: `Could not parse start time: "${start_time}"` };
      }

      if (end_time) {
        const endResult = resolveDate(end_time, {
          timezone,
          referenceDate: new Date(startResult.timestamp * 1000),
          forwardDate: true,
        });
        if (!endResult) {
          return { success: false, error: `Could not parse end time: "${end_time}"` };
        }

        const start = new Date(startResult.timestamp * 1000);
        const end = new Date(endResult.timestamp * 1000);

        if (end.getTime() <= start.getTime()) {
          return { success: false, error: 'End time must be after start time.' };
        }

        console.log(JSON.stringify({
          level: 'info',
          message: 'Creating calendar event',
          phoneNumber,
          messageId: context.messageId,
          title,
          start: start.toISOString(),
          end: end.toISOString(),
          timestamp: new Date().toISOString(),
        }));

        const event = await createEvent(phoneNumber, title, start, end, location);
        return { success: true, event };
      }

      if (!duration_minutes) {
        return { success: false, error: 'Provide end_time or duration_minutes.' };
      }

      const start = new Date(startResult.timestamp * 1000);
      const end = new Date(start.getTime() + duration_minutes * 60000);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Creating calendar event',
        phoneNumber,
        messageId: context.messageId,
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        timestamp: new Date().toISOString(),
      }));

      const event = await createEvent(phoneNumber, title, start, end, location);

      return { success: true, event };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event creation failed',
        phoneNumber,
        messageId: context.messageId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: friendlyCalendarError(error),
      };
    }
  },
};

export const updateCalendarEvent: ToolDefinition = {
  tool: {
    name: 'update_calendar_event',
    description: "Update an existing event on the user's Google Calendar. Use get_calendar_events first to find the event ID.",
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: {
          type: 'string',
          description: 'The event ID to update (from get_calendar_events)',
        },
        title: {
          type: 'string',
          description: 'New event title (optional)',
        },
        start_time: {
          type: 'string',
          description: 'New start time with timezone offset (optional)',
        },
        end_time: {
          type: 'string',
          description: 'New end time with timezone offset (optional)',
        },
        location: {
          type: 'string',
          description: 'New location (optional)',
        },
      },
      required: ['event_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { event_id, title, start_time, end_time, location } = input as {
      event_id: string;
      title?: string;
      start_time?: string;
      end_time?: string;
      location?: string;
    };

    // Boundary validation
    if (typeof event_id !== 'string' || !event_id.trim()) {
      return { success: false, error: 'event_id must be a non-empty string.' };
    }
    if (title === undefined && start_time === undefined && end_time === undefined && location === undefined) {
      return { success: false, error: 'Provide at least one field to update (title, start_time, end_time, or location).' };
    }

    try {
      const updates: {
        title?: string;
        startTime?: Date;
        endTime?: Date;
        startDate?: string;
        endDate?: string;
        location?: string;
      } = {};

      const needsDateUpdate = start_time !== undefined || end_time !== undefined;
      let isAllDay = false;
      if (needsDateUpdate) {
        const existingEvent = await getEvent(phoneNumber, event_id);
        isAllDay = !!existingEvent.start?.date && !existingEvent.start?.dateTime;
      }

      const datePart = (value: string) => value.slice(0, 10);
      const addDays = (value: string, days: number) => {
        const [year, month, day] = value.split('-').map(Number);
        const utcDate = new Date(Date.UTC(year, month - 1, day + days));
        return utcDate.toISOString().slice(0, 10);
      };

      if (title !== undefined) updates.title = title;
      if (location !== undefined) updates.location = location;

      if (isAllDay) {
        if (start_time !== undefined) updates.startDate = datePart(start_time);
        if (end_time !== undefined) updates.endDate = addDays(datePart(end_time), 1);
      } else {
        if (start_time !== undefined) updates.startTime = new Date(start_time);
        if (end_time !== undefined) updates.endTime = new Date(end_time);
      }

      console.log(JSON.stringify({
        level: 'info',
        message: 'Updating calendar event',
        phoneNumber,
        messageId: context.messageId,
        eventId: event_id,
        hasTitle: !!title,
        hasStart: !!start_time,
        hasEnd: !!end_time,
        hasLocation: !!location,
        isAllDay,
        timestamp: new Date().toISOString(),
      }));

      const event = await updateEvent(phoneNumber, event_id, updates);

      return { success: true, event };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event update failed',
        phoneNumber,
        messageId: context.messageId,
        eventId: event_id,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: friendlyCalendarError(error),
      };
    }
  },
};

export const deleteCalendarEvent: ToolDefinition = {
  tool: {
    name: 'delete_calendar_event',
    description: "Delete an event from the user's Google Calendar. Use get_calendar_events first to find the event ID. Ask for confirmation before deleting.",
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: {
          type: 'string',
          description: 'The event ID to delete (from get_calendar_events)',
        },
      },
      required: ['event_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { event_id } = input as { event_id: string };

    // Boundary validation
    if (typeof event_id !== 'string' || !event_id.trim()) {
      return { success: false, error: 'event_id must be a non-empty string.' };
    }

    try {
      console.log(JSON.stringify({
        level: 'info',
        message: 'Deleting calendar event',
        phoneNumber,
        messageId: context.messageId,
        eventId: event_id,
        timestamp: new Date().toISOString(),
      }));

      await deleteEvent(phoneNumber, event_id);

      return { success: true, deleted: event_id };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event deletion failed',
        phoneNumber,
        messageId: context.messageId,
        eventId: event_id,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: friendlyCalendarError(error),
      };
    }
  },
};

export const resolveDateTool: ToolDefinition = {
  tool: {
    name: 'resolve_date',
    description: `Resolve natural language dates to ISO 8601 strings (with timezone offset).

Examples of when to use this:
- "sunday" → returns the actual date of next Sunday
- "tomorrow at 3pm" → returns tomorrow's date with 15:00 time
- "next tuesday" → returns the correct date
- "in 2 hours" → returns current time + 2 hours
- "this week" → returns a start and end range

Use this for debugging/verification. Calendar tools can accept natural language directly.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        input: {
          type: 'string',
          description: 'The natural language date/time to resolve (e.g., "sunday", "tomorrow at 3pm", "next week")',
        },
        timezone: {
          type: 'string',
          description: 'IANA timezone for the result (e.g., "America/Los_Angeles"). Use the timezone from User Context.',
        },
      },
      required: ['input', 'timezone'],
    },
  },
  handler: async (input, _context) => {
    const { input: dateInput, timezone } = input as {
      input: string;
      timezone: string;
    };

    // Boundary validation
    if (typeof dateInput !== 'string' || !dateInput.trim()) {
      return { success: false, error: 'input must be a non-empty string.' };
    }
    if (typeof timezone !== 'string' || !timezone.trim()) {
      return { success: false, error: 'timezone must be a non-empty string.' };
    }

    if (!isValidTimezone(timezone)) {
      return {
        success: false,
        error: `Invalid timezone: "${timezone}". Use IANA format like "America/New_York" or "America/Los_Angeles".`,
      };
    }

    try {
      const range = resolveDateRange(dateInput, { timezone, referenceDate: new Date(), forwardDate: true });
      if (range) {
        console.log(JSON.stringify({
          level: 'info',
          message: 'Date range resolved',
          input: dateInput,
          timezone,
          start: range.start.iso,
          end: range.end.iso,
          granularity: range.granularity,
          timestamp: new Date().toISOString(),
        }));

        return {
          success: true,
          start: range.start.iso,
          end: range.end.iso,
          granularity: range.granularity,
        };
      }

      const resolved = resolveDate(dateInput, { timezone, referenceDate: new Date(), forwardDate: true });
      if (!resolved) {
        return {
          success: false,
          error: `Could not parse date/time from: "${dateInput}"`,
        };
      }

      const result: Record<string, unknown> = {
        success: true,
        start: resolved.iso,
        timestamp: resolved.timestamp,
        formatted: resolved.formatted,
      };

      console.log(JSON.stringify({
        level: 'info',
        message: 'Date resolved',
        input: dateInput,
        timezone,
        result: resolved.iso,
        timestamp: new Date().toISOString(),
      }));

      return result;
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to resolve date',
        input: dateInput,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
