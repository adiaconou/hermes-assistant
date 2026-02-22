# Agents

This directory contains the specialized AI agents that power Hermes. Each agent is optimized for a specific domain with curated tools and tailored system prompts.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER REQUEST                                   │
│                         (SMS/WhatsApp Message)                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ORCHESTRATOR                                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                     │
│  │   Planner   │───▶│  Executor   │───▶│  Response   │                     │
│  │             │    │             │    │  Composer   │                     │
│  │ Analyzes    │    │ Runs steps  │    │             │                     │
│  │ request,    │    │ sequentially│    │ Synthesizes │                     │
│  │ selects     │    │ with retry  │    │ final SMS   │                     │
│  │ agents      │    │ & replan    │    │ response    │                     │
│  └─────────────┘    └──────┬──────┘    └─────────────┘                     │
└────────────────────────────┼────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT REGISTRY                                    │
│                                                                             │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│   │ Calendar │ │  Email   │ │  Drive   │ │ Scheduler│ │  Memory  │        │
│   │  Agent   │ │  Agent   │ │  Agent   │ │  Agent   │ │  Agent   │        │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│        │            │            │            │            │               │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐                                  │
│   │    UI    │ │  General │ │   ...    │                                  │
│   │  Agent   │ │  Agent   │ │  (new)   │                                  │
│   └────┬─────┘ └────┬─────┘ └──────────┘                                  │
└────────┼────────────┼───────────────────────────────────────────────────────┘
         │            │
         ▼            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MCP TOOL LAYER                                   │
│                                                                             │
│   Google Calendar API  │  Gmail API  │  Google Drive API  │  Vision API    │
│   Scheduled Jobs DB    │  Memory DB  │  UI Generator      │  Date Resolver │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Request Flow

```
User: "Remind me to check my email from John tomorrow at 9am"

┌──────────────────────────────────────────────────────────────────────────┐
│ 1. PLANNING PHASE                                                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   User Message ──▶ Planner LLM ──▶ Execution Plan                        │
│                                                                          │
│   Plan Output:                                                           │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │ Goal: "Create reminder to check email from John"               │    │
│   │ Steps:                                                         │    │
│   │   step_1: scheduler-agent → "Create reminder for 2026-02-05    │    │
│   │           at 9:00 AM to check email from John"                 │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. EXECUTION PHASE                                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   step_1 ──▶ Scheduler Agent ──▶ create_scheduled_job tool               │
│                    │                                                     │
│                    ▼                                                     │
│              ┌──────────┐                                                │
│              │ StepResult│                                               │
│              │ success: ✓│                                               │
│              │ output:   │                                               │
│              │ "Created  │                                               │
│              │ reminder" │                                               │
│              └──────────┘                                                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. RESPONSE PHASE                                                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Step Results ──▶ Response Composer ──▶ SMS Reply                       │
│                                                                          │
│   "I've set a reminder for tomorrow at 9:00 AM to check your             │
│    email from John."                                                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Multi-Step Orchestration

Some tasks require multiple steps using different agents. **Agents never communicate directly**—the orchestrator manages all execution and data flow. Each agent receives a task, executes it, and returns results to the orchestrator, which then passes relevant data to subsequent steps.

```
User: "Show my calendar for this week in an interactive view"

┌─────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR                                  │
│                                                                         │
│  Manages execution, passes data between steps, handles errors           │
└─────────────────────────────────────────────────────────────────────────┘
        │                                           │
        │ Step 1: Execute                           │ Step 2: Execute
        │ calendar-agent                            │ ui-agent
        ▼                                           ▼
