# Architecture

This document describes the system design of Hermes Assistant.

## System Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Twilio    │────▶│   Express   │────▶│   Claude    │
│  (SMS In)   │     │   Server    │     │    LLM      │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           │              Tool Calls
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │   SQLite    │     │   Google    │
                    │  Database   │     │   APIs      │
                    └─────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
             ┌───────────┐ ┌───────────┐
             │ Scheduler │ │  Memory   │
             │  Poller   │ │ Processor │
             └───────────┘ └───────────┘
```

## Request Flow

1. **Inbound SMS**: Twilio sends POST to `/webhook/sms` with message body and sender phone
2. **Conversation Load**: System loads conversation history and user config for the phone number
3. **LLM Processing**: Claude receives the message with system prompt, tools, and context
4. **Tool Execution**: Claude may call tools (calendar, email, scheduler, memory, etc.)
5. **Response**: Final response sent back via Twilio SMS

**Memory routing note:** The classifier prompt directs memory-intent messages (remember/recall/forget/update, “what do you know/remember about me”) to the async path, and the planner biases to `memory-agent` for those tasks. General-agent remains a fallback if no specialized agent fits.

## Core Components

### Express Server (`src/index.ts`)

Entry point that configures:
- Routes for SMS webhook, OAuth callbacks, and UI pages
- Scheduler poller startup
- Health check endpoint

### LLM Integration (`src/llm/`)

- **client.ts**: Anthropic SDK wrapper
- **index.ts**: Message processing with tool loop
- **prompts.ts**: System prompt construction with time/user context
- **tools/**: Tool definitions (calendar, email, scheduler, memory, user-config, ui)

### Services (`src/services/`)

| Service | Purpose |
|---------|---------|
| `scheduler/` | Cron jobs and one-time reminders |
| `google/` | Calendar and Gmail API clients |
| `memory/` | Persistent facts about the user |
| `conversation/` | Message history per phone number |
| `credentials/` | OAuth token storage (encrypted) |
| `user-config/` | User preferences (timezone, etc.) |

### Scheduler System

The scheduler handles both recurring jobs (cron expressions) and one-time reminders:

- **Poller** (`poller.ts`): Runs every 30 seconds, finds due jobs
- **Executor** (`executor.ts`): Runs job through LLM, sends SMS response
- **Parser** (`parser.ts`): Converts natural language to cron or timestamp

---

## Timezone Handling

Timezone handling is critical for reminders and calendar events. The system stores and uses IANA timezone identifiers (e.g., `America/Los_Angeles`).

### Storage

User timezone is stored in the `user_config` SQLite table:

```sql
CREATE TABLE user_config (
  phoneNumber TEXT PRIMARY KEY,
  timezone TEXT,  -- IANA format: "America/New_York"
  ...
)
```

Scheduled jobs also store the timezone they were created with:

```sql
CREATE TABLE scheduled_jobs (
  ...
  timezone TEXT NOT NULL,  -- IANA format
  cronExpression TEXT,     -- For recurring: "0 9 * * *"
  nextRunAt INTEGER,       -- Unix timestamp (UTC)
  ...
)
```

### Setting User Timezone

```
User: "I'm in Pacific time"
Tool: set_user_config({ timezone: "America/Los_Angeles" })
Result: { success: true, timezone: "America/Los_Angeles" }
```

The tool validates IANA timezone strings using `Intl.DateTimeFormat` before storing.

### Creating Reminders

When a user creates a reminder, the flow is:

1. **Check timezone exists**: Fails if user hasn't set timezone
2. **Detect schedule type**: Recurring ("daily at 9am") vs one-time ("tomorrow at 3pm")
3. **Parse the schedule**: Convert to cron expression or UTC timestamp
4. **Store with timezone**: Save the job with the user's current timezone

#### One-Time Reminders

```
User: "Remind me tomorrow at 9am to call mom"
Tool: create_scheduled_job({
        schedule: "tomorrow at 9am",
        message: "Time to call mom!"
      })
