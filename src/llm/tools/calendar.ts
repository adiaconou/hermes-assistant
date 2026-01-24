/**
 * Calendar and date resolution tools.
 */

import type { ToolDefinition } from '../types.js';
import { requirePhoneNumber, handleAuthError, endOfDay, isValidTimezone } from './utils.js';
import { listEvents, createEvent, updateEvent, deleteEvent } from '../../services/google/calendar.js';
import * as chrono from 'chrono-node';

export const getCalendarEvents: ToolDefinition = {
  tool: {
    name: 'get_calendar_events',
    description: "Get events from the user's Google Calendar. IMPORTANT: Use the current date/time from User Context to determine 'today', 'tomorrow', etc. Include the user's timezone offset in all dates.",
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string',
          description: 'Start of time range. MUST be ISO 8601 with timezone offset (e.g. "2026-01-20T00:00:00-08:00" for PST, "2026-01-20T00:00:00-05:00" for EST). Use the timezone from User Context.',
        },
        end_date: {
          type: 'string',
          description: 'End of time range. MUST include timezone offset. Defaults to end of start_date day if not provided.',
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

    try {
      const startDate = new Date(start_date);
      const endDate = end_date ? new Date(end_date) : endOfDay(startDate);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Fetching calendar events',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        timestamp: new Date().toISOString(),
      }));

      const events = await listEvents(phoneNumber, startDate, endDate);

      return { success: true, events };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar query failed',
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

export const createCalendarEvent: ToolDefinition = {
  tool: {
    name: 'create_calendar_event',
    description: "Create a new event on the user's Google Calendar. IMPORTANT: Use the user's timezone from User Context.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Event title',
        },
        start_time: {
          type: 'string',
          description: 'Start time. MUST be ISO 8601 with timezone offset (e.g. "2026-01-20T15:30:00-08:00" for 3:30 PM PST).',
        },
        end_time: {
          type: 'string',
          description: 'End time with timezone offset. Defaults to 1 hour after start if not provided.',
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

    const { title, start_time, end_time, location } = input as {
      title: string;
      start_time: string;
      end_time?: string;
      location?: string;
    };

    try {
      const start = new Date(start_time);
      // Default to 1 hour if no end time
      const end = end_time ? new Date(end_time) : new Date(start.getTime() + 3600000);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Creating calendar event',
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        timestamp: new Date().toISOString(),
      }));

      const event = await createEvent(phoneNumber, title, start, end, location);

      return { success: true, event };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event creation failed',
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

    try {
      const updates: {
        title?: string;
        start?: Date;
        end?: Date;
        location?: string;
      } = {};

      if (title !== undefined) updates.title = title;
      if (start_time !== undefined) updates.start = new Date(start_time);
      if (end_time !== undefined) updates.end = new Date(end_time);
      if (location !== undefined) updates.location = location;

      console.log(JSON.stringify({
        level: 'info',
        message: 'Updating calendar event',
        eventId: event_id,
        hasTitle: !!title,
        hasStart: !!start_time,
        hasEnd: !!end_time,
        hasLocation: !!location,
        timestamp: new Date().toISOString(),
      }));

      const event = await updateEvent(phoneNumber, event_id, updates);

      return { success: true, event };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event update failed',
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

    try {
      console.log(JSON.stringify({
        level: 'info',
        message: 'Deleting calendar event',
        eventId: event_id,
        timestamp: new Date().toISOString(),
      }));

      await deleteEvent(phoneNumber, event_id);

      return { success: true, deleted: event_id };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Calendar event deletion failed',
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

export const resolveDate: ToolDefinition = {
  tool: {
    name: 'resolve_date',
    description: `ALWAYS use this tool to convert relative dates to absolute ISO 8601 dates before calling calendar tools.

Examples of when to use this:
- "sunday" → returns the actual date of next Sunday
- "tomorrow at 3pm" → returns tomorrow's date with 15:00 time
- "next tuesday" → returns the correct date
- "in 2 hours" → returns current time + 2 hours

Call this BEFORE create_calendar_event or get_calendar_events when the user gives a relative date/time. Use the returned ISO string directly in calendar tool calls.`,
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

    // Validate timezone
    if (!isValidTimezone(timezone)) {
      return {
        success: false,
        error: `Invalid timezone: "${timezone}". Use IANA format like "America/New_York" or "America/Los_Angeles".`,
      };
    }

    try {
      // Get current time to use as reference
      const now = new Date();

      // Parse the natural language date with chrono
      // Use forwardDate: true to prefer future dates
      const results = chrono.parse(dateInput, now, { forwardDate: true });

      if (results.length === 0) {
        return {
          success: false,
          error: `Could not parse date/time from: "${dateInput}"`,
        };
      }

      const parsed = results[0];
      const startDate = parsed.start.date();
      const endDate = parsed.end?.date() || null;

      // Format as ISO 8601 with timezone offset
      const formatWithOffset = (date: Date, tz: string): string => {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        const parts = formatter.formatToParts(date);
        const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';

        const year = getPart('year');
        const month = getPart('month');
        const day = getPart('day');
        const hour = getPart('hour');
        const minute = getPart('minute');
        const second = getPart('second');

        // Calculate offset
        const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
        const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }));
        const offsetMs = tzDate.getTime() - utcDate.getTime();
        const offsetMins = Math.round(offsetMs / 60000);
        const offsetHours = Math.floor(Math.abs(offsetMins) / 60);
        const offsetRemMins = Math.abs(offsetMins) % 60;
        const offsetSign = offsetMins >= 0 ? '+' : '-';
        const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetRemMins).padStart(2, '0')}`;

        return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetStr}`;
      };

      const result: Record<string, unknown> = {
        success: true,
        start: formatWithOffset(startDate, timezone),
        parsed_text: parsed.text,
      };

      if (endDate) {
        result.end = formatWithOffset(endDate, timezone);
      }

      console.log(JSON.stringify({
        level: 'info',
        message: 'Date resolved',
        input: dateInput,
        timezone,
        result: result.start,
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