┌─────────────────────────┐              ┌─────────────────────────┐
│     Calendar Agent      │              │       UI Agent          │
│                         │              │                         │
│ Task: Fetch week events │              │ Task: Render calendar   │
│                         │              │       interactively     │
│ Tools:                  │              │                         │
│  • get_calendar_events  │              │ Tools:                  │
│                         │              │  • generate_ui          │
│ Output:                 │              │                         │
│  [event1, event2, ...]  │              │ Output:                 │
│                         │              │  https://hermes/u/abc   │
└───────────┬─────────────┘              └─────────────────────────┘
            │                                       ▲
            │                                       │
            └───────────────────────────────────────┘
                    Orchestrator passes step_1
                    results to step_2 via context

┌─────────────────────────────────────────────────────────────────────────┐
│ Key Point: Agents are isolated. They don't know about other agents.    │
│ The orchestrator injects previous step results into each agent's       │
│ execution context. Agents just see "here's your task + some context."  │
└─────────────────────────────────────────────────────────────────────────┘
```

**How data flows:**
1. Orchestrator creates plan: `[step_1: calendar-agent, step_2: ui-agent]`
2. Orchestrator executes step_1, calendar-agent returns events
3. Orchestrator stores result in `context.stepResults["step_1"]`
4. Orchestrator executes step_2, injecting step_1 results into ui-agent's context
5. UI agent renders the data it received (doesn't fetch it itself)

## Agent Execution Detail

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AGENT EXECUTION                                  │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │           Agent Executor             │
                    │                                      │
  Task + Context ──▶│  1. Load agent capability & tools    │
                    │  2. Build system prompt with:        │
                    │     • Agent-specific instructions    │
                    │     • User context (name, timezone)  │
                    │     • Previous step results          │
                    │     • Media attachments (if any)     │
                    │  3. Call Claude API with tools       │
                    │  4. Execute tool calls               │
                    │  5. Return StepResult                │
                    │                                      │
                    └──────────────────────────────────────┘
                                     │
                                     ▼
                    ┌──────────────────────────────────────┐
                    │            StepResult                │
                    │  {                                   │
                    │    success: boolean,                 │
                    │    output: any,                      │
                    │    error?: string,                   │
                    │    toolCalls?: [...],                │
                    │    tokenUsage?: {...}                │
                    │  }                                   │
                    └──────────────────────────────────────┘
```

## Error Handling & Recovery

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     RETRY & REPLAN FLOW                                 │
└─────────────────────────────────────────────────────────────────────────┘

  Step Execution
       │
       ▼
   ┌───────┐     Yes     ┌───────────────┐
   │Success│────────────▶│ Next Step     │
   └───────┘             └───────────────┘
       │
       │ No
       ▼
   ┌─────────────┐     Yes     ┌───────────────┐
   │ Retries < 2 │────────────▶│ Retry Step    │──┐
   └─────────────┘             └───────────────┘  │
       │                                          │
       │ No                                       │
       ▼                                          │
   ┌─────────────┐     Yes     ┌───────────────┐  │
   │ Can Replan? │────────────▶│ Create New    │  │
   │ (version<3) │             │ Plan          │──┼──▶ Continue
   └─────────────┘             └───────────────┘  │     Execution
       │                                          │
       │ No                                       │
       ▼                                          │
   ┌─────────────┐                               │
   │ Fail Plan   │◀──────────────────────────────┘
   │ Return Error│       (after max retries)
   └─────────────┘

  Limits:
  • Max 2 retries per step
  • Max 3 plan versions (replans)
  • 5-minute step timeout
  • 5-minute total execution timeout
```

## Folder Structure

```
agents/
├── index.ts              # Central registry and exports
├── README.md             # This documentation
│
├── calendar/
│   ├── index.ts          # Capability definition and executor
│   └── prompt.ts         # System prompt template
│
├── drive/
│   ├── index.ts          # Capability definition and executor
│   └── prompt.ts         # System prompt template
│
├── email/
│   ├── index.ts          # Capability definition and executor
│   └── prompt.ts         # System prompt with Gmail search strategies
│
├── general/
│   ├── index.ts          # Capability definition and executor
│   └── prompt.ts         # System prompt template
│
├── memory/
│   ├── index.ts          # Capability definition and executor
│   └── prompt.ts         # System prompt template
│
├── scheduler/
│   ├── index.ts          # Capability definition and executor
│   └── prompt.ts         # System prompt template
│
└── ui/
    ├── index.ts          # Capability definition and executor
    └── prompts.ts        # System prompt with UI generation rules