Result: {
  id: "job_abc123",
  type: "one-time",
  nextRunAt: 1737900000,           // UTC timestamp
  nextRunFormatted: "Sunday, January 26 at 9:00 AM PST"
}
```

**Internal flow:**
1. Fetch user timezone from config (`America/Los_Angeles`)
2. Parse "tomorrow at 9am" with chrono-node using timezone context
3. Convert local time (Jan 26, 9:00 AM PST) to UTC timestamp
4. Store job with timezone for execution context

#### Recurring Reminders

```
User: "Remind me every weekday at 8am to check my calendar"
Tool: create_scheduled_job({
        schedule: "every weekday at 8am",
        message: "Check your calendar for today"
      })
Result: {
  id: "job_xyz789",
  type: "recurring",
  cronExpression: "0 8 * * 1-5",   // Local time in cron
  nextRunAt: 1737903600,
  nextRunFormatted: "Monday, January 27 at 8:00 AM PST"
}
```

**Internal flow:**
1. Parse natural language to cron expression: `"every weekday at 8am"` → `"0 8 * * 1-5"`
2. Calculate next run using croner library with timezone
3. Store cron expression + timezone (croner handles DST on each execution)

### Executing Reminders

When a job's `nextRunAt` timestamp is reached:

```
Poller: Finds job_abc123 is due (nextRunAt <= now)
Executor: Loads job and user timezone
LLM Context: "Current time: Sunday, January 26, 2026 9:00 AM PST (America/Los_Angeles)"
LLM Prompt: "Time to call mom!"
LLM Response: "Good morning! This is your reminder to call mom. Have a great chat!"
Result: SMS sent to user, job deleted (one-time) or nextRunAt updated (recurring)
```

For recurring jobs, the next run is calculated using croner with the stored timezone, which handles DST transitions automatically.

### Calendar Events

Calendar events use the `resolve_date` tool to convert natural language to ISO 8601:

```
User: "Schedule a meeting Sunday at 3pm"
Tool: resolve_date({ dateString: "Sunday at 3pm", timezone: "America/Los_Angeles" })
Result: "2026-01-26T15:00:00-08:00"
```

The ISO 8601 format includes the timezone offset, which Google Calendar interprets correctly.

### LLM Context

Every request includes timezone-aware context in the system prompt:

```
Current time: Saturday, January 25, 2026 2:30 PM PST (America/Los_Angeles)
```

If the user hasn't set a timezone:

```
Current time: 2026-01-25T22:30:00.000Z (UTC - user timezone unknown)
```

The LLM is instructed to ask for timezone if it's missing and needed.

### DST Handling

Daylight Saving Time is handled automatically by:

- **Intl.DateTimeFormat**: Correctly calculates offsets at any point in time
- **croner library**: Handles DST transitions for recurring jobs
- **zonedTimeToUtcTimestamp**: Iterative algorithm handles DST gaps/overlaps

Edge cases tested:
- Spring forward (March): 2:30 AM doesn't exist
- Fall back (November): 1:30 AM occurs twice

### Summary

| Component | Timezone Usage |
|-----------|----------------|
| User config | Stores IANA timezone |
| Job creation | Parses local time, converts to UTC timestamp |
| Job storage | Stores timezone + cron/timestamp |
| Job execution | Formats time context in user's timezone |
| Next run calc | Uses croner with timezone for DST handling |
| Calendar | ISO 8601 with offset for Google API |
| LLM context | Always includes formatted local time |

---

## Data Storage

All persistent data uses SQLite:

| Table | Purpose |
|-------|---------|
| `user_config` | Timezone, preferences per phone |
| `scheduled_jobs` | Reminders and recurring jobs |
| `conversations` | Message history |
| `credentials` | Encrypted OAuth tokens |
| `memories` | Facts about users |

---

## External Integrations

### Twilio

- Inbound: POST webhook receives SMS
- Outbound: REST API sends SMS responses

### Google APIs

- **Calendar**: Create, read, update, delete events
- **Gmail**: Read and search emails
- OAuth 2.0 with refresh token storage

### Anthropic

- Claude API for message processing
- Tool use for structured actions
