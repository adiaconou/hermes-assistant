# Cron Jobs Feature Plan

## Overview

Add scheduled task capabilities to Hermes assistant, allowing users to set up recurring LLM-generated messages delivered to their phone. Example: "Send me a daily summary at 9am" or "Remind me every Monday to check my calendar."

## Requirements

- **Task Type**: LLM-generated content (invoke LLM at execution time, then deliver)
- **Scheduling**: Natural language input (e.g., "daily at 9am") converted to executable schedule
- **User Identity**: Jobs keyed by phone number (multi-user)
- **Delivery**: WhatsApp/SMS to user's phone number
- **Extensibility**: Polling mechanism abstracted for future platform migration

---

## Architecture

### Database Schema

New table in existing SQLite database:

```sql
CREATE TABLE scheduled_jobs (
  id TEXT PRIMARY KEY,                    -- UUID
  phone_number TEXT NOT NULL,             -- User identifier
  user_request TEXT,                      -- Original user request (for display/debugging)
  prompt TEXT NOT NULL,                   -- LLM-generated execution prompt
  cron_expression TEXT NOT NULL,          -- Standard cron format (minute hour day month weekday)
  timezone TEXT NOT NULL,                 -- IANA timezone (e.g., America/New_York)
  next_run_at INTEGER NOT NULL,           -- Unix timestamp of next execution
  last_run_at INTEGER,                    -- Unix timestamp of last execution
  enabled INTEGER DEFAULT 1,              -- 1=active, 0=paused
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_scheduled_jobs_next_run ON scheduled_jobs(enabled, next_run_at);
CREATE INDEX idx_scheduled_jobs_phone ON scheduled_jobs(phone_number);
```

**Design decisions**:
- `next_run_at` pre-computed for efficient polling (just query `WHERE next_run_at <= NOW()`)
- `cron_expression` stored in standard format for portability
- `timezone` stored per-job (inherited from user config at creation time)
- `user_request` stores original user words for display in job listings and debugging
- `prompt` is the LLM-generated execution prompt (more specific than user request)

### Cron Expression Handling

**Natural Language → Cron Conversion**:

Use the existing `chrono-node` library (already in project for `resolve_date` tool) combined with pattern matching:

| User Input | Cron Expression |
|------------|-----------------|
| "daily at 9am" | `0 9 * * *` |
| "every weekday at 8:30am" | `30 8 * * 1-5` |
| "every Monday at noon" | `0 12 * * 1` |
| "every hour" | `0 * * * *` |
| "twice daily at 9am and 6pm" | Creates 2 jobs |

**Library choice**: Use `croner` npm package
- Modern, well-maintained cron library
- Supports timezone-aware scheduling
- Can parse cron expressions AND calculate next run time
- Works in Node.js (no native dependencies)

### Polling Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Trigger Layer                             │
│  (Abstracted - can swap implementations)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│   │   Railway    │    │  In-Process  │    │   External   │     │
│   │  Cron Job    │    │   Interval   │    │   Webhook    │     │
│   │  (1 min)     │    │  (setInterval)│   │   (future)   │     │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘     │
│          │                   │                   │              │
│          └───────────────────┼───────────────────┘              │
│                              ▼                                   │
│                    ┌─────────────────┐                          │
│                    │  runDueJobs()   │                          │
│                    │  (executor fn)  │                          │
│                    └────────┬────────┘                          │
│                              │                                   │
└──────────────────────────────┼──────────────────────────────────┘
                               ▼
                    ┌─────────────────┐
                    │  Job Executor   │
                    │  Service        │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Query due    │    │ For each job:│    │ Update       │
