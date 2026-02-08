# Update Reminders Without Delete/Recreate

## Issue

The `update_scheduled_job` tool cannot update the schedule of **one-time reminders**. It uses `parseScheduleToCron()` which only handles recurring cron patterns. When a user tries to change a reminder from "tomorrow at 9am" to "next Tuesday at 3pm", the tool returns an error because `parseScheduleToCron()` returns `null` for one-time time expressions.

**Recurring jobs work fine** - their schedules can be updated without issue.

## Objective

Enable users to update the time of one-time reminders using natural language (e.g., "change my reminder to next Friday at 2pm") without deleting and recreating the reminder.

**Scope note:** Updating a schedule does **not** convert a job between one-time and recurring. Updates are parsed based on the existing job type.

## Root Cause

In `src/llm/tools/scheduler.ts`, the schedule update logic (lines 312-328) unconditionally uses `parseScheduleToCron()`:

```typescript
if (schedule !== undefined) {
  const cronExpression = parseScheduleToCron(schedule);  // Only works for recurring
  if (!cronExpression) {
    return { success: false, error: `Could not parse schedule: "${schedule}"` };
  }
  // ...
}
```

The codebase already has `parseReminderTime()` in `src/services/scheduler/parser.ts` which handles one-time expressions, but it's not used in the update flow.

## Solution

Branch on `job.isRecurring` to use the appropriate parser for each job type.

---

## Implementation Steps

### Step 1: Add import for `parseReminderTime`

**File:** `src/llm/tools/scheduler.ts`

Add `parseReminderTime` to the existing import from the scheduler service export (same module that already provides `parseScheduleToCron`):

```typescript
import {
  parseScheduleToCron,
  parseReminderTime,  // ADD THIS
} from '../../services/scheduler/index.js';
```

### Step 2: Update the schedule parsing logic

**File:** `src/llm/tools/scheduler.ts`
**Location:** Lines 312-328 (inside the `updateScheduledJob` handler)

Replace the existing schedule update block:

```typescript
if (schedule !== undefined) {
  const cronExpression = parseScheduleToCron(schedule);
  if (!cronExpression) {
    return {
      success: false,
      error: `Could not parse schedule: "${schedule}"`,
    };
  }
  updates.cronExpression = cronExpression;

  // Recalculate next run time
  const cron = new Cron(cronExpression, { timezone: job.timezone });
  const nextRun = cron.nextRun();
  if (nextRun) {
    updates.nextRunAt = Math.floor(nextRun.getTime() / 1000);
  }
}
```

With:

```typescript
if (schedule !== undefined) {
  if (job.isRecurring) {
    // Recurring job - parse to cron expression
    const cronExpression = parseScheduleToCron(schedule);
    if (!cronExpression) {
      return {
        success: false,
        error: `Could not parse schedule: "${schedule}"`,
      };
    }
    updates.cronExpression = cronExpression;

    const cron = new Cron(cronExpression, { timezone: job.timezone });
    const nextRun = cron.nextRun();
    if (nextRun) {
      updates.nextRunAt = Math.floor(nextRun.getTime() / 1000);
    }
  } else {
    // One-time reminder - parse to timestamp
    const timestamp = parseReminderTime(schedule, job.timezone);
    if (!timestamp) {
      return {
        success: false,
        error: `Could not parse time: "${schedule}"`,
      };
    }
    updates.nextRunAt = timestamp;
  }
}
```

### Step 3: Fix the re-enable logic

**File:** `src/llm/tools/scheduler.ts`
**Location:** Lines 304-310

The current re-enable logic tries to use `Cron()` for all jobs, which would fail for one-time reminders (cronExpression is `@once`).

Change:

```typescript
if (enabled === true && schedule === undefined) {
  const cron = new Cron(job.cronExpression, { timezone: job.timezone });
  // ...
}
```

To:

```typescript
if (enabled === true && schedule === undefined && job.isRecurring) {
  const cron = new Cron(job.cronExpression, { timezone: job.timezone });
  const nextRun = cron.nextRun();
  if (nextRun) {
    updates.nextRunAt = Math.floor(nextRun.getTime() / 1000);
  }
}
```

For one-time reminders, re-enabling without a new schedule will keep the existing `nextRunAt`. If the time has passed, the user should provide a new schedule.

Consider adding a guard: if `job.isRecurring === false` and `nextRunAt` is in the past, return a user-facing error asking for a new schedule.

---

## Verification

1. **Run existing tests:** `npm test`
2. **Manual test - update one-time reminder:**
   - Create a reminder: "remind me tomorrow at 9am to check email"
   - Update it: "change my reminder to next Friday at 2pm"
   - Verify the `nextRunAt` changed correctly
3. **Manual test - update recurring job (regression):**
   - Create a recurring job: "every day at 8am send me a weather update"
   - Update it: "change to every weekday at 7am"
   - Verify it still works

## Files Modified

| File | Changes |
|------|---------|
| `src/llm/tools/scheduler.ts` | Add import, update schedule parsing logic, fix re-enable logic |
