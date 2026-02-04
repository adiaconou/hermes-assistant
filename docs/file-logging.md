# File-Based Logging Design Document

## Overview

Add file-based logging for development debugging. Captures full agentic traces (LLM inputs/outputs, tool calls, decisions) in plain text log files that are easy to read and analyze.

## Goals

1. **Full Trace Capture**: Log every LLM call, tool execution, and orchestration decision
2. **Human Readable**: Plain text format, like traditional application logs
3. **Dev-Only**: Only active in development environment
4. **Easy to Analyze**: Claude Code can read and explain what happened

## Non-Goals

- Production logging (existing stdout JSON handles this)
- Structured/queryable format
- Log aggregation or rotation

---

## Log Format

Standard log file format with timestamps, levels, and context:

```
================================================================================
TRACE START | 2026-01-30 14:32:05 | +15551234567 | request_abc123
================================================================================

[14:32:05.001] INFO  Incoming SMS request
  Phone: +15551234567
  Channel: sms
  Message: What's on my calendar tomorrow?

[14:32:05.002] DEBUG Loading conversation context
  History messages: 4
  History tokens: ~850
  User facts: 2

[14:32:05.015] INFO  Creating execution plan

[14:32:05.016] DEBUG LLM REQUEST [planning]
  Model: claude-opus-4-5-20251101
  Max tokens: 1024
  Temperature: 0

  --- SYSTEM PROMPT ---
  You are a planning agent for a personal assistant.

  Your job is to analyze the user's request and create an execution plan.

  Available agents:
  - calendar-agent: Manages calendar events (get, create, update, delete)
  - email-agent: Sends and reads emails
  - general-agent: Fallback for general queries
  --- END SYSTEM PROMPT ---

  --- MESSAGES ---
  [user]: What's on my calendar tomorrow?
  --- END MESSAGES ---

[14:32:07.357] DEBUG LLM RESPONSE [planning] (2341ms)
  Model: claude-opus-4-5-20251101
  Stop reason: end_turn
  Tokens: 1523 in / 287 out

  --- RESPONSE ---
  {
    "analysis": "User wants to see tomorrow's calendar events",
    "goal": "Retrieve and display calendar events for tomorrow",
    "steps": [
      {"id": "step_1", "agent": "calendar-agent", "task": "Get events for 2026-01-31"}
    ]
  }
  --- END RESPONSE ---

[14:32:07.360] INFO  Plan created
  Plan ID: plan_1706745123_abc123
  Goal: Retrieve and display calendar events for tomorrow
  Steps: 1

[14:32:07.361] INFO  Executing step 1/1
  Agent: calendar-agent
  Task: Get events for 2026-01-31

[14:32:07.362] DEBUG LLM REQUEST [agent: calendar-agent, step_1, iteration 1]
  Model: claude-sonnet-4-20250514
  Max tokens: 12000
  Tools: calendar_get_events, calendar_create_event, calendar_update_event, calendar_delete_event

  --- SYSTEM PROMPT ---
  You are a calendar agent. You have access to the user's Google Calendar.
  Use the available tools to complete the task.

  User timezone: America/Los_Angeles
  --- END SYSTEM PROMPT ---

  --- MESSAGES ---
  [user]: Get events for 2026-01-31
  --- END MESSAGES ---

[14:32:09.185] DEBUG LLM RESPONSE [agent: calendar-agent, step_1, iteration 1] (1823ms)
  Stop reason: tool_use
  Tokens: 1800 in / 150 out

  --- RESPONSE ---
  I'll check your calendar for tomorrow.

  [TOOL CALL] calendar_get_events
  {
    "startDate": "2026-01-31",
    "endDate": "2026-01-31"
  }
  --- END RESPONSE ---

[14:32:09.186] DEBUG TOOL EXECUTION: calendar_get_events
  Input: {"startDate": "2026-01-31", "endDate": "2026-01-31"}

[14:32:09.528] DEBUG TOOL RESULT: calendar_get_events (342ms)
  Success: true
  Output:
  {
    "events": [
      {"title": "Team standup", "time": "09:00"},
      {"title": "1:1 with Sarah", "time": "14:00"}
    ]
  }

[14:32:09.530] DEBUG LLM REQUEST [agent: calendar-agent, step_1, iteration 2]
  Model: claude-sonnet-4-20250514
  (continuing conversation with tool result)

[14:32:10.422] DEBUG LLM RESPONSE [agent: calendar-agent, step_1, iteration 2] (892ms)
  Stop reason: end_turn
  Tokens: 2100 in / 95 out

  --- RESPONSE ---
  You have 2 events tomorrow:
  1. Team standup at 9:00 AM
  2. 1:1 with Sarah at 2:00 PM
  --- END RESPONSE ---

[14:32:10.423] INFO  Step 1 complete
  Agent: calendar-agent
  Success: true
  Duration: 3062ms
  Tool calls: 1
  LLM iterations: 2

[14:32:10.424] INFO  Composing final response

[14:32:10.425] DEBUG LLM REQUEST [composition]
  Model: claude-opus-4-5-20251101
  Max tokens: 512

  --- SYSTEM PROMPT ---
  Synthesize a natural SMS response from the step results.
  Keep it concise (under 160 characters if possible).
  --- END SYSTEM PROMPT ---

  --- MESSAGES ---
  [user]: Original request: What's on my calendar tomorrow?

  Step results:
  - calendar-agent: You have 2 events tomorrow: Team standup at 9:00 AM, 1:1 with Sarah at 2:00 PM
  --- END MESSAGES ---

[14:32:11.317] DEBUG LLM RESPONSE [composition] (892ms)
  Tokens: 1200 in / 85 out

  --- RESPONSE ---
  You have 2 events tomorrow: Team standup at 9am and 1:1 with Sarah at 2pm.
  --- END RESPONSE ---

[14:32:11.318] INFO  Response composed
  Length: 73 characters

================================================================================
TRACE END | 2026-01-30 14:32:11 | request_abc123
Duration: 6317ms | LLM calls: 4 | Tool calls: 1 | Tokens: 6623 in / 617 out
Status: SUCCESS
================================================================================
```