```

## Agent Structure

Each agent has two files:

| File | Purpose |
|------|---------|
| `index.ts` | Exports `capability` (agent description) and `executor` (run function) |
| `prompt.ts` | Contains the system prompt template with placeholders for context |

**Capability object:**
- `name` - Agent identifier (e.g., "calendar-agent")
- `description` - What the agent does (used by planner for routing)
- `tools` - Array of tool names this agent can use
- `examples` - Sample user requests this agent handles

**Executor function:**
- Receives task string and execution context
- Builds system prompt with user context (name, timezone, previous results)
- Calls Claude API with curated tools
- Returns `StepResult` with success/output/error

## Agents

### Calendar Agent
**Location:** `calendar/index.ts`, `calendar/prompt.ts`

The Calendar Agent provides full CRUD access to Google Calendar. It handles viewing, creating, updating, and deleting calendar events. The agent understands natural language dates ("tomorrow", "next Friday", "this weekend") and automatically resolves them to specific dates using the user's configured timezone. When creating events, it can include details like video call links, attendees, and descriptions. The agent presents events in a clear, readable format optimized for SMS display.

**Tools:**
| Tool | Purpose |
|------|---------|
| `get_calendar_events` | List events for a date or date range |
| `create_calendar_event` | Schedule new events with title, time, location, attendees |
| `update_calendar_event` | Modify existing events (time, title, etc.) |
| `delete_calendar_event` | Remove events from calendar |
| `resolve_date` | Convert natural language dates to ISO format |

**Examples:**
- "What's on my calendar today?"
- "Schedule a meeting tomorrow at 2pm"
- "Cancel my 3pm appointment"
- "Move my dentist appointment to next week"
- "What am I doing this weekend?"

---

### Drive Agent
**Location:** `drive/index.ts`, `drive/prompt.ts`

The Drive Agent is the most tool-rich agent, handling all Google Workspace file operations. It manages Google Drive (file upload, organization, search), Google Sheets (create expense trackers, contact lists, logs), Google Docs (meeting notes, drafts), and image analysis via vision AI. When users send images, this agent analyzes the content and intelligently suggests actions—receipts get offered to expense trackers, business cards to contact sheets, etc. All files are organized in a user-specific "Hermes" folder in Drive. The agent searches for existing files before creating duplicates and provides shareable links to created/updated files.

**Tools (16 total):**

| Category | Tools |
|----------|-------|
| **Drive** | `upload_to_drive`, `list_drive_files`, `create_drive_folder`, `read_drive_file`, `search_drive`, `get_hermes_folder` |
| **Sheets** | `create_spreadsheet`, `read_spreadsheet`, `write_spreadsheet`, `append_to_spreadsheet`, `find_spreadsheet` |
| **Docs** | `create_document`, `read_document`, `append_to_document`, `find_document` |
| **Vision** | `analyze_image` |

**Intelligent Behaviors:**
- **Receipt image** → Extracts date/store/amount, asks about adding to expense tracker
- **Business card** → Extracts contact info, asks about adding to contacts sheet
- **Screenshot** → Asks user what they'd like to do with it
- **Any image** → Analyzes content and suggests relevant actions

**Examples:**
- "Save this image to my Drive"
- "Create a spreadsheet to track expenses"
- "Add this receipt to my expense tracker"
- "What files are in my Hermes folder?"
- "[image attached]" → automatically analyzes and suggests actions

---

### Email Agent
**Location:** `email/index.ts`, `email/prompt.ts`

The Email Agent specializes in searching and reading Gmail. It uses an iterative search strategy—if the first query doesn't find what the user needs, it automatically broadens the search, tries synonyms, or adjusts date ranges. The agent understands Gmail's advanced search syntax and constructs optimized queries. When searching for specific information (confirmations, bookings, receipts), it reads promising emails and follows threads to find the exact details. The agent extracts specific data (confirmation numbers, addresses, dates) rather than just summarizing emails.

**Tools:**
| Tool | Purpose |
|------|---------|
| `get_emails` | Search emails using Gmail query syntax |
| `read_email` | Read full content of a specific email |
| `get_email_thread` | Get complete conversation thread for context |

**Search Strategy:**
1. Analyze request type (person, date, topic, specific item)
2. Construct initial query using user's actual words
3. Adapt based on results (broaden dates, try synonyms, remove filters)
4. Read promising emails and follow threads for details

**Gmail Search Syntax:**
| Filter | Examples |
|--------|----------|
| Sender | `from:john`, `from:company@email.com` |
| Subject | `subject:meeting`, `subject:"project update"` |
| Content | `"exact phrase"`, `keyword1 OR keyword2` |
| Dates | `newer_than:7d`, `newer_than:2m`, `after:2024/01/15` |
| Status | `is:unread`, `is:starred`, `has:attachment` |
| Labels | `label:work`, `category:promotions` |

**Examples:**
- "Do I have any unread emails?"
- "Find my hotel confirmation for Arizona"
- "Search for flight bookings from last year"
- "What did John email me about last week?"
- "Find the tracking number for my Amazon order"

---

### General Agent
**Location:** `general/index.ts`, `general/prompt.ts`

The General Agent is the system's fallback and swiss-army knife. It has access to ALL tools across all domains, making it suitable for multi-domain tasks that span multiple capabilities or requests that don't fit neatly into a specialized agent. In the early phases of development, this was the only agent; it now serves as backward compatibility and handles edge cases. The planner routes to this agent for conversational requests, general questions, or when a task requires coordinating multiple tool categories.

**Tools:** `['*']` (all available tools)

**When Used:**
- Multi-domain tasks: "Check my calendar and remind me about upcoming meetings"
- General conversation: "Hello", "Thanks", "What can you do?"
- Ambiguous requests that don't clearly match a specialized agent
- Tasks requiring tools from multiple categories in a single step

**Examples:**
- "What can you help me with?"
- General questions about any topic
- Complex requests spanning email + calendar + reminders
- Fallback when specialized agents can't handle a request

---

### Memory Agent
**Location:** `memory/index.ts`, `memory/prompt.ts`

The Memory Agent manages the user's personal knowledge base—facts, preferences, and personal details that Hermes remembers across conversations. This agent is ONLY invoked when users explicitly request memory operations ("remember this", "what do you know about me", "forget that"). Background fact extraction from conversations is handled separately by the memory processor, not this agent. Facts are stored as atomic, self-contained statements categorized by type. The agent respects privacy by only storing information the user explicitly shares and confirms what was stored or deleted.

**Tools:**
| Tool | Purpose |
|------|---------|
| `extract_memory` | Store new facts from user input |
| `list_memories` | View all stored facts |
| `update_memory` | Modify an existing fact |
| `remove_memory` | Delete a stored fact |

**Fact Categories:**
| Category | Examples |
|----------|----------|
| `preferences` | Coffee black, prefers morning meetings, vegetarian |
| `relationships` | Wife named Sarah, dog named Max, works with John |
| `health` | Allergic to peanuts, takes vitamin D |
| `work` | Software engineer at Acme Corp, reports to Jane |
| `interests` | Plays guitar, enjoys hiking, reads sci-fi |
| `personal` | Lives in Seattle, born in 1985 |

**Important:** Facts are atomic and self-contained. "User's wife is Sarah" not "Sarah" (needs context).

**Examples:**
- "Remember that I like black coffee"
- "What do you know about me?"
- "Forget that I have a cat"
- "Update my job—I'm now at Google"
- "Remember my wife's birthday is March 15"

---

### Scheduler Agent
**Location:** `scheduler/index.ts`, `scheduler/prompt.ts`

The Scheduler Agent manages reminders and scheduled tasks that trigger SMS messages to the user. This is distinct from calendar events—reminders are proactive notifications sent by Hermes, while calendar events are entries in Google Calendar. The agent supports both one-time reminders ("remind me tomorrow at 9am") and recurring schedules ("every Monday at 8am"). Reminders are stored in the database with cron expressions for recurring patterns. The agent presents schedules in human-readable format and handles natural language time expressions.

**Tools:**
| Tool | Purpose |
|------|---------|
| `create_scheduled_job` | Create one-time or recurring reminders |
| `list_scheduled_jobs` | View all active reminders |
| `update_scheduled_job` | Modify reminder time or message |
| `delete_scheduled_job` | Cancel a reminder |
| `resolve_date` | Parse natural language dates/times |

**Key Distinction:**
```
┌─────────────────────────────────────────────────────────────────┐
│  REMINDERS (scheduler-agent)  │  CALENDAR (calendar-agent)     │
├───────────────────────────────┼─────────────────────────────────┤
│  SMS sent TO you by Hermes    │  Events IN Google Calendar      │
│  "Remind me to..."            │  "Schedule a meeting..."        │
│  Proactive notifications      │  Passive calendar entries       │
│  Stored in Hermes database    │  Stored in Google Calendar      │
└───────────────────────────────┴─────────────────────────────────┘
```

**Recurrence Patterns:**
- One-time: "tomorrow at 9am", "next Friday at 3pm", "January 15 at noon"
- Daily: "every day at 8am", "daily at 6pm"
- Weekly: "every Monday at 9am", "weekdays at 8am"
- Custom: "every 2 hours", "first of the month"

**Examples:**
- "Remind me to call mom tomorrow at 5pm"
- "Set a daily reminder at 8am to take vitamins"
- "What reminders do I have?"
- "Cancel my morning reminder"
- "Change my gym reminder to 7am"

---

### UI Agent
**Location:** `ui/index.ts`, `ui/prompts.ts`

The UI Agent generates interactive web pages when SMS text isn't sufficient for rich interactions. It creates mobile-friendly HTML/CSS/JavaScript pages for checklists, forms, calculators, timers, and data visualizations. Generated pages include a persistence API so state survives page refreshes (e.g., checked items on a shopping list). The agent returns a short URL that users can tap to open the interactive page.

**Critical Limitation:** The UI Agent has NO network access. It cannot fetch external data, call APIs, or load resources from CDNs. To display live data (calendar events, emails, etc.), a previous step must fetch the data, and the UI agent renders it as static HTML with interactive JavaScript.

**Tools:**
| Tool | Purpose |
|------|---------|
| `generate_ui` | Create interactive HTML/CSS/JS page |

**Capabilities:**
- ✅ Interactive checklists (shopping, todo, packing)
- ✅ Forms (RSVP, feedback, data entry)
- ✅ Calculators (tip split, unit conversion, mortgage)
- ✅ Timers and countdowns
- ✅ Data visualization (render data from previous steps)
- ✅ Mobile-optimized responsive design

**Cannot Build:**
- ❌ Anything requiring network/API calls
- ❌ External resources (CDN fonts, images, iframes)
- ❌ Login/auth forms, payment processing
- ❌ Multi-user features, real-time sync
- ❌ Device access (camera, GPS, Bluetooth)

**Persistence API:**
```javascript
// Load previously saved state (returns null if none)
const state = hermesLoadState();

