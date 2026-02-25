/**
 * Date resolution tool.
 *
 * Shared tool used by calendar-agent and scheduler-agent to resolve
 * natural language dates to ISO 8601 strings with timezone offsets.
 */

import type { ToolDefinition } from './types.js';
import {
  resolveDate,
  resolveDateRange,
  isValidTimezone,
} from '../services/date/resolver.js';

export const resolveDateTool: ToolDefinition = {
  tool: {
    name: 'resolve_date',
    description: `Resolve natural language dates to ISO 8601 strings (with timezone offset).

ALWAYS call this tool before passing dates to calendar or scheduler tools. LLMs are unreliable at calendar math — use this tool to get the correct absolute date.

Examples:
- "sunday" → returns the actual date of next Sunday
- "tomorrow at 3pm" → returns tomorrow's date with 15:00 time
- "next tuesday" → returns the correct date
- "in 2 hours" → returns current time + 2 hours
- "this week" → returns a start and end range`,
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
