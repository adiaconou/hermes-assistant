# Agent Architecture Design

This document outlines the current agent architecture and a proposed multi-agent design for handling complex workflows.

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [Example: Current Flow](#example-current-flow)
3. [Limitations](#limitations)
4. [Proposed Multi-Agent Architecture](#proposed-multi-agent-architecture)
5. [Example: Multi-Agent Flow](#example-multi-agent-flow)
6. [Implementation Plan](#implementation-plan)

---

## Current Architecture

### Overview

The current system uses a **single-agent loop** where one LLM call handles all tool execution:

```
┌─────────────────────────────────────────────────────────────────┐
│                        SMS/WhatsApp Webhook                      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Classification (Fast)                       │
│  - Quick LLM call (512 tokens, no tools)                        │
│  - Returns: { needsAsyncWork, immediateResponse }               │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
         ┌──────────────────┐        ┌──────────────────┐
         │  TwiML Response  │        │   Async Work     │
         │  (Immediate)     │        │   (Background)   │
         └──────────────────┘        └────────┬─────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     generateResponse()                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Single LLM with ALL tools:                               │  │
│  │  - email (get_emails, read_email)                         │  │
│  │  - calendar (create_event, list_events, etc.)             │  │
│  │  - scheduler (create_job, list_jobs, update_job, etc.)    │  │
│  │  - memory (remember_fact, recall_facts, etc.)             │  │
│  │  - ui (generate_ui)                                       │  │
│  │  - user_config (set_name, set_timezone)                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Tool Loop (max 5 iterations)                             │  │
│  │  while (stop_reason === 'tool_use') {                     │  │
│  │    - Execute ALL tool calls in parallel                   │  │
│  │    - Send results back to LLM                             │  │
│  │    - Get next response                                    │  │
│  │  }                                                        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Extract text block and return                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/llm/index.ts` | Main `generateResponse()` function with tool loop |
| `src/llm/tools/index.ts` | Tool registry and `executeTool()` |
| `src/llm/tools/*.ts` | Individual tool definitions |
| `src/routes/sms.ts` | Webhook handler, classification, async dispatch |

### Configuration

```typescript
// src/llm/index.ts
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,           // Shared across ALL tools
  system: systemPrompt,       // Single system prompt
  tools: TOOLS,               // ALL tools available
  messages,
});

const MAX_TOOL_LOOPS = 5;     // Maximum tool iterations
```

---

## Example: Current Flow

### User Request

```
"Can you tell me exactly what I have stored in my reminders word for word?
I want to know what the prompts are. And can you present them to me in a
web tool that can allow me to edit them directly?"
```

### Step 1: Classification

```
Request → classifyMessage()
```

**LLM Input:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 512,
  "system": "Classify if this needs async work...",
  "messages": [
    { "role": "user", "content": "Can you tell me exactly what I have stored..." }
  ]
}
```

**LLM Output:**
```json
{
  "needsAsyncWork": true,
  "immediateResponse": "Let me pull up your reminders and create an editor for you!"
}
```

### Step 2: Async Processing - Initial LLM Call

```
processAsyncWork() → generateResponse()
```

**LLM Input:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "You are Hermes, a personal assistant...\n\n<user_memory>...</user_memory>",
  "tools": [
    { "name": "list_scheduled_jobs", ... },
    { "name": "generate_ui", ... },
    // ... 15+ other tools
  ],
  "messages": [
    { "role": "user", "content": "Can you tell me exactly what I have stored..." }
  ]
}
```

**LLM Response (Turn 1):**
```json
{
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "tool_use",
      "id": "tool_1",
      "name": "list_scheduled_jobs",
      "input": {}
    }
  ]
}
```

**Internal Reasoning (not visible):**
> I need to first get the user's reminders using list_scheduled_jobs,
> then I'll create a UI for editing them.

### Step 3: Tool Execution

```typescript
executeTool('list_scheduled_jobs', {}, context)
```

**Tool Result:**
```json
{
  "success": true,
  "jobs": [
    {
      "job_id": "job_abc123",
      "description": "Generate a morning motivation message...",  // TRUNCATED!
      "type": "recurring",
      "schedule": "daily at 8:00 AM",
      "enabled": true,
      "next_run": "Tue, 1/28, 8:00 AM"
    },
    {
      "job_id": "job_def456",
      "description": "Remind me to check my email and...",       // TRUNCATED!
      "type": "recurring",
      "schedule": "every weekday at 9:00 AM",
      "enabled": true,
      "next_run": "Tue, 1/28, 9:00 AM"
    }
  ]
}
```

**Problem:** The `description` field is truncated to 50 characters. The full `prompt` is not returned.

### Step 4: Continue Conversation

**LLM Input (Turn 2):**
```json
{
  "messages": [
    { "role": "user", "content": "Can you tell me exactly..." },
    { "role": "assistant", "content": [{ "type": "tool_use", "name": "list_scheduled_jobs", ... }] },
    { "role": "user", "content": [{ "type": "tool_result", "content": "{\"success\":true,...}" }] }
  ]
}
```

**LLM Response (Turn 2):**
```json
{
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "tool_use",
      "id": "tool_2",
      "name": "generate_ui",
      "input": {
        "title": "Reminder Editor",
        "html": "<div class='container'>...",      // ~500 tokens
        "css": ".container { max-width: 600px...", // ~300 tokens
        "js": "const reminders = [...]; ..."       // ~800 tokens
      }
    }
  ]
}
```

**Internal Reasoning:**
> I got the reminders list. Now I'll generate an interactive UI.
> The user wanted to edit them, so I'll create form fields.
> Wait, the UI can't actually save changes back to the server...
> I'll create a display-only view with the data I have.

### Step 5: UI Generation

```typescript
executeTool('generate_ui', { title, html, css, js }, context)
```

**Tool Result:**
```json
{
  "success": true,
  "shortUrl": "https://hermes.app/p/abc123",
  "pageId": "abc123"
}
```

### Step 6: Final Response

**LLM Response (Turn 3):**
```json
{
  "stop_reason": "end_turn",
  "content": [
    {
      "type": "text",
      "text": "Here are your reminders! I've created an interactive viewer for you:\n\n📋 **Your Reminders:**\n1. Morning motivation (daily at 8am)\n2. Email check reminder (weekdays at 9am)\n\n🔗 View and explore: https://hermes.app/p/abc123\n\nNote: The web viewer shows your reminders but editing must be done through chat."
    }
  ]
}
```

### Complete Token Usage

| Turn | Input Tokens | Output Tokens | Notes |
|------|-------------|---------------|-------|
| Classification | ~200 | ~50 | Fast path |
| Turn 1 | ~2000 | ~100 | System prompt + tools + history |
| Turn 2 | ~2500 | ~1800 | Large UI generation |
| Turn 3 | ~4500 | ~150 | Final response |
| **Total** | **~9200** | **~2100** | |

---

## Limitations

### 1. Token Exhaustion

With `max_tokens: 4096`, complex responses hit limits:

```
System Prompt:     ~800 tokens
Tool Definitions:  ~1500 tokens (15+ tools)
User Memory:       ~200 tokens
Conversation:      ~500 tokens
─────────────────────────────
Available for response: ~1000 tokens

UI Generation needs: ~2000+ tokens
```

**Result:** Response truncated, `stop_reason: 'max_tokens'`, no text block returned.

### 2. No Truncation Handling

```typescript
// Current code only checks for tool_use
while (response.stop_reason === 'tool_use') { ... }

// Never handles:
// - stop_reason === 'max_tokens'  → truncated response
// - stop_reason === 'end_turn' with no text block
```

### 3. All-or-Nothing Tool Access

Every request loads all 15+ tools even if only 1-2 are needed:

```typescript
const tools = options?.tools ?? TOOLS;  // Always ALL tools
```

This wastes tokens on tool definitions.

### 4. No Task Decomposition

Complex requests like "check email, find action items, create reminders" are handled in a single LLM context, leading to:

- Context overflow
- Confused reasoning
- Incomplete execution

### 5. Error Propagation

One tool failure affects the entire response:

```
Email fails → Entire request fails
           → User gets "I could not generate a response"
```

---

## Proposed Multi-Agent Architecture

### Overview

Replace the single-agent loop with specialized agents coordinated by an orchestrator:

```
┌─────────────────────────────────────────────────────────────────┐
│                        SMS/WhatsApp Webhook                      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Classification (unchanged)                  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Orchestrator Agent                         │
│  - Analyzes user intent                                         │
│  - Decomposes into subtasks                                     │
│  - Delegates to specialized agents                              │
│  - Aggregates results                                           │
│  - Composes final response                                      │
└────────────┬──────────────┬──────────────┬──────────────────────┘
             │              │              │
             ▼              ▼              ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│  Email Agent   │ │ Scheduler Agent│ │   UI Agent     │
│                │ │                │ │                │
│ Tools:         │ │ Tools:         │ │ Tools:         │
│ - get_emails   │ │ - create_job   │ │ - generate_ui  │
│ - read_email   │ │ - list_jobs    │ │                │
│                │ │ - update_job   │ │ max_tokens:    │
│ max_tokens:    │ │ - delete_job   │ │ 8192           │
│ 4096           │ │                │ │                │
│                │ │ max_tokens:    │ │ Specialty:     │
│ Specialty:     │ │ 2048           │ │ HTML/CSS/JS    │
│ Email analysis │ │                │ │ generation     │
│ & extraction   │ │ Specialty:     │ │                │
└────────────────┘ │ Time parsing,  │ └────────────────┘
                   │ cron jobs      │
                   └────────────────┘

┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ Calendar Agent │ │  Memory Agent  │ │  Config Agent  │
│                │ │                │ │                │
│ Tools:         │ │ Tools:         │ │ Tools:         │
│ - create_event │ │ - remember     │ │ - set_name     │
│ - list_events  │ │ - recall       │ │ - set_timezone │
│ - update_event │ │ - forget       │ │                │
│ - delete_event │ │                │ │ max_tokens:    │
│                │ │ max_tokens:    │ │ 1024           │
│ max_tokens:    │ │ 2048           │ │                │
│ 4096           │ │                │ │                │
└────────────────┘ └────────────────┘ └────────────────┘
```

### Agent Definitions

```typescript
// src/agents/definitions.ts

import type { AgentConfig } from './types.js';

export const emailAgent: AgentConfig = {
  name: 'email-agent',
  description: 'Reads and analyzes emails from Gmail',
  tools: [getEmails, readEmail],
  maxTokens: 4096,
  systemPrompt: `You are an email analysis specialist.
Your job is to:
1. Search and read emails as requested
2. Extract key information (action items, deadlines, contacts)
3. Return structured data for other agents to use

Always return a JSON block with your findings:
\`\`\`json
{
  "summary": "Brief summary of what you found",
  "emails": [...],
  "actionItems": [{ "description": "...", "deadline": "...", "priority": "high|medium|low" }]
}
\`\`\``,
};

export const schedulerAgent: AgentConfig = {
  name: 'scheduler-agent',
  description: 'Creates and manages scheduled reminders',
  tools: [createScheduledJob, listScheduledJobs, updateScheduledJob, deleteScheduledJob],
  maxTokens: 2048,
  systemPrompt: `You are a scheduling specialist.
Your job is to:
1. Create, update, or delete scheduled reminders
2. Parse natural language times into schedules
3. Confirm what was scheduled

Be precise with times and always confirm the timezone.`,
};

export const uiAgent: AgentConfig = {
  name: 'ui-agent',
  description: 'Generates interactive web pages',
  tools: [generateUi],
  maxTokens: 8192,  // Large for HTML/CSS/JS
  systemPrompt: `You are a UI generation specialist.
Your job is to create mobile-friendly, interactive web pages.

Constraints:
- No external resources (fonts, images, scripts)
- Use localStorage via hermesLoadState()/hermesSaveState()
- Keep code concise but functional
- Dark mode support appreciated

Return clean, semantic HTML with embedded CSS and JS.`,
};

export const calendarAgent: AgentConfig = {
  name: 'calendar-agent',
  description: 'Manages Google Calendar events',
  tools: [createCalendarEvent, listCalendarEvents, updateCalendarEvent, deleteCalendarEvent],
  maxTokens: 4096,
  systemPrompt: `You are a calendar management specialist.
Your job is to:
1. Create, update, or list calendar events
2. Handle timezone conversions
3. Check for conflicts

Always confirm event details with the user.`,
};

export const memoryAgent: AgentConfig = {
  name: 'memory-agent',
  description: 'Stores and retrieves user information',
  tools: [rememberFact, recallFacts, forgetFact],
  maxTokens: 2048,
  systemPrompt: `You are a memory specialist.
Your job is to:
1. Store important facts about the user
2. Recall relevant information when asked
3. Keep memory organized and deduplicated`,
};
```

### Orchestrator Logic

```typescript
// src/agents/orchestrator.ts

export async function orchestrate(
  userMessage: string,
  context: ToolContext
): Promise<string> {
  const anthropic = getClient();

  // Step 1: Plan the approach
  const plan = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You are an orchestrator that plans how to handle user requests.

Available agents:
- email-agent: Read and analyze emails
- scheduler-agent: Create/manage reminders
- calendar-agent: Manage calendar events
- ui-agent: Generate web pages
- memory-agent: Store/recall user info

Analyze the request and return a JSON plan:
\`\`\`json
{
  "steps": [
    { "agent": "email-agent", "task": "description of what to do" },
    { "agent": "scheduler-agent", "task": "...", "dependsOn": [0] }
  ],
  "finalResponseHint": "How to present the results"
}
\`\`\``,
    messages: [{ role: 'user', content: userMessage }],
  });

  const planJson = extractJson(plan);

  // Step 2: Execute agents (with dependency handling)
  const results = new Map<number, AgentResult>();

  for (const [index, step] of planJson.steps.entries()) {
    // Wait for dependencies
    if (step.dependsOn) {
      for (const depIndex of step.dependsOn) {
        if (!results.has(depIndex)) {
          throw new Error(`Dependency ${depIndex} not completed`);
        }
      }
    }

    // Build context from dependencies
    const depResults = (step.dependsOn || [])
      .map(i => results.get(i))
      .filter(Boolean);

    const taskWithContext = depResults.length > 0
      ? `${step.task}\n\nContext from previous steps:\n${JSON.stringify(depResults)}`
      : step.task;

    // Run the agent
    const agent = getAgent(step.agent);
    const result = await runAgent(agent, {
      task: taskWithContext,
      context,
    });

    results.set(index, result);
  }

  // Step 3: Compose final response
  const finalResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: `Compose a friendly, concise response to the user based on the agent results.`,
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: `I executed these steps:\n${JSON.stringify([...results.entries()])}` },
      { role: 'user', content: 'Now compose the final response for the user.' },
    ],
  });

  return extractText(finalResponse);
}
```

---

## Example: Multi-Agent Flow

### User Request

```
"Check my email from today and create reminders for anything that needs follow-up"
```

### Step 1: Orchestrator Plans

**LLM Input:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "system": "You are an orchestrator...",
  "messages": [
    { "role": "user", "content": "Check my email from today and create reminders..." }
  ]
}
```