// Save state (JSON-serializable data)
hermesSaveState({ items: [...], checked: [...] });
```

**Multi-Step Pattern:** To show live data interactively, the orchestrator creates a multi-step plan:
1. Step 1: Orchestrator runs calendar-agent → returns events
2. Step 2: Orchestrator injects step_1 results into ui-agent's context → renders interactive view

**Examples:**
- "Create a shopping list I can check off"
- "Make a calculator for tip splitting"
- "Build a form for my event RSVP"
- "Show my calendar in a visual dashboard" (requires 2 steps)
- "Create a workout timer with intervals"

## Adding a New Agent

1. Create a new domain at `src/domains/<name>/` with `capability.ts` set to `exposure: 'agent'`
2. Create `runtime/agent.ts` and `runtime/prompt.ts`
3. Register the domain agent in `src/registry/agents.ts` by importing capability/executor and adding them to `AGENTS`
4. If needed, add domain tools in `src/domains/<name>/runtime/tools.ts` and wire them in `src/tools/index.ts`
5. Add tests for the new agent
6. Update this README with the agent documentation

## Tool Access Matrix

```
┌─────────────────┬────────┬───────┬───────┬──────────┬────────┬────┬─────────┐
│ Tool Category   │Calendar│ Email │ Drive │ Scheduler│ Memory │ UI │ General │
├─────────────────┼────────┼───────┼───────┼──────────┼────────┼────┼─────────┤
│ Calendar Tools  │   ✓    │       │       │          │        │    │    ✓    │
│ Email Tools     │        │   ✓   │       │          │        │    │    ✓    │
│ Drive Tools     │        │       │   ✓   │          │        │    │    ✓    │
│ Sheets Tools    │        │       │   ✓   │          │        │    │    ✓    │
│ Docs Tools      │        │       │   ✓   │          │        │    │    ✓    │
│ Vision Tools    │        │       │   ✓   │          │        │    │    ✓    │
│ Scheduler Tools │        │       │       │    ✓     │        │    │    ✓    │
│ Memory Tools    │        │       │       │          │   ✓    │    │    ✓    │
│ UI Tools        │        │       │       │          │        │ ✓  │    ✓    │
│ Date Resolver   │   ✓    │       │       │    ✓     │        │    │    ✓    │
├─────────────────┼────────┼───────┼───────┼──────────┼────────┼────┼─────────┤
│ Total Tools     │   5    │   3   │  16   │    5     │   4    │ 1  │  ALL    │
└─────────────────┴────────┴───────┴───────┴──────────┴────────┴────┴─────────┘

