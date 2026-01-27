# Unified Date Resolution Plan

## Goal

Consolidate date/time parsing into a single, testable utility. All tools that accept dates will:
1. Accept natural language input (e.g., "tomorrow at 3pm")
2. Internally call a shared `resolveDate()` function
3. Return the parsed result in a consistent format

## Current State

| Tool | Input Format | Parsing Location |
|------|--------------|------------------|
| `create_scheduled_job` | Natural language | `scheduler/parser.ts` |
| `create_calendar_event` | ISO 8601 | N/A (LLM formats) |
| `get_calendar_events` | ISO 8601 | N/A (LLM formats) |
| `resolve_date` | Natural language | Inline in tool handler |

**Problems:**
- Duplicate chrono-node logic in scheduler and resolve_date tool
- Calendar tools require LLM to format ISO strings (error-prone)
- Inconsistent API between tools

## Target State

| Tool | Input Format | Parsing Location |
|------|--------------|------------------|
| `create_scheduled_job` | Natural language | `resolveDate()` |
| `create_calendar_event` | Natural language | `resolveDate()` |
| `get_calendar_events` | Natural language | `resolveDate()` |
| `resolve_date` | Natural language | `resolveDate()` |

## Implementation

### Step 1: Create shared date resolver

Create `src/services/date/resolver.ts`:

```typescript
import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';

export type ResolvedDate = {
  timestamp: number;      // UTC Unix timestamp (seconds)
  iso: string;            // ISO 8601 with timezone offset
  formatted: string;      // Human-readable in user's timezone
  components: {           // For debugging/testing
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
};

export type ResolvedDateRange = {
  start: ResolvedDate;
  end: ResolvedDate;
  granularity: 'day' | 'week' | 'month' | 'custom';
};

export type ResolveDateOptions = {
  timezone: string;           // IANA timezone (required)
  referenceDate?: Date;       // For testing, defaults to now
  forwardDate?: boolean;      // Prefer future dates (default: true)
};

/**
 * Parse natural language date/time into structured result.
 * Returns null if parsing fails.
 */
export function resolveDate(
  input: string,
  options: ResolveDateOptions
): ResolvedDate | null;

/**
 * Parse natural language date ranges like "this week",
 * "from 3pm to 5pm", "between Monday and Friday".
 */
export function resolveDateRange(
  input: string,
  options: ResolveDateOptions
): ResolvedDateRange | null;

/**
 * Validate IANA timezone string.
 */
export function isValidTimezone(timezone: string): boolean;

/**
 * Get timezone offset in minutes for a given date and timezone.
 * Handles DST correctly.
 */
export function getTimezoneOffsetMinutes(
  date: Date,
  timezone: string
): number;

/**
 * Format a date in the user's timezone.
 */
export function formatInTimezone(
  date: Date,
  timezone: string,
  style?: 'short' | 'long'
): string;
```

**Timezone strategy:** Use `luxon` for all timezone conversions/formatting. The resolver should:
- Parse input in the user's timezone and convert to UTC epoch seconds
- Always return `iso` as local time with offset (e.g., `2026-01-26T15:00:00-08:00`)
- Use `DateTime` for DST-safe offsets and formatting

### Step 2: Migrate scheduler parsing

Update `src/services/scheduler/parser.ts`:
- Remove `parseReminderTime()` implementation
- Import and use `resolveDate()` from date service
- Keep `parseCronExpression()` for recurring schedules (cron is separate from date resolution)

```typescript
// Before
const timestamp = parseReminderTime(schedule, timezone);

// After
import { resolveDate } from '../date/resolver.js';
const result = resolveDate(schedule, { timezone });
const timestamp = result?.timestamp ?? null;
```

### Step 3: Update calendar tools

Update `src/llm/tools/calendar.ts`:

**create_calendar_event:**
```typescript
// Before
input_schema: {
  properties: {
    start_time: {
      type: 'string',
      description: 'MUST be ISO 8601 with timezone offset...',
    },
  },
}

// After
input_schema: {
  properties: {
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
  },
}

// Handler
const startResult = resolveDate(start_time, { timezone: userTimezone });
if (!startResult) {
  return { success: false, error: `Could not parse start time: "${start_time}"` };
}
const start = new Date(startResult.timestamp * 1000);
const endResult = end_time
  ? resolveDate(end_time, { timezone: userTimezone })
  : null;
const end = endResult ? new Date(endResult.timestamp * 1000) : null;
// If end is not provided, require duration_minutes (avoid implicit 1-hour defaults)
```

**get_calendar_events:**
```typescript
// Before: expects ISO 8601
// After: accepts natural language like "today", "this week", "next Monday"
// Use resolveDateRange for period inputs; resolveDate for single-day lookups
```

**resolve_date tool:**
- Keep for LLM debugging/verification
- Refactor to call shared `resolveDate()` function

### Step 4: Update tool descriptions

Remove ISO 8601 requirements from prompts. New descriptions:

```typescript
// create_calendar_event
description: "Create a calendar event. Dates can be natural language like 'tomorrow at 3pm' or 'next Monday at 10am'."

// get_calendar_events
description: "Get calendar events. Dates can be 'today', 'tomorrow', 'this week', etc."
```

### Step 5: Handle edge cases

The resolver must handle:
- Relative times: "in 2 hours", "in 30 minutes"
- Relative dates: "tomorrow", "next Friday", "this Sunday"
- Absolute times: "3pm", "15:00", "3:30 PM"
- Combined: "tomorrow at 3pm", "next Monday at 10:30am"
- Ranges: "from 3pm to 5pm" (for calendar events)
- Periods: "today", "this week", "this month"
- Ambiguous times: "3pm" should resolve to the next upcoming 3pm (forward)

## Unit Tests

Create `tests/unit/date/resolver.test.ts`:

### Basic parsing tests

```typescript
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
```

### Timezone tests

```typescript
describe('timezone handling', () => {
  const referenceDate = new Date('2026-01-26T20:00:00Z'); // noon PST, 3pm EST

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
```

### DST tests

```typescript
describe('DST handling', () => {
  describe('spring forward (March 8, 2026 - 2am becomes 3am)', () => {
    const beforeDST = new Date('2026-03-08T09:00:00Z'); // 1am PST

    it('skips non-existent time (2:30am)', () => {
      const result = resolveDate('today at 2:30am', {
        timezone: 'America/Los_Angeles',
        referenceDate: beforeDST,
      });
      // Should either return null or adjust to 3:30am
      if (result) {
        expect(result.components.hour).toBeGreaterThanOrEqual(3);
      }
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
      // Should pick one consistently (typically the first occurrence)
    });
  });
});
```

### ISO output tests

```typescript
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
```

### Error cases

```typescript
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
```

### Formatting tests

```typescript
describe('formatInTimezone', () => {
  const date = new Date('2026-01-26T23:30:00Z');

  it('formats in PST correctly', () => {
    const result = formatInTimezone(date, 'America/Los_Angeles', 'long');
    expect(result).toContain('January 26');
    expect(result).toContain('3:30 PM');
    expect(result).toContain('PST');
  });

  it('formats in EST correctly', () => {
    const result = formatInTimezone(date, 'America/New_York', 'long');
    expect(result).toContain('January 26');
    expect(result).toContain('6:30 PM');
    expect(result).toContain('EST');
  });
});
```

### Range tests

```typescript
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
```

## Migration Steps

1. [ ] Add `luxon` dependency
2. [ ] Create `src/services/date/resolver.ts` with core functions
3. [ ] Create `src/services/date/index.ts` for exports
4. [ ] Add unit tests for resolver
5. [ ] Refactor `resolve_date` tool to use shared resolver
6. [ ] Refactor scheduler `parseReminderTime` to use shared resolver
7. [ ] Update `create_calendar_event` to accept natural language
8. [ ] Update `get_calendar_events` to accept natural language
9. [ ] Update tool descriptions in prompts
10. [ ] Add integration tests for calendar tools with natural language input
11. [ ] Remove dead code from old implementations

## Rollback Plan

If issues arise:
1. Tool descriptions can be reverted to require ISO 8601
2. Keep `resolve_date` tool available as fallback
3. Old parsing code can remain alongside new code during transition