**LLM Output:**
```json
{
  "steps": [
    {
      "agent": "email-agent",
      "task": "Search for emails from today (newer_than:1d). For each email, identify if it contains action items, deadlines, or requests that need follow-up. Extract the key details."
    },
    {
      "agent": "scheduler-agent",
      "task": "For each action item found, create an appropriate reminder. Use the deadline if specified, otherwise set for tomorrow morning.",
      "dependsOn": [0]
    }
  ],
  "finalResponseHint": "Summarize emails checked and reminders created"
}
```

**Internal Reasoning:**
> This is a two-step workflow:
> 1. First, I need the email agent to read today's emails and find action items
> 2. Then, the scheduler agent can create reminders based on those findings
> The scheduler depends on email results, so they must run sequentially.

### Step 2: Email Agent Executes

**Agent Input:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "You are an email analysis specialist...",
  "tools": [
    { "name": "get_emails", ... },
    { "name": "read_email", ... }
  ],
  "messages": [
    { "role": "user", "content": "Search for emails from today..." }
  ]
}
```

**Agent Turn 1 - Tool Call:**
```json
{
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "tool_use",
      "name": "get_emails",
      "input": { "query": "newer_than:1d", "max_results": 10 }
    }
  ]
}
```

**Tool Result:**
```json
{
  "success": true,
  "emails": [
    {
      "id": "msg_001",
      "from": "boss@company.com",
      "subject": "Q1 Report Due Friday",
      "snippet": "Please have the Q1 report ready by end of day Friday...",
      "date": "2026-01-27T09:00:00Z"
    },
    {
      "id": "msg_002",
      "from": "client@example.com",
      "subject": "Meeting Follow-up",
      "snippet": "Thanks for the call. Can you send the proposal by Wednesday...",
      "date": "2026-01-27T14:30:00Z"
    }
  ]
}
```

**Agent Turn 2 - Read Important Emails:**
```json
{
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "tool_use",
      "name": "read_email",
      "input": { "email_id": "msg_001" }
    },
    {
      "type": "tool_use",
      "name": "read_email",
      "input": { "email_id": "msg_002" }
    }
  ]
}
```

**Agent Final Response:**
```json
{
  "stop_reason": "end_turn",
  "content": [
    {
      "type": "text",
      "text": "```json\n{\n  \"summary\": \"Found 2 emails with action items\",\n  \"actionItems\": [\n    {\n      \"description\": \"Complete Q1 report for boss\",\n      \"deadline\": \"2026-01-31\",\n      \"priority\": \"high\",\n      \"source\": \"Email from boss@company.com\"\n    },\n    {\n      \"description\": \"Send proposal to client\",\n      \"deadline\": \"2026-01-29\",\n      \"priority\": \"medium\",\n      \"source\": \"Email from client@example.com\"\n    }\n  ]\n}\n```"
    }
  ]
}
```

### Step 3: Scheduler Agent Executes

**Agent Input:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 2048,
  "system": "You are a scheduling specialist...",
  "tools": [
    { "name": "create_scheduled_job", ... }
  ],
  "messages": [
    {
      "role": "user",
      "content": "For each action item found, create an appropriate reminder...\n\nContext from previous steps:\n[{\"actionItems\": [...]}]"
    }
  ]
}
```