Legend: ✓ = Has access    General Agent has access to ALL tools (fallback)
```

## Agent Selection Logic

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PLANNER AGENT SELECTION                             │
└─────────────────────────────────────────────────────────────────────────┘

  User Request
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Planner analyzes request against agent capabilities:                │
  │                                                                     │
  │ "What's on my calendar?"     ──▶  calendar-agent                   │
  │ "Find emails from John"      ──▶  email-agent                      │
  │ "Save this to Drive"         ──▶  drive-agent                      │
  │ "Remind me tomorrow"         ──▶  scheduler-agent                  │
  │ "Remember I like coffee"     ──▶  memory-agent                     │
  │ "Create a shopping list"     ──▶  ui-agent                         │
  │ "Check calendar AND remind"  ──▶  calendar-agent → scheduler-agent │
  │ "Hello" / General question   ──▶  general-agent (fallback)         │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
```

## Design Patterns

- **Separation of Concerns:** Each agent focuses on one domain
- **Tool Curation:** Agents only have access to relevant tools
- **Context Injection:** User config (name, timezone) automatically added to prompts
- **Explicit Invocation:** Some agents (memory) only work on explicit user requests
- **Sequential Execution:** Steps run in order; later steps can use earlier results
- **Graceful Degradation:** Retries → Replan → Fail with helpful error message

## Key Constraints

| Constraint | Limit |
|------------|-------|
| Max steps per plan | 10 |
| Max retries per step | 2 |
| Max plan versions | 3 |
| Step timeout | 5 minutes |
| Total execution timeout | 5 minutes |
| SMS response length | ~160 chars |

## Related Documentation

- [ARCHITECTURE.md](../../ARCHITECTURE.md) - System design and integration
- [MEMORY.md](../../MEMORY.md) - Memory system details