│ jobs from DB │───▶│ Run LLM +    │───▶│ next_run_at  │
│              │    │ Send message │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
```

**Initial implementation**: In-process interval polling
- Simple `setInterval` that runs every minute
- Queries `scheduled_jobs WHERE enabled=1 AND next_run_at <= NOW()`
- Executes jobs and updates `next_run_at`

**Future extensibility**:
- Add `POST /cron/run` endpoint with auth token
- Railway cron job can call this endpoint
- External services (AWS EventBridge, etc.) can trigger same endpoint

### Job Execution Flow

```
1. Poll finds job due for execution
2. Load user config (timezone, name) for context
3. Call generateResponse() with job.prompt + read-only tools
4. LLM can use tools (e.g., get_calendar_events) to gather data
5. Send generated message via Twilio to job.phone_number
6. Calculate next_run_at using croner
7. Update job record with new next_run_at and last_run_at
8. Log execution result (success/failure, duration)
```

**Tool access for scheduled jobs**:
Jobs run with a restricted set of read-only tools to prevent unsupervised modifications:
- `get_calendar_events` - Fetch calendar data for summaries
- `resolve_date` - Handle relative date references

Excluded from scheduled execution (require user supervision):
- `create_calendar_event` - Don't create events without user watching
- `generate_ui` - Not useful for SMS delivery
- `set_user_config` - User config changes need confirmation
- `delete_user_data` - Destructive action

**Error handling**:
- If LLM fails: Log error, still update next_run_at (don't retry indefinitely)
- If Twilio fails: Log error, still update next_run_at
- Jobs continue on schedule even after failures

### Code Reuse Strategy (KISS)

The executor reuses the existing `generateResponse()` function from `llm.ts` instead of duplicating the tool loop logic. This requires a small refactor to make `generateResponse()` configurable:

```typescript
// New options interface in llm.ts
export interface GenerateOptions {
  systemPrompt?: string;   // Override default SYSTEM_PROMPT
  tools?: Tool[];          // Override default TOOLS (for restricting)
}

// Updated signature (backward compatible)
export async function generateResponse(
  userMessage: string,
  conversationHistory: Message[],
  phoneNumber?: string,
  userConfig?: UserConfig | null,
  options?: GenerateOptions  // <-- New optional parameter
): Promise<string>

// Export read-only tools subset for scheduled jobs
export const READ_ONLY_TOOLS = TOOLS.filter(t =>
  ['get_calendar_events', 'resolve_date'].includes(t.name)
);
```

**Benefits**:
- No duplicate tool loop code
- Single place to maintain LLM interaction logic
- Clean interface for executor
- ~30 lines in executor vs ~150 if duplicated

### Execution Logging

Basic structured logging for debugging and monitoring:

```typescript
// On job start
console.log(JSON.stringify({
  event: 'job_execution_start',
  jobId: job.id,
  phoneNumber: job.phone_number.slice(-4), // Last 4 digits only
  cronExpression: job.cron_expression,
  timestamp: new Date().toISOString()
}));

// On job success
console.log(JSON.stringify({
  event: 'job_execution_success',
  jobId: job.id,
  durationMs: endTime - startTime,
  nextRunAt: new Date(nextRunAt * 1000).toISOString(),
  timestamp: new Date().toISOString()
}));

// On job failure
console.error(JSON.stringify({
  event: 'job_execution_error',
  jobId: job.id,
  error: error.message,
  stage: 'llm' | 'twilio',
  durationMs: endTime - startTime,
  timestamp: new Date().toISOString()
}));
```

---

## LLM Tools

### `create_scheduled_job`

Creates a new recurring job for the user.

```typescript
{
  name: "create_scheduled_job",
  description: "Create a recurring scheduled task that will generate and send a message to the user at specified times. Use this when the user wants regular reminders, summaries, or any recurring notification.",
  input_schema: {
    type: "object",
    properties: {
      user_request: {
        type: "string",
        description: "The user's original request in their own words. Used for display when listing jobs."
      },
      prompt: {
        type: "string",
        description: "What should be generated and sent. Be specific. Example: 'Generate a brief morning summary including today's weather and calendar events'"
      },
      schedule: {
        type: "string",
        description: "When to run, in natural language. Examples: 'daily at 9am', 'every weekday at 8:30am', 'every Monday at noon', 'every hour'"
      }
    },
    required: ["prompt", "schedule"]
  }
}
```

**Handler logic**:
1. Parse `schedule` to cron expression
2. Get user's timezone from user_config (or default to UTC)
3. Calculate initial `next_run_at`
4. Insert into database
5. Return confirmation with next scheduled time

### `list_scheduled_jobs`

Lists user's scheduled jobs.

```typescript
{
  name: "list_scheduled_jobs",
  description: "List all scheduled jobs for the current user. Shows what recurring tasks are set up.",
  input_schema: {
    type: "object",
    properties: {},
    required: []
  }
}
```

### `update_scheduled_job`

Modify an existing job.

```typescript
{
  name: "update_scheduled_job",
  description: "Update an existing scheduled job. Can change the prompt, schedule, or pause/resume the job.",
  input_schema: {
    type: "object",
    properties: {
      job_id: { type: "string", description: "The job ID to update" },
      prompt: { type: "string", description: "New prompt (optional)" },
      schedule: { type: "string", description: "New schedule in natural language (optional)" },
      enabled: { type: "boolean", description: "Set to false to pause, true to resume (optional)" }
    },
    required: ["job_id"]
  }
}
```

### `delete_scheduled_job`

Remove a scheduled job.

```typescript
{
  name: "delete_scheduled_job",
  description: "Delete a scheduled job permanently.",
  input_schema: {
    type: "object",
    properties: {
      job_id: { type: "string", description: "The job ID to delete" }
    },
    required: ["job_id"]
  }
}
```

---

## File Structure

```
src/
├── services/
│   └── scheduler/
│       ├── index.ts           # Main exports
│       ├── sqlite.ts          # Database operations (CRUD for jobs)
│       ├── parser.ts          # Natural language → cron conversion
│       ├── executor.ts        # Job execution logic (LLM + send)
│       └── poller.ts          # Polling loop abstraction
├── llm.ts                     # Add new tool definitions + handlers
└── index.ts                   # Initialize poller on startup
```

---

## Example User Interactions

**Creating a job**:
```
User: Send me a daily summary of my calendar at 8am
Assistant: I'll set that up for you. [calls create_scheduled_job]
         Done! I'll send you a calendar summary every day at 8:00 AM
         (America/New_York). Your first summary will arrive tomorrow.