### Error Example

```
[14:32:09.186] DEBUG TOOL EXECUTION: calendar_get_events
  Input: {"startDate": "2026-01-31", "endDate": "2026-01-31"}

[14:32:10.201] ERROR TOOL FAILED: calendar_get_events (1015ms)
  Error: Google Calendar API error: 401 Unauthorized

  --- STACK TRACE ---
  Error: Google Calendar API error: 401 Unauthorized
      at CalendarService.getEvents (src/services/google/calendar.ts:45:11)
      at async executeCalendarGetEvents (src/tools/calendar/get-events.ts:23:18)
      at async executeTool (src/executor/tool-executor.ts:95:20)
      at async executeToolLoop (src/executor/tool-executor.ts:67:25)
  --- END STACK TRACE ---

[14:32:10.202] WARN  Step 1 failed, will retry (attempt 1/2)
  Agent: calendar-agent
  Error: Google Calendar API error: 401 Unauthorized
```

### Replan Example

```
[14:32:15.100] WARN  Step 2 failed after 2 retries
  Agent: email-agent
  Error: SMTP connection timeout

[14:32:15.101] INFO  Triggering replan
  Plan version: 1 -> 2
  Failed steps: step_2
  Completed steps: step_1

[14:32:15.102] DEBUG LLM REQUEST [replan]
  Model: claude-opus-4-5-20251101
  ...
```

---

## File Structure

```
logs/                           # Added to .gitignore in project root
├── 2026-01-30/
│   ├── 14-32-05_abc123.log
│   ├── 14-35-22_def456.log
│   └── ...
└── 2026-01-31/
    └── ...
```

File naming: `{HH-mm-ss}_{requestId}.log`

The `logs/` directory is added to the project root `.gitignore`.

### When a New Log File is Created

**One log file per incoming request.** Each SMS or WhatsApp message that hits the webhook creates a new log file.

This means:
- User sends "What's on my calendar?" → new log file created
- Full orchestration cycle (plan → execute → compose) logged to that file
- User sends follow-up "Add a meeting at 3pm" → new log file created

This keeps files focused and easy to correlate: one user message = one log file = one complete trace.

---

## Implementation

### Logger Utility

```typescript
// src/utils/trace-logger.ts

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

class TraceLogger {
  private stream: WriteStream;
  private startTime: number;

  constructor(requestId: string) {
    // Creates file, writes header
  }

  log(level: LogLevel, message: string, details?: Record<string, unknown>): void;

  llmRequest(context: string, params: LlmRequestParams): void;
  llmResponse(context: string, response: LlmResponse, durationMs: number): void;

  toolExecution(name: string, input: unknown): void;
  toolResult(name: string, result: unknown, durationMs: number): void;
  toolError(name: string, error: Error, durationMs: number): void;

  section(title: string, content: string): void;  // For prompts, responses

  close(status: 'SUCCESS' | 'FAILED', summary: TraceSummary): void;
}
```

### Integration Points

1. **handler.ts**: Create logger, log request start, close at end
2. **planner.ts**: Log LLM request/response for planning
3. **executor.ts**: Log step start/complete/failed
4. **tool-executor.ts**: Log LLM iterations and tool calls
5. **replanner.ts**: Log replan triggers and LLM calls
6. **response-composer.ts**: Log final composition

### Configuration

```typescript
// src/config.ts

export const traceLogging = {
  enabled: process.env.NODE_ENV === 'development',
  directory: process.env.TRACE_LOG_DIR || './logs',
  level: (process.env.TRACE_LOG_LEVEL || 'DEBUG') as LogLevel,
};
```

---

## Usage

### Finding Logs

```bash
# Today's logs
ls logs/2026-01-30/

# Most recent log
ls -t logs/2026-01-30/ | head -1

# Search for errors
grep -l "ERROR" logs/2026-01-30/*.log

# Search for specific content
grep -r "calendar_get_events" logs/
```

### Debugging with Claude Code

```
"Read logs/2026-01-30/14-32-05_abc123.log and explain why the request failed"

"Look at the planning LLM request in that log - is the prompt missing any context?"

"What tool calls were made and what did they return?"
```

---

## Implementation Phases

### Phase 1: Core Logger
- [ ] Add `logs/` to project root `.gitignore`
- [ ] `TraceLogger` class with file writing
- [ ] Header/footer formatting
- [ ] Timestamp and level formatting
- [ ] Section blocks for prompts/responses

### Phase 2: Integration
- [ ] Create logger in handler.ts
- [ ] Pass through orchestration pipeline
- [ ] Log LLM calls in planner, executor, composer
- [ ] Log tool executions

### Phase 3: Error Handling
- [ ] Stack trace formatting
- [ ] Retry logging
- [ ] Replan logging

---

## Open Questions

1. **Log level filtering**: Should DEBUG be default, or make it configurable?
   - Recommendation: Default to DEBUG in dev, it's the whole point

2. **Phone number in filename**: Include for easier filtering, or omit for privacy?
   - Recommendation: Omit from filename (it's in the log content anyway)

3. **Async writes**: Buffer and flush, or write immediately?
   - Recommendation: Write immediately for reliability in dev
