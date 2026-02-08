# One-Time Reminder Implementation Plan

## Overview

Add one-time reminder support to the existing `create_scheduled_job` tool. The parser will automatically detect whether a schedule is recurring or one-time based on the natural language input.

**Design decisions:**
- No new tool - extend existing `create_scheduled_job`
- Parser auto-detects: "daily at 9am" → recurring, "tomorrow at 9am" → one-time
- Auto-delete one-time reminders after execution
- Calendar vs SMS already handled by tool descriptions (no changes needed)

---

## 1. Database Schema Changes

**Migration: Add `is_recurring` column**

```sql
ALTER TABLE scheduled_jobs ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 1;
```

- `is_recurring = 1` → Recurring (uses cron expression)
- `is_recurring = 0` → One-time (delete after execution)

For one-time reminders, `cron_expression` stores `"@once"` (sentinel value).

---

## 2. Parser Changes

Enhance `src/services/scheduler/parser.ts`:

```typescript
interface ParsedSchedule {
  type: 'recurring' | 'once';
  cronExpression?: string;  // For recurring
  runAtTimestamp?: number;  // For one-time (Unix seconds)
}

/**
 * Parse natural language schedule. Auto-detects recurring vs one-time.
 *
 * Recurring patterns (returns cron):
 * - "daily at 9am", "every day at 9am"
 * - "every Monday at noon"
 * - "every weekday at 8am"
 * - "every 30 minutes"
 *
 * One-time patterns (returns timestamp):
 * - "tomorrow at 9am"
 * - "in 2 hours"
 * - "next Tuesday at 3pm"
 * - "January 15 at 10am"
 */
export function parseSchedule(
  input: string,
  timezone: string
): ParsedSchedule | null
```

**Detection logic:**
1. Check for recurring keywords: `daily`, `every`, `weekly`, `weekday`, `weekend`
2. If found → parse as cron (existing logic)
3. If not → parse with chrono-node for absolute datetime
4. Return `null` if neither works

---

## 3. Type Updates

Update `src/services/scheduler/types.ts`:

```typescript
interface ScheduledJob {
  // ... existing fields ...
  isRecurring: boolean;  // NEW
}

interface CreateJobInput {
  // ... existing fields ...
  isRecurring: boolean;  // NEW
}
```

---

## 4. CRUD Updates

Update `src/services/scheduler/sqlite.ts`:

- `createJob()`: Accept `isRecurring`, store in DB
- `getJobById()`, `getJobsByPhone()`, `getDueJobs()`: Return `isRecurring`
- Schema init: Add column with default `1` for backwards compatibility

---

## 5. Executor Changes

Update `src/services/scheduler/executor.ts`:

```typescript
// After successful execution:
if (!job.isRecurring) {
  // One-time: delete it
  deleteJob(db, job.id);
  log('info', 'one_time_reminder_completed', { jobId: job.id });
} else {
  // Recurring: calculate next run
  const nextRun = calculateNextRun(job.cronExpression, job.timezone);
  updateJob(db, job.id, { nextRunAt: nextRun, lastRunAt: nowSeconds });
}
```

---

## 6. Tool Description Update

Update `create_scheduled_job` in `src/llm.ts`:

```typescript
{
  name: 'create_scheduled_job',
  description: `Create a scheduled message that will be generated and sent to the user.
Works for both one-time and recurring schedules - the system auto-detects based on the schedule.

One-time examples: "tomorrow at 9am", "in 2 hours", "next Friday at 3pm"
Recurring examples: "daily at 9am", "every Monday at noon", "every weekday at 8:30am"

Use this for SMS/text reminders. For calendar events, use create_calendar_event instead.`,
  // ... rest unchanged
}
```

---

## 7. Handler Update

Update `create_scheduled_job` handler in `src/llm.ts`:

```typescript
// Replace current cron-only parsing with:
const parsed = parseSchedule(schedule, timezone);
if (!parsed) {
  return { success: false, error: 'Could not parse schedule' };
}

const jobInput = {
  phoneNumber,
  channel,
  userRequest,
  prompt,
  cronExpression: parsed.type === 'recurring' ? parsed.cronExpression : '@once',
  timezone,
  nextRunAt: parsed.type === 'recurring'
    ? calculateNextRun(parsed.cronExpression, timezone)
    : parsed.runAtTimestamp,
  isRecurring: parsed.type === 'recurring',
};
```

---

## 8. List Display Update

Update `list_scheduled_jobs` handler to show type:

```typescript
// For recurring:
"Daily at 9:00 AM (next: tomorrow)"

// For one-time:
"One-time: tomorrow at 9:00 AM"
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/services/scheduler/types.ts` | Add `isRecurring` to interfaces |
| `src/services/scheduler/sqlite.ts` | Schema migration, CRUD updates |
| `src/services/scheduler/parser.ts` | New `parseSchedule()` returning type + value |
| `src/services/scheduler/executor.ts` | Delete one-time jobs after execution |
| `src/llm.ts` | Update tool description, handler logic |
| `tests/unit/scheduler/*.test.ts` | Tests for new functionality |

---

## Implementation Order

1. **Schema + types** - Add `isRecurring` column and TypeScript types
2. **Parser** - Implement `parseSchedule()` with auto-detection
3. **CRUD** - Update database operations
4. **Handler** - Update `create_scheduled_job` to use new parser
5. **Executor** - Add delete logic for one-time jobs
6. **Display** - Update list output
7. **Tests**

---

## Why This Works (No System Prompt Changes)

The LLM already distinguishes calendar vs SMS based on tool descriptions:

| User says | LLM picks | Why |
|-----------|-----------|-----|
| "Add a reminder to my calendar for tomorrow" | `create_calendar_event` | Explicitly mentions "calendar" |
| "Remind me tomorrow at 9am to call mom" | `create_scheduled_job` | No calendar mention → SMS reminder |
| "Set up a daily standup reminder" | `create_scheduled_job` | "reminder" + recurring pattern |
| "Schedule a meeting for Monday at 2pm" | `create_calendar_event` | "meeting" implies calendar event |

The tool descriptions are sufficient:
- `create_calendar_event`: "Create a new event on the user's Google Calendar"
- `create_scheduled_job`: "Create a scheduled message that will be generated and sent"

---

## Example Flows

**One-time reminder:**
```
User: "Remind me to call mom tomorrow at 5pm"
LLM: create_scheduled_job(prompt="Reminder to call mom", schedule="tomorrow at 5pm")
Parser: Detects one-time → { type: 'once', runAtTimestamp: 1737500400 }
DB: Creates job with isRecurring=false
Next day at 5pm: Sends "Don't forget to call mom!", then deletes job
```

**Recurring reminder:**
```
User: "Send me a daily motivation quote at 8am"
LLM: create_scheduled_job(prompt="Generate motivational quote", schedule="daily at 8am")
Parser: Detects recurring → { type: 'recurring', cronExpression: '0 8 * * *' }
DB: Creates job with isRecurring=true
Every day at 8am: Sends quote, calculates next run, continues
```