```

**Listing jobs**:
```
User: What reminders do I have set up?
Assistant: [calls list_scheduled_jobs]
         You have 2 scheduled jobs:
         1. "Send me a daily summary of my calendar at 8am" - every day at 8:00 AM
         2. "Remind me to check my tasks" - every Monday at 9:00 AM
```

**Pausing a job**:
```
User: Pause my daily summaries for now
Assistant: [calls update_scheduled_job with enabled=false]
         Done! Your daily calendar summary is now paused.
         Just let me know when you want to resume it.
```

---

## Dependencies

**New packages**:
- `croner` - Cron expression parsing and next-run calculation

**Existing packages used**:
- `chrono-node` - Already in project, helps parse time expressions
- `better-sqlite3` - Already in project for DB
- Twilio SDK - Already in project for sending

---

## Open Questions / Future Considerations

1. **Execution history**: Should we track job execution history? (Deferred - basic logging covers immediate needs)
2. **Retry logic**: Should failed jobs retry? (Current plan: no, just continue schedule)
3. **Job limits**: Max jobs per user? (Defer until abuse is a problem)
4. **Confirmation before execution**: Should high-stakes jobs require confirmation? (Defer)
5. **Job templates**: Predefined job types? (Defer - start with custom prompts only)

---

## Step-by-Step Implementation Guide

### Step 1: Add croner dependency

**What**: Install the `croner` npm package

**Why**: We need a library to:
- Parse and validate cron expressions
- Calculate the next run time given a cron expression and timezone
- Handle timezone-aware scheduling correctly (including DST)

**How**:
```bash
npm install croner
```

Verify installation by checking `package.json` includes `croner`.

---

### Step 2: Create database schema and sqlite.ts

**What**: Create the `scheduled_jobs` table and implement CRUD operations

**Why**:
- The table stores all job metadata and scheduling info
- `next_run_at` index enables efficient polling (single indexed query)
- CRUD functions provide a clean interface for the rest of the codebase

**How**:

1. Create `src/services/scheduler/sqlite.ts`
2. Follow the pattern from `src/services/user-config/sqlite.ts`:
   - Initialize function that creates table if not exists
   - Export typed functions for each operation

```typescript
// Key functions to implement:
export function initSchedulerDb(db: Database): void
export function createJob(db: Database, job: CreateJobInput): ScheduledJob
export function getJobById(db: Database, id: string): ScheduledJob | null
export function getJobsByPhone(db: Database, phoneNumber: string): ScheduledJob[]
export function getDueJobs(db: Database, now: number): ScheduledJob[]
export function updateJob(db: Database, id: string, updates: Partial<JobUpdates>): ScheduledJob | null
export function deleteJob(db: Database, id: string): boolean
```

3. Define TypeScript types for `ScheduledJob` and `CreateJobInput`

---

### Step 3: Implement parser.ts (Natural Language → Cron)

**What**: Convert natural language schedule descriptions to cron expressions

**Why**:
- Users speak in natural language ("daily at 9am")
- The database and croner need standard cron format ("0 9 * * *")
- Centralized parsing makes the tool handler cleaner

**How**:

1. Create `src/services/scheduler/parser.ts`
2. Use pattern matching for common phrases:

```typescript
export function parseScheduleToCron(schedule: string): string | null