**Agent Tool Calls:**
```json
{
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "tool_use",
      "name": "create_scheduled_job",
      "input": {
        "user_request": "Remind about Q1 report",
        "prompt": "Remind the user that the Q1 report is due today (Friday). Ask if they need help prioritizing tasks to complete it.",
        "schedule": "Friday at 9am"
      }
    },
    {
      "type": "tool_use",
      "name": "create_scheduled_job",
      "input": {
        "user_request": "Remind about client proposal",
        "prompt": "Remind the user to send the proposal to the client. The deadline is today (Wednesday).",
        "schedule": "Wednesday at 9am"
      }
    }
  ]
}
```

**Agent Final Response:**
```json
{
  "stop_reason": "end_turn",
  "content": [
    {
      "type": "text",
      "text": "Created 2 reminders:\n1. Q1 Report reminder - Friday at 9am\n2. Client proposal reminder - Wednesday at 9am"
    }
  ]
}
```

### Step 4: Orchestrator Composes Response

**Final LLM Call:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 2048,
  "system": "Compose a friendly response...",
  "messages": [
    { "role": "user", "content": "Check my email from today..." },
    { "role": "assistant", "content": "I executed these steps: [email results, scheduler results]" },
    { "role": "user", "content": "Now compose the final response." }
  ]
}
```

**Final Response to User:**
```
I checked your emails from today and found 2 items that need follow-up:

📧 **From your boss** - Q1 Report due Friday
   → Created reminder for Friday 9am

📧 **From client** - Proposal due Wednesday
   → Created reminder for Wednesday 9am

You're all set! I'll ping you before each deadline. 👍
```

### Token Usage Comparison

| Metric | Single Agent | Multi-Agent |
|--------|-------------|-------------|
| Orchestrator | - | ~500 |
| Email Agent | - | ~2000 |
| Scheduler Agent | - | ~800 |
| Final Composition | - | ~400 |
| **Total** | ~9000 | ~3700 |
| Max per call | 4096 (limit hit!) | 4096 (plenty of room) |

---

## Implementation Plan

### Phase 1: Quick Fixes (Now)

1. **Increase max_tokens to 8192**
2. **Add truncation handling**
3. **Add full prompt to list_scheduled_jobs**

```typescript
// src/llm/index.ts
max_tokens: 8192,

// After tool loop
if (response.stop_reason === 'max_tokens') {
  return 'My response was too long. Try a simpler request.';
}
```

### Phase 2: Agent Infrastructure (Week 1)

1. **Create agent types and runner**

```
src/agents/
├── types.ts          # AgentConfig, AgentResult
├── runner.ts         # runAgent() function
├── definitions.ts    # Agent configurations
└── index.ts          # Exports
```

2. **Refactor existing tools into agent groups**

### Phase 3: Orchestrator (Week 2)

1. **Build orchestrator with planning**
2. **Implement dependency handling**
3. **Add parallel execution for independent agents**

### Phase 4: Workflows (Week 3)

1. **Create workflow definitions**

```
src/agents/workflows/
├── morning-briefing.ts
├── email-to-reminders.ts
└── daily-summary.ts
```

2. **Enable workflow-based scheduled jobs**

```typescript
// Job with workflow
{
  prompt: "workflow:morning-briefing",
  cronExpression: "0 8 * * *"
}
```

### Phase 5: Advanced Features (Future)

1. **Streaming responses**
2. **Agent memory/context sharing**
3. **Retry with exponential backoff**
4. **Agent performance metrics**

---

## Appendix: Current Tool Inventory

| Tool | Agent Assignment | Tokens (est.) |
|------|-----------------|---------------|
| `get_emails` | email-agent | 150 |
| `read_email` | email-agent | 100 |
| `create_calendar_event` | calendar-agent | 200 |
| `list_calendar_events` | calendar-agent | 150 |
| `update_calendar_event` | calendar-agent | 200 |
| `delete_calendar_event` | calendar-agent | 80 |
| `create_scheduled_job` | scheduler-agent | 180 |
| `list_scheduled_jobs` | scheduler-agent | 100 |
| `update_scheduled_job` | scheduler-agent | 180 |
| `delete_scheduled_job` | scheduler-agent | 80 |
| `remember_fact` | memory-agent | 120 |
| `recall_facts` | memory-agent | 100 |
| `forget_fact` | memory-agent | 80 |
| `generate_ui` | ui-agent | 200 |
| `set_user_name` | config-agent | 80 |
| `set_user_timezone` | config-agent | 100 |
| **Total** | - | **~2100** |

By splitting into agents, each agent only loads its own tools, saving significant context space.