// Patterns to handle:
// "daily at 9am" → "0 9 * * *"
// "every day at 9:30am" → "30 9 * * *"
// "every weekday at 8am" → "0 8 * * 1-5"
// "every monday at noon" → "0 12 * * 1"
// "every hour" → "0 * * * *"
// "every 30 minutes" → "*/30 * * * *"
```

3. Use `chrono-node` to extract time components from natural language
4. Map day names to cron day numbers (Sunday=0, Monday=1, etc.)
5. Return `null` for unparseable schedules (let caller handle error)

---

### Step 4: Refactor llm.ts for reusability

**What**: Add `GenerateOptions` parameter to `generateResponse()` and export `READ_ONLY_TOOLS`

**Why**:
- Enables executor to reuse the existing tool loop instead of duplicating code
- Keeps all LLM interaction logic in one place
- Backward compatible - existing callers don't need to change

**How**:

1. Add the options interface to `src/llm.ts`:

```typescript
export interface GenerateOptions {
  systemPrompt?: string;   // Override default SYSTEM_PROMPT
  tools?: Tool[];          // Override default TOOLS
}
```

2. Update `generateResponse()` signature (add optional parameter at end):

```typescript
export async function generateResponse(
  userMessage: string,
  conversationHistory: Message[],
  phoneNumber?: string,
  userConfig?: UserConfig | null,
  options?: GenerateOptions  // <-- Add this
): Promise<string>
```

3. Update the function body to use options:

```typescript
// Use provided system prompt or build default
const systemPrompt = options?.systemPrompt
  ?? (`**${timeContext}**\n\n` + SYSTEM_PROMPT + userContext);

// Use provided tools or default
const tools = options?.tools ?? TOOLS;
```

4. Export read-only tools for scheduled jobs:

```typescript
export const READ_ONLY_TOOLS = TOOLS.filter(t =>
  ['get_calendar_events', 'resolve_date'].includes(t.name)
);
```

5. Verify existing callers still work (no changes needed since options is optional)

---

### Step 5: Implement executor.ts (Job Execution Logic)

**What**: Execute a single scheduled job using the refactored `generateResponse()`

**Why**:
- Separates execution logic from polling mechanism
- Makes testing easier (can test execution without polling)
- Single responsibility: "run one job"
- Reuses existing tool loop - no code duplication

**How**:

1. Create `src/services/scheduler/executor.ts`
2. Define the job system prompt:

```typescript
const JOB_SYSTEM_PROMPT = `You are generating a scheduled message for the user.
Be concise and helpful. This message will be sent via SMS.
You have access to read-only tools to gather information (calendar events, etc).
Generate the content the user requested, then stop.`;
```

3. Main function (~30 lines total):

```typescript
import { generateResponse, READ_ONLY_TOOLS } from '../../llm.js';
import { getUserConfig } from '../user-config/index.js';
import { sendMessage } from '../../twilio.js';
import { updateJob } from './sqlite.js';
import { Cron } from 'croner';

export interface ExecutionResult {
  success: boolean;
  error?: Error;
}

export async function executeJob(
  db: Database,
  job: ScheduledJob
): Promise<ExecutionResult> {
  const startTime = Date.now();
  logJobStart(job);

  try {
    // Load user config for context
    const userConfig = await getUserConfig(job.phone_number);

    // Reuse existing tool loop with restricted tools
    const response = await generateResponse(
      job.prompt,
      [],  // No conversation history
      job.phone_number,
      userConfig,
      {
        systemPrompt: JOB_SYSTEM_PROMPT,
        tools: READ_ONLY_TOOLS
      }
    );

    // Send the generated message
    await sendMessage(job.phone_number, response);

    // Calculate and update next run time
    const cron = new Cron(job.cron_expression, { timezone: job.timezone });
    const nextRun = cron.nextRun();
    const nextRunAt = nextRun ? Math.floor(nextRun.getTime() / 1000) : null;

    await updateJob(db, job.id, {
      next_run_at: nextRunAt,
      last_run_at: Math.floor(Date.now() / 1000)
    });

    logJobSuccess(job, Date.now() - startTime, nextRunAt);
    return { success: true };

  } catch (error) {
    logJobError(job, error as Error, Date.now() - startTime);

    // Still update next_run_at so job continues on schedule
    const cron = new Cron(job.cron_expression, { timezone: job.timezone });
    const nextRun = cron.nextRun();
    if (nextRun) {
      await updateJob(db, job.id, {
        next_run_at: Math.floor(nextRun.getTime() / 1000),
        last_run_at: Math.floor(Date.now() / 1000)
      });
    }

    return { success: false, error: error as Error };
  }
}
```

4. Add logging helper functions (as defined in Execution Logging section)

---

### Step 6: Implement poller.ts (Polling Abstraction)

**What**: Abstract the polling mechanism so it can be swapped later

**Why**:
- Initially uses setInterval (simple, works everywhere)
- Later can add Railway cron trigger, external webhook, etc.
- Abstraction makes platform migration easier

**How**:

1. Create `src/services/scheduler/poller.ts`
2. Define the interface:

```typescript
export interface Poller {
  start(): void;
  stop(): void;
}

export function createIntervalPoller(
  runDueJobs: () => Promise<void>,
  intervalMs: number
): Poller
```

3. Implementation:
   - `start()`: Sets up `setInterval` that calls `runDueJobs`
   - `stop()`: Clears the interval (useful for graceful shutdown)
   - Interval should be 60 seconds (poll once per minute)

4. The `runDueJobs` function (passed in):
   - Query `getDueJobs(db, Date.now() / 1000)`
   - For each job, call `executeJob()`
   - Can run jobs in parallel or sequentially (start with sequential)

---

### Step 7: Create index.ts exports and initialize poller in main

**What**:
- Create `src/services/scheduler/index.ts` with clean exports
- Initialize the poller when the server starts

**Why**:
- Clean module interface for importing elsewhere
- Poller needs to start when server starts
- Graceful shutdown when server stops

**How**:

1. Create `src/services/scheduler/index.ts`:

```typescript
export * from './sqlite.js';
export * from './parser.js';
export * from './executor.js';
export * from './poller.js';
```

2. Update `src/index.ts`:
   - Import scheduler module
   - Call `initSchedulerDb(db)` during startup
   - Create poller with `createIntervalPoller(...)`
   - Call `poller.start()` after server is listening
   - Handle SIGTERM/SIGINT to call `poller.stop()` for graceful shutdown

---

### Step 8: Add LLM tool definitions

**What**: Add the four tool definitions to `src/llm.ts`

**Why**:
- Tools are how users interact with the scheduler via natural conversation
- Need all four: create, list, update, delete

**How**:

1. Add tool definitions to the `tools` array in `src/llm.ts`
2. Follow existing pattern (see `generate_ui`, `get_calendar_events`)
3. Tool definitions as specified in this document:
   - `create_scheduled_job` (prompt, schedule, user_request)
   - `list_scheduled_jobs` (no params)
   - `update_scheduled_job` (job_id, optional: prompt, schedule, enabled)
   - `delete_scheduled_job` (job_id)

---

### Step 9: Implement tool handlers

**What**: Implement the handler logic for each tool

**Why**:
- Tools need to actually do something when called
- Handlers bridge LLM tool calls to scheduler service

**How**:

1. Add handlers in the tool execution section of `src/llm.ts`
2. Each handler:

**create_scheduled_job**:
```typescript
// 1. Parse schedule to cron using parseScheduleToCron()
// 2. If parse fails, return error message
// 3. Get user timezone from user_config (default UTC)
// 4. Calculate next_run_at using croner
// 5. Call createJob() with all fields
// 6. Return confirmation with human-readable next run time
```

**list_scheduled_jobs**:
```typescript
// 1. Call getJobsByPhone(db, phoneNumber)
// 2. Format as readable list with user_request, schedule, enabled status
// 3. Return formatted list or "No scheduled jobs" message
```

**update_scheduled_job**:
```typescript
// 1. Validate job exists and belongs to user
// 2. If schedule changed, parse new cron and recalculate next_run_at
// 3. Call updateJob() with changes
// 4. Return confirmation of what changed
```

**delete_scheduled_job**:
```typescript
// 1. Validate job exists and belongs to user
// 2. Call deleteJob()
// 3. Return confirmation
```

---

### Step 10: Unit and integration tests

**What**: Add automated tests for core scheduler functionality

**Why**:
- Catch regressions early
- Document expected behavior
- Test failure cases that are hard to trigger manually

**How**:

Focus on major scenarios and failure cases. Don't overdo it.

#### Unit tests (`tests/unit/scheduler/`)

**parser.test.ts** - Natural language → cron conversion:
```typescript
describe('parseScheduleToCron', () => {
  // Happy paths
  it('parses "daily at 9am" → "0 9 * * *"');
  it('parses "every weekday at 8:30am" → "30 8 * * 1-5"');
  it('parses "every monday at noon" → "0 12 * * 1"');
  it('parses "every hour" → "0 * * * *"');

  // Failure cases
  it('returns null for unparseable input like "banana"');
  it('returns null for empty string');
});
```

**sqlite.test.ts** - Database CRUD operations:
```typescript
describe('scheduler sqlite', () => {
  // Use in-memory DB for tests

  // Happy paths
  it('creates a job and returns it with generated ID');
  it('gets jobs by phone number');
  it('gets due jobs (next_run_at <= now)');
  it('updates job fields (enabled, next_run_at)');
  it('deletes a job');

  // Edge cases
  it('returns empty array when no jobs for phone');
  it('returns null when updating non-existent job');
  it('getDueJobs excludes disabled jobs');
});
```

#### Integration tests (`tests/integration/scheduler/`)

**executor.test.ts** - Job execution flow:
```typescript
describe('executeJob', () => {
  // Mock: Anthropic API, Twilio

  // Happy path
  it('calls LLM with job prompt and sends response via Twilio');
  it('updates next_run_at after successful execution');
  it('updates last_run_at timestamp');

  // Failure cases
  it('still updates next_run_at when LLM fails');
  it('still updates next_run_at when Twilio fails');
  it('returns error result but does not throw');
});
```

**tool-handlers.test.ts** - LLM tool integration:
```typescript
describe('scheduler tool handlers', () => {
  // create_scheduled_job
  it('creates job with parsed cron expression');
  it('returns error for unparseable schedule');
  it('uses user timezone from config');

  // list_scheduled_jobs
  it('returns formatted list of user jobs');
  it('returns empty message when no jobs');

  // update_scheduled_job
  it('updates job and recalculates next_run_at if schedule changed');
  it('returns error if job not found');
  it('returns error if job belongs to different user');

  // delete_scheduled_job
  it('deletes job and confirms');
  it('returns error if job not found');
});
```

#### Test utilities

Create `tests/helpers/scheduler.ts`:
```typescript
export function createTestJob(overrides?: Partial<ScheduledJob>): ScheduledJob;
export function createInMemorySchedulerDb(): Database;
```

---

### Step 11: Edge cases and polish

**What**: Handle edge cases and improve user experience

**Why**:
- DST transitions can cause scheduling issues
- Users need clear feedback on what's scheduled
- Error messages should be helpful

**How**:

1. **Timezone edge cases**:
   - Use croner's timezone support (handles DST automatically)
   - Test scheduling across DST boundary
   - Log timezone with each execution for debugging

2. **Job listing format**:
   - Show user_request (their words)
   - Show next run time in their timezone
   - Show enabled/paused status
   - Consider showing last run time if available

3. **Error handling improvements**:
   - If cron parse fails, suggest valid formats
   - If job not found, say so clearly
   - If user has no jobs, friendly empty message

4. **Validation**:
   - Prevent creating jobs with past-only schedules
   - Validate cron expression is valid before saving
   - Limit prompt length to reasonable size

---

## Approval Checklist

Before implementation, confirm:
- [x] Schema design looks correct (added user_request column)
- [x] Tool interface feels right (added user_request to create tool)
- [x] Polling approach (in-process first) is acceptable
- [x] Trigger abstraction maintained for platform portability
- [x] Logging approach is sufficient for debugging
- [x] Phase breakdown makes sense
- [x] Code reuse strategy approved (refactor generateResponse() with options)
- [x] Read-only tools for scheduled jobs (get_calendar_events, resolve_date)
- [x] Test coverage scope defined (major scenarios + failure cases, not exhaustive)
