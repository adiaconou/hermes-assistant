# Architecture

System design for Hermes Assistant — an SMS/WhatsApp personal assistant powered by Claude and Google Workspace.

## Table of Contents

1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Layered Domain Contract (Target)](#layered-domain-contract-target)
4. [Forward-Layer Compliance Review (2026-02-20)](#forward-layer-compliance-review-2026-02-20)
5. [Migration Recommendations](#migration-recommendations)
6. [Request Processing Flow](#request-processing-flow)
7. [Orchestrator](#orchestrator)
8. [Agent System](#agent-system)
9. [Tool Registry](#tool-registry)
10. [Memory System](#memory-system)
11. [Scheduler System](#scheduler-system)
12. [Email Watcher System](#email-watcher-system)
13. [Date Resolution](#date-resolution)
14. [Data Storage](#data-storage)
15. [External Integrations](#external-integrations)
16. [UI Generation](#ui-generation)
17. [Media Handling](#media-handling)
18. [File Structure](#file-structure)

---

## System Overview

Hermes is a multi-agent assistant that receives messages via Twilio (SMS/WhatsApp), plans and executes tasks using specialized agents, and replies via SMS. It integrates with Google Calendar, Gmail, Drive, Sheets, Docs, and Gemini Vision.

### Key Design Principles

- **Two-phase response**: Fast synchronous classification (<5s) + asynchronous deep processing
- **Agent orchestration**: An LLM planner decomposes requests into steps and delegates to specialized agents
- **Tool isolation**: Each agent has access to only the tools it needs (except general-agent which has all)
- **Background memory**: Facts are extracted from conversations asynchronously, not during real-time interactions
- **Background email watching**: Incoming emails are polled, classified against user-defined skills, and actioned automatically
- **Timezone-first**: All date/time operations use IANA timezones with DST-safe handling

---

## High-Level Architecture

```
                              ┌────────────────────────────────┐
                              │        Hermes Assistant         │
                              └────────────────────────────────┘
                                             │
     ┌──────────────────┬────────────────────┼────────────────────┐
     │                  │                    │                    │
     ▼                  ▼                    ▼                    ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│    Twilio    │ │  Scheduler   │ │   Memory     │ │ Email Watcher│
│   Webhooks   │ │   Poller     │ │  Processor   │ │   Poller     │
│ (SMS/WA In)  │ │ (30s loop)   │ │ (5min loop)  │ │ (60s loop)   │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │                │
       ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Express Server (index.ts)                          │
│  Routes: /webhook/sms  /auth/google  /pages/*  /health  /admin/*               │
└─────────┬──────────────────────────────────────────────────────────┬────────────┘
          │                                                          │
          ▼                                                          ▼
┌─────────────────────────────────────────────────────┐  ┌────────────────────────┐
│               Message Processing Pipeline            │  │  Email Classification  │
│                                                      │  │                        │
│  Classifier ──▶ Orchestrator ──▶ Agents ──▶ Compose  │  │  Classify ──▶ Actions  │
│  (fast path)    (planner)       (execute)   (reply)  │  │  (Haiku)    (tools/SMS)│
└──────────────────────────┬───────────────────────────┘  └──────────┬─────────────┘
                           │                                         │
                           ▼                                         ▼
                ┌──────────────────┐      ┌──────────────────────────────┐
                │   SQLite DBs     │      │      External Services       │
                │  - credentials   │      │  Google Calendar/Gmail/Drive  │
                │  - conversation  │      │  Google Sheets/Docs/Vision    │
                │  - memory        │      │  Anthropic Claude API         │
                │                  │      │  Twilio SMS/WhatsApp          │
                └──────────────────┘      └──────────────────────────────┘
```

---

## Layered Domain Contract (Target)

This repository currently documents a component-oriented architecture (`routes`, `services`, `tools`, `orchestrator`). To align with the forward-only layered model described in the Harness article, the target shape is domain-oriented and mechanically enforced.

### Canonical Layer Order

Within each business domain, dependencies must move in one direction only:

```
Types -> Config -> Repo -> Service -> Runtime -> UI
                 ^ 
             Providers (explicit cross-cutting ingress)
```

### Domain Package Template

```
src/domains/<domain>/
├── types/
├── config/
├── repo/
├── providers/
├── service/
├── runtime/
└── ui/
```

### Layer Responsibilities and Allowed Imports

| Layer | Responsibility | Allowed internal imports |
|-------|----------------|--------------------------|
| `types` | Domain DTOs, schema types, value objects | none |
| `config` | Domain constants/config parsing | `types` |
| `repo` | Persistence/data access for the domain | `types`, `config` |
| `providers` | Interfaces for cross-cutting systems (auth, Google/Twilio clients, telemetry, feature flags) | `types`, `config` |
| `service` | Domain business logic and orchestration | `types`, `config`, `repo`, `providers` |
| `runtime` | HTTP handlers, job runners, tool adapters, agent adapters | `types`, `service`, `providers` |
| `ui` | HTML/UI rendering and presentation | `types`, `runtime` |

Rules:
- No backward imports (for example, `repo` cannot import `runtime`).
- Cross-cutting concerns must be accessed through `providers`, not by importing external clients directly.
- Shared primitives (`AuthRequiredError`, shared request/context types, etc.) must live in `types` or `providers`, not in runtime files.

---

## Forward-Layer Compliance Review (2026-02-20)

Assessment scope: static review of current repository structure and import edges.

### Summary

The current implementation is functional, but it does **not** yet meet the strict forward-only layered contract above.

| Constraint | Status | Evidence | Impact |
|------------|--------|----------|--------|
| Domain-oriented layer packaging | Not met | Code is organized by technical slices (`src/routes`, `src/services`, `src/tools`, `src/orchestrator`) rather than per-domain layered packages. | Hard to enforce domain-local invariants and forward-only edges. |
| Forward-only dependencies | Not met | Reverse/cross-layer edges exist: `src/tools/utils.ts` imports `src/routes/auth.ts`; `src/services/anthropic/classification.ts` imports `src/tools/index.ts`; `src/services/scheduler/executor.ts` imports `src/tools/index.ts`; `src/orchestrator/response-composer.ts` imports `src/tools/index.ts`; `src/services/media/process.ts` imports `src/tools/types.ts`. | Creates coupling across runtime/service/tool boundaries and encourages drift. |
| Explicit providers boundary for cross-cutting concerns | Partially met | Some integrations are centralized in `src/services/google/*`, but external/auth/config concerns are still accessed from many layers directly (for example `routes`, `tools`, `services`, `orchestrator`). | Cross-cutting behavior is inconsistent and harder to swap or test in isolation. |
| Mechanical enforcement (lints + structural tests) | Not met | `package.json` exposes only `lint: eslint src/`; no dependency-boundary linter/structural test is configured to block illegal import directions. | Architecture rules are advisory instead of enforceable. |
| Strict domain boundary behavior | Partially met | Specialized agents exist, but `general-agent` still has access to all tools. | Useful for fallback, but it weakens strict domain containment if overused. |

### Observed Top-Level Import Edges

A quick import-edge pass shows cross-slice coupling still present:
- `tools -> services` (28 edges)
- `services -> tools` (6 edges)
- `routes -> tools` (2 edges)
- `tools -> routes` (1 edge)
- `orchestrator -> tools` (1 edge)

Bidirectional edges (`tools <-> services`) are a direct signal that forward-only constraints are not yet encoded in code structure.

---

## Migration Recommendations

### Priority 0: Define and freeze the dependency contract

1. Add a machine-readable dependency policy (for example, ESLint `no-restricted-imports` per directory or a structural test).
2. Fail CI when a layer imports disallowed layers.
3. Keep exceptions in a short explicit allowlist with expiry dates.

### Priority 1: Remove known reverse edges first

1. Move auth-link generation out of runtime route code so `src/tools/utils.ts` no longer imports `src/routes/auth.ts`.
2. Move shared `MediaAttachment` and similar cross-cutting types out of `src/tools/types.ts` into a neutral domain `types` module.
3. Stop importing tool registries from service/orchestrator modules; pass needed capabilities via runtime composition.

### Priority 2: Introduce providers as the only cross-cutting ingress

1. Create provider interfaces for Google/Twilio/auth/config/telemetry.
2. Inject providers into services/runtime instead of importing concrete clients directly.
3. Keep provider wiring in runtime/bootstrap (`src/index.ts`), not in domain logic.

### Priority 3: Migrate incrementally by domain

1. Start with one high-churn domain (`scheduler` or `email-watcher`) and move it to `src/domains/<domain>/...`.
2. Migrate `types` and `repo` first, then `service`, then runtime adapters.
3. Preserve existing behavior with adapter shims until each domain cutover is complete.

### Priority 4: Keep fallback power while containing drift

1. Keep `general-agent` as an explicit escape hatch.
2. Add planner/runtime rules that prefer specialized agents and require reason logging when general-agent is selected.
3. Track general-agent usage in quality scoring so boundary erosion is visible.

---

## Request Processing Flow

### Two-Phase Processing

| Phase | Duration | What Happens |
|-------|----------|--------------|
| **Sync** | <5s | Validate Twilio signature → Classifier LLM call (512 tokens, no tools) → Return TwiML with immediate reply |
| **Async** | Up to 5 min | Download media → Upload to Drive + Pre-analyze via Gemini (parallel) → Create plan → Execute agents → Compose response → Send SMS/WhatsApp |

### Classification

The classifier (`src/services/anthropic/classification.ts`) is a fast LLM call that determines routing:

- Uses Claude with max 512 tokens, no tools enabled
- Only considers last 4 conversation messages
- Returns `{needsAsyncWork: boolean, immediateResponse: string}`
- Simple requests (greetings, thanks) get a direct reply; everything else spawns async work

### Sequence: Inbound Message

```
User ──SMS──▶ Twilio ──POST──▶ /webhook/sms
                                    │
                         classifyMessage() → fast reply via TwiML
                                    │
                         needsAsyncWork? (always true for media)
                                    │ yes
                                    ▼
                        processMediaAttachments()
                                    │
                          downloadAllMedia()
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                  uploadBuffersToDrive()  preAnalyzeMedia()
                    (Google Drive)        (Gemini Vision)
                         └──────────┬──────────┘
                                    ▼
                         handleWithOrchestrator()
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
               createPlan()    executeStep()   synthesizeResponse()
                    │               │               │
                    ▼               ▼               ▼
           LLM: choose +     Agent + tools    LLM: compose
           <current_media>    (loop)          user reply
              agents                               │
                                                    ▼
                                           Twilio sendSms()
```

---

## Orchestrator

The orchestrator (`src/orchestrator/`) is the central coordination system.

### Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **orchestrate()** | `orchestrate.ts` | Main loop: plan → execute → replan → compose |
| **createPlan()** | `planner.ts` | LLM call to decompose request into agent steps |
| **executeStep()** | `executor.ts` | Routes a step to the correct agent via the router |
| **replan()** | `replanner.ts` | Adjusts plan when steps fail (up to 3 replans) |
| **synthesizeResponse()** | `response-composer.ts` | LLM call to produce the final user-facing reply |
| **handler.ts** | `handler.ts` | Integration layer between SMS route and orchestrator |
| **conversation-window.ts** | `conversation-window.ts` | Sliding window filter for conversation history |

### Execution Flow

1. **Plan**: LLM analyzes the request, selects agents, resolves dates, outputs JSON plan
2. **Execute**: Steps run sequentially; each step calls an agent via the router
3. **Replan**: If a step fails (after retries), the LLM creates a revised plan
4. **Compose**: All step results are synthesized into a single SMS-friendly response

### Limits

| Constraint | Value | Purpose |
|------------|-------|---------|
| Max execution time | 5 minutes | Prevent runaway requests |
| Max replans | 3 | Avoid infinite replan loops |
| Max total steps | 10 | Cap plan complexity |
| Max retries per step | 2 | Retry before replanning |
| Per-step timeout | 2 minutes | Prevent stuck agents |

### Conversation Window

History is filtered through a sliding window before being passed to the planner:

| Filter | Default | Purpose |
|--------|---------|---------|
| Max age | 24 hours | Only recent context |
| Max messages | 20 | Cap history length |
| Max tokens | 4000 | Fit within prompt budget |

Token estimation uses ~3.3 chars/token (closer to Claude's actual tokenization than the common 4 chars/token).

---

## Agent System

### Agent Registry

Agents are registered in `src/agents/index.ts` and looked up via `src/executor/registry.ts`. The planner selects agents by name; the router dispatches execution.

### Agents

| Agent | Tools | Purpose |
|-------|-------|---------|
| **calendar-agent** | `get_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `resolve_date` | Google Calendar CRUD |
| **scheduler-agent** | `create_scheduled_job`, `list_scheduled_jobs`, `update_scheduled_job`, `delete_scheduled_job`, `resolve_date` | Reminders and recurring jobs |
| **email-agent** | `get_emails`, `read_email`, `get_email_thread`, `create_email_skill`, `list_email_skills`, `update_email_skill`, `delete_email_skill`, `toggle_email_watcher`, `test_email_skill` | Gmail search/read + email skill management |
| **memory-agent** | `extract_memory`, `list_memories`, `update_memory`, `remove_memory` | Explicit user fact management |
| **drive-agent** | `upload_to_drive`, `list_drive_files`, `create_drive_folder`, `read_drive_file`, `search_drive`, `get_hermes_folder`, `create_spreadsheet`, `read_spreadsheet`, `write_spreadsheet`, `append_to_spreadsheet`, `find_spreadsheet`, `create_document`, `read_document`, `append_to_document`, `find_document`, `analyze_image` | Google Drive, Sheets, Docs, and Vision |
| **ui-agent** | `generate_ui` | Generate interactive HTML pages (no network access) |
| **general-agent** | `*` (all tools) | Fallback for anything that doesn't fit a specialized agent |

### Agent Execution

All agents share the same execution engine (`src/executor/tool-executor.ts`):

1. Build agent-specific system prompt with context (time, user config, previous results)
2. Call Claude with the agent's allowed tools
3. Handle tool call loop (up to 10 iterations)
4. Return `StepResult` with success/failure, output, and tool calls made

### Agent Selection

The planner LLM chooses agents based on:
- Agent descriptions and examples (injected into the planning prompt)
- Rules in the planning prompt (e.g., "use specialized agents over general-agent")
- Data flow rules (e.g., "fetch data with one agent, then pass to ui-agent to render")

---

## Tool Registry

All tools are defined in `src/tools/index.ts` with a consistent pattern:

```
ToolDefinition = { tool: Tool (Anthropic schema), handler: ToolHandler }
```

### Tool Categories

| Category | Tools | Notes |
|----------|-------|-------|
| **Calendar** | get/create/update/delete events, resolve_date | Full CRUD via Google Calendar API |
| **Email** | get_emails, read_email, get_email_thread | Read-only Gmail access |
| **Email Skills** | create/list/update/delete email skills, toggle watcher, test skill | Email watcher skill management |
| **Memory** | extract/list/update/remove memory | User fact management |
| **Scheduler** | create/list/update/delete scheduled jobs | Reminders and recurring tasks |
| **Drive** | upload, list, create folder, read, search, get Hermes folder | Google Drive file management |
| **Sheets** | create/read/write/append/find spreadsheet | Google Sheets operations |
| **Docs** | create/read/append/find document | Google Docs operations |
| **Vision** | analyze_image | Gemini Vision for OCR and image analysis |
| **UI** | generate_ui | HTML page generation |
| **Config** | set_user_config, delete_user_data | User preferences |
| **Maps** | format_maps_link | Google Maps link formatting |

### Read-Only Tools

A subset of tools is designated read-only for use in scheduled job execution:
`get_calendar_events`, `resolve_date`, `get_emails`, `read_email`, `get_email_thread`, `format_maps_link`

---

## Memory System

### Two-Track Memory

| Track | When | How |
|-------|------|-----|
| **Explicit** | User says "remember that..." | memory-agent invoked via orchestrator |
| **Background** | Every 5 minutes | Async processor extracts facts from unprocessed conversations |

### Background Processor (`src/services/memory/processor.ts`)

1. Polls for unprocessed conversation messages (FIFO, per-user capped)
2. Groups messages by phone number
3. For each user: loads existing facts, builds extraction prompt, calls Claude
4. Parses extracted facts, deduplicates, stores new ones
5. Reinforces existing facts (bumps confidence +0.1) when re-mentioned
6. Marks messages as processed (failed batches retry next cycle)

### Confidence Model

| Score | Meaning |
|-------|---------|
| 0.3 | Weak single inference |
| 0.4–0.5 | Single observation |
| 0.6 | Emerging pattern (threshold for "established fact") |
| 0.7–0.8 | Solid pattern |
| 0.9 | Repeatedly confirmed |
| 1.0 | Explicit user request |

**Established facts** (≥0.6) are prioritized in prompt injection and never auto-deleted.
**Observations** (<0.6) may be deleted after 180 days if not reinforced.

### Fact Injection

Facts are injected into agent prompts via `ranking.ts`:
1. Sort by confidence (descending), then recency
2. Add established facts first, then fill remaining space with observations
3. Cap at 4000 characters total

### Storage

SQLite table `user_facts` in `data/memory.db`:
- `id`, `phone_number`, `fact`, `category`, `confidence`, `source_type`, `evidence`, `last_reinforced_at`, `extracted_at`

---

## Scheduler System

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **Poller** | `poller.ts` | Runs every 30 seconds, finds due jobs |
| **Executor** | `executor.ts` | Runs the job's prompt through Claude with read-only tools, sends SMS |
| **SQLite Store** | `sqlite.ts` | CRUD for scheduled_jobs table |
| **Parser** | `parser.ts` | Converts natural language schedules to cron expressions or timestamps |

### Job Types

| Type | Storage | After Run |
|------|---------|-----------|
| **One-time** | `nextRunAt` timestamp | Deleted |
| **Recurring** | `cronExpression` + `timezone` | Updated with next run time |

### Cron Handling

Uses `croner` library with timezone support for DST-safe recurring schedules:
```
"every weekday at 8am" → cron: "0 8 * * 1-5" + timezone: "America/Los_Angeles"
```

### Schedule Parser

The parser (`src/services/scheduler/parser.ts`) converts natural language to:
- **Recurring**: detected by keywords like "daily", "every week", etc. → cron expression
- **One-time**: anything else (e.g., "tomorrow at 9am") → Unix timestamp via `resolveDate()`

---

## Email Watcher System

The email watcher is a background service that monitors incoming emails via Gmail polling, classifies them against user-defined **skills**, and executes actions (logging to spreadsheets or sending notifications). Skills are data, not code — users can create new processing behaviors at runtime via SMS.

### Background Processes

| Process | Interval | Purpose |
|---------|----------|---------|
| Scheduler poller | 30 seconds | Find and execute due scheduled jobs |
| Memory processor | 5 minutes | Extract facts from unprocessed conversations |
| Email watcher poller | 60 seconds | Monitor incoming emails, classify against skills, execute actions |

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **Poller** | `index.ts` | `startEmailWatcher()` / `stopEmailWatcher()` lifecycle, iterates users |
| **Sync** | `sync.ts` | Gmail `history.list` incremental fetch, email normalization |
| **Classifier** | `classifier.ts` | Haiku LLM call to match emails against active skills |
| **Actions** | `actions.ts` | Action router: `execute_with_tools` or `notify` |
| **Skills** | `skills.ts` | Load/seed per-user default skills, manage definitions |
| **Prompt** | `prompt.ts` | Classifier prompt construction from active skills |
| **SQLite Store** | `sqlite.ts` | CRUD for `email_skills` table |
| **Types** | `types.ts` | `IncomingEmail`, `EmailSkill`, `ClassificationResult`, etc. |

### Two-Phase Processing

| Phase | What Happens | LLM Cost |
|-------|--------------|----------|
| **Classify** | Haiku classifies email against all active skills, extracts data | 1 call per batch (up to 5 emails) |
| **Execute** | For each matched skill above confidence threshold, run action | 1 call per `execute_with_tools` match; 0 for `notify` |

Most emails (~90%) match no skills and stop at Phase 1.

### Gmail Sync

Uses Gmail's `history.list` API with `historyId` as an incremental cursor:

1. **First run**: Call `users.getProfile()` to get current `historyId` — establishes baseline, no processing
2. **Subsequent runs**: Fetch history changes since last `historyId`, filter to INBOX `messageAdded` events
3. **Normalization**: Prefer `text/plain` body, strip HTML/base64, collapse whitespace, truncate to 5000 chars

If `historyId` expires (~30 days of inactivity), the watcher resets from `users.getProfile()` and notifies the user.

### Skill System

Skills define what emails to watch for and what to do when they match:

```
EmailSkill {
  name, description, matchCriteria, extractFields[],
  actionType: 'execute_with_tools' | 'notify',
  actionPrompt, tools[], enabled
}
```

Three default skills are seeded per-user when the watcher is initialized:

| Skill | Matches | Action |
|-------|---------|--------|
| **tax-tracker** | W-2, 1099, IRS correspondence, property tax | Append to per-year "Tax Documents" spreadsheet |
| **expense-tracker** | Receipts, invoices, purchase confirmations | Append to per-year "Expenses" spreadsheet |
| **invite-detector** | Calendar invitations, meeting requests | Send SMS notification |

Users can create additional skills at runtime via SMS (e.g., "Start tracking job application emails in a spreadsheet"). Skills flow through the email-agent's `create_email_skill` tool.

### Action Types

| Type | Execution | Example |
|------|-----------|---------|
| `execute_with_tools` | Calls `executeWithTools()` with the skill's action prompt + drive-agent tools | Append row to spreadsheet |
| `notify` | Sends SMS/WhatsApp with classifier-generated summary | "New calendar invite from..." |

When an email matches multiple skills, all `execute_with_tools` actions run sequentially, then notification summaries are merged into a single SMS per email.

### Notification Throttling

Max 10 SMS notifications per user per hour (configurable). Tracked via in-memory counter. Excess notifications are silently dropped with a log warning.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `EMAIL_WATCHER_ENABLED` | `true` | Enable/disable the email watcher |
| `EMAIL_WATCHER_INTERVAL_MS` | `60000` | Polling interval in milliseconds |
| `EMAIL_WATCHER_MODEL_ID` | `claude-haiku-4-5-20251001` | Classifier model |
| `EMAIL_WATCHER_BATCH_SIZE` | `20` | Max emails to process per poll cycle |
| `EMAIL_WATCHER_MAX_NOTIFICATIONS_PER_HOUR` | `10` | SMS notification throttle per user |
| `EMAIL_WATCHER_CONFIDENCE_THRESHOLD` | `0.6` | Minimum confidence for skill match + action execution |

---

## Date Resolution

The date resolver (`src/services/date/resolver.ts`) converts natural language dates to structured results.

### Libraries

- **chrono-node**: Natural language date parsing
- **Luxon**: Timezone-aware date math and formatting

### Functions

| Function | Purpose |
|----------|---------|
| `resolveDate()` | Single date/time → `{timestamp, iso, formatted, components}` |
| `resolveDateRange()` | Ranges and periods → `{start, end, granularity}` |
| `isValidTimezone()` | Validate IANA timezone string |
| `formatInTimezone()` | Format a date in the user's timezone |

### Period Support

`resolveDateRange` handles: today, tomorrow, yesterday, this/next/last week, this/next/last month, explicit ranges ("from X to Y", "between X and Y"), and chrono-detected ranges.

### Forward-Date Behavior

By default, ambiguous inputs (like "Monday" or "3pm") resolve to future dates. Explicit dates (like "2026-02-04") are accepted even if in the past.

---

## Data Storage

All persistent data uses **SQLite** via `better-sqlite3`. Three separate database files:

### `data/credentials.db`

| Table | Key Columns |
|-------|-------------|
| `credentials` | `phone_number` (PK), encrypted OAuth tokens |
| `scheduled_jobs` | `id`, `phone_number`, `prompt`, `cron_expression`, `timezone`, `next_run_at`, `is_recurring`, `channel` |
| `user_config` | `phone_number` (PK), `name`, `timezone`, `email_watcher_history_id`, `email_watcher_enabled` |
| `email_skills` | `id`, `phone_number`, `name`, `match_criteria`, `extract_fields` (JSON), `action_type`, `action_prompt`, `tools` (JSON), `enabled`, `created_at`, `updated_at` — UNIQUE(`phone_number`, `name`) |

### `data/conversation.db`

| Table | Key Columns |
|-------|-------------|
| `conversation_messages` | `id`, `phone_number`, `role`, `content`, `channel`, `created_at`, `memory_processed`, `media_attachments` |
| `conversation_message_metadata` | `id`, `message_id` (FK), `phone_number`, `kind`, `payload_json` |

### `data/memory.db`

| Table | Key Columns |
|-------|-------------|
| `user_facts` | `id`, `phone_number`, `fact`, `category`, `confidence`, `source_type`, `evidence`, `last_reinforced_at`, `extracted_at` |

### Production Storage

On Railway, databases are stored at `/app/data/` via a persistent volume mount (configured in `railway.toml`).

---

## External Integrations

### Twilio

| Direction | Method | Purpose |
|-----------|--------|---------|
| Inbound | POST webhook | Receive SMS/WhatsApp messages |
| Media | GET (authenticated) | Download MMS/WhatsApp attachments |
| Outbound | REST API | Send SMS/WhatsApp responses |

### Google APIs (OAuth2)

| API | Scope | Operations |
|-----|-------|------------|
| Calendar | `calendar.events` | CRUD events |
| Gmail | `gmail.readonly` | Search and read emails |
| Drive | `drive.file` | Upload files, manage Hermes folder |
| Sheets | `spreadsheets` | Create and update spreadsheets |
| Docs | `documents` | Create and update documents |

### Google Gemini

Used for image analysis via `@google/generative-ai`:
- Model: `gemini-2.5-flash` (configurable)
- OCR for receipts and documents
- Content classification and data extraction

### Anthropic Claude

| Use | Model | Max Tokens |
|-----|-------|------------|
| Classification | claude-opus-4-5 | 512 |
| Planning | claude-opus-4-5 | 1024 |
| Plan repair | claude-opus-4-5 | 1024 |
| Agent execution | claude-opus-4-5 | 2048 |
| Response composition | claude-opus-4-5 | 512 |
| Memory extraction | claude-opus-4-5 | 1024 |
| Email classification | claude-haiku-4-5 | 2048 |

---

## UI Generation

The UI agent generates self-contained HTML/CSS/JS pages for rich interactions (lists, forms, calculators, dashboards).

### Flow

1. Agent generates HTML via the `generate_ui` tool
2. HTML is validated by `src/services/ui/validator.ts`
3. Page is stored locally (`data/pages/`) with a short URL
4. Short URL is sent to the user via SMS

### Constraint

The ui-agent has **no network access** — it can only render data passed to it from previous agent steps. For live data (calendar events, emails), a two-step plan is needed: fetch with a data agent, then render with ui-agent.

### Storage Providers

- **Local** (default): Files on disk at `data/pages/`
- **S3** (optional): AWS S3 bucket for production

---

## Media Handling

### Inbound Media Flow

1. Twilio webhook includes `MediaUrl0` for MMS/WhatsApp images
2. `processMediaAttachments()` downloads from Twilio once (shared buffer pool)
3. Two parallel operations via `Promise.all`:
   - **Drive upload** — file uploaded to Google Drive (Hermes folder)
   - **Pre-analysis** — Gemini Vision produces a compact summary + category per image
4. Metadata stored in `conversation_messages.media_attachments`
5. Pre-analysis summaries injected into planner prompt as `<current_media>` XML block
6. Drive agent can do deeper analysis via Gemini Vision tool if needed
7. Pre-analysis is used only for current-turn planning (no persistence in V1)

### Media-First Intent Resolution

When the user sends media (images), the planner receives structured `<current_media>` context with per-attachment summaries. Three prompt rules govern how the planner interprets media:

| Rule | Behavior |
|------|----------|
| **Intent precedence** | (1) explicit user text → (2) current-turn media → (3) prior conversation history |
| **Deictic resolution** | "this", "that", "it" bind to `<current_media>` attachments before conversation history |
| **Image-only clarification** | If the user sends only an image with no text and the category is ambiguous, the planner emits a general-agent step that asks a clarification question |

### Pre-Analysis Pipeline

- **Service**: `src/services/media/pre-analyze.ts`
- **Model**: Gemini Vision (configurable via `GEMINI_MODEL`)
- **Timeout budget**: 5s per image (`MEDIA_PRE_ANALYSIS_TIMEOUT_MS`), 8s total (hardcoded)
- **Output**: `CurrentMediaSummary[]` — `{attachment_index, mime_type, category?, summary}`
- **Categories**: `receipt | data_table | chart | screenshot | photo | document | unknown`
- **Max summaries**: 5 (hardcoded), each capped at 300 chars (hardcoded)
- **Graceful degradation**: Timeouts, Gemini errors, or disabled feature → empty array (hint-only path)
- **Feature flag**: `MEDIA_FIRST_PLANNING_ENABLED` (default: true)

---

## File Structure

```
src/
├── index.ts                    # Express server, startup, graceful shutdown
├── config.ts                   # All env var loading and validation
├── conversation.ts             # Legacy conversation helper
├── twilio.ts                   # Twilio SDK wrapper
│
├── routes/
│   ├── sms.ts                  # SMS/WhatsApp webhook (two-phase handler)
│   ├── auth.ts                 # Google OAuth callback
│   ├── health.ts               # GET /health
│   └── pages.ts                # Serve generated UI pages
│
├── admin/
│   ├── index.ts                # Admin route registration
│   ├── memory.ts               # Admin memory management UI
│   └── email-skills.ts         # Admin email skills API handlers
│
├── orchestrator/
│   ├── orchestrate.ts          # Main orchestration loop
│   ├── planner.ts              # LLM plan creation + date resolution
│   ├── executor.ts             # Step execution + replan detection
│   ├── replanner.ts            # Dynamic replanning
│   ├── response-composer.ts    # Final response synthesis
│   ├── handler.ts              # SMS ↔ orchestrator integration
│   ├── conversation-window.ts  # History sliding window
│   ├── media-context.ts        # Media context XML builders for prompts
│   └── types.ts                # Plan/step/context types + limits
│
├── executor/
│   ├── registry.ts             # Agent capability registry
│   ├── router.ts               # Agent dispatch by name
│   ├── tool-executor.ts        # Shared LLM + tool loop engine
│   └── types.ts                # StepResult, AgentCapability, etc.
│
├── agents/
│   ├── index.ts                # Agent array + re-exports
│   ├── calendar/               # Calendar agent (index.ts, prompt.ts)
│   ├── scheduler/              # Scheduler agent
│   ├── email/                  # Email agent
│   ├── memory/                 # Memory agent
│   ├── drive/                  # Drive/Sheets/Docs/Vision agent
│   ├── ui/                     # UI generation agent
│   └── general/                # Fallback general agent
│
├── tools/
│   ├── index.ts                # Tool registry, TOOLS array, executeTool()
│   ├── types.ts                # ToolDefinition, ToolHandler, ToolContext
│   ├── calendar.ts             # Calendar tool definitions + handlers
│   ├── scheduler.ts            # Scheduler tool definitions + handlers
│   ├── email.ts                # Email tool definitions + handlers
│   ├── memory.ts               # Memory tool definitions + handlers
│   ├── drive.ts                # Drive tool definitions + handlers
│   ├── sheets.ts               # Sheets tool definitions + handlers
│   ├── docs.ts                 # Docs tool definitions + handlers
│   ├── vision.ts               # Vision/image analysis tool
│   ├── ui.ts                   # UI generation tool
│   ├── user-config.ts          # User config tools
│   ├── maps.ts                 # Maps link formatting
│   ├── email-skills.ts         # Email skill management tools
│   └── utils.ts                # Shared tool utilities
│
├── services/
│   ├── anthropic/              # Claude API
│   │   ├── client.ts           # SDK wrapper
│   │   ├── classification.ts   # Fast message classifier
│   │   ├── types.ts            # ClassificationResult, etc.
│   │   └── prompts/            # Prompt templates
│   │       ├── system.ts       # System prompt builder
│   │       ├── classification.ts # Classification prompt
│   │       ├── context.ts      # Time/user context builders
│   │       └── index.ts        # Prompt exports
│   │
│   ├── google/                 # Google API clients
│   │   ├── auth.ts             # OAuth2 flow
│   │   ├── calendar.ts         # Calendar API
│   │   ├── gmail.ts            # Gmail API
│   │   ├── drive.ts            # Drive API
│   │   ├── sheets.ts           # Sheets API
│   │   ├── docs.ts             # Docs API
│   │   └── vision.ts           # Gemini Vision API
│   │
│   ├── scheduler/              # Job scheduling
│   │   ├── index.ts            # Init + exports
│   │   ├── poller.ts           # 30-second polling loop
│   │   ├── executor.ts         # Job execution (LLM + send SMS)
│   │   ├── parser.ts           # Natural language → cron/timestamp
│   │   ├── sqlite.ts           # Job CRUD
│   │   └── types.ts            # ScheduledJob, CreateJobInput
│   │
│   ├── memory/                 # User memory
│   │   ├── index.ts            # Store initialization
│   │   ├── sqlite.ts           # SQLite store (user_facts table)
│   │   ├── processor.ts        # Background extraction processor
│   │   ├── ranking.ts          # Confidence sorting + char-cap selection
│   │   ├── prompts.ts          # Extraction prompt builder
│   │   └── types.ts            # UserFact, MemoryStore
│   │
│   ├── conversation/           # Message history
│   │   ├── index.ts            # Store initialization
│   │   ├── sqlite.ts           # SQLite store (messages + metadata)
│   │   └── types.ts            # ConversationMessage, etc.
│   │
│   ├── credentials/            # OAuth token storage
│   │   ├── index.ts            # Factory (sqlite vs memory)
│   │   ├── sqlite.ts           # Encrypted token storage
│   │   ├── memory.ts           # In-memory store (tests)
│   │   └── types.ts            # CredentialStore interface
│   │
│   ├── user-config/            # User preferences
│   │   ├── index.ts            # Store initialization
│   │   ├── sqlite.ts           # SQLite store
│   │   └── types.ts            # UserConfig
│   │
│   ├── email-watcher/          # Email watcher service
│   │   ├── index.ts            # Start/stop lifecycle (createIntervalPoller)
│   │   ├── sync.ts             # Gmail history sync (incremental fetch)
│   │   ├── classifier.ts       # LLM classification against active skills
│   │   ├── actions.ts          # Action router (execute_with_tools, notify)
│   │   ├── skills.ts           # Load/seed per-user default skills
│   │   ├── prompt.ts           # Classifier prompt construction
│   │   ├── sqlite.ts           # EmailSkillStore (email_skills table)
│   │   └── types.ts            # IncomingEmail, EmailSkill, ClassificationResult
│   │
│   ├── date/                   # Date resolution
│   │   ├── index.ts            # Re-exports
│   │   └── resolver.ts         # chrono-node + Luxon resolver
│   │
│   ├── media/                  # Media handling
│   │   ├── index.ts            # Exports
│   │   ├── upload.ts           # Twilio download + Drive upload
│   │   ├── pre-analyze.ts      # Gemini pre-analysis (summary + category)
│   │   └── process.ts          # Combined download → upload + pre-analyze
│   │
│   ├── ui/                     # UI page generation
│   │   ├── index.ts            # Exports
│   │   ├── generator.ts        # HTML generation
│   │   ├── validator.ts        # HTML validation
│   │   ├── provider-factory.ts # Storage provider selection
│   │   └── providers/          # Local storage, memory shortener
│   │
│   └── twilio/
│       └── media.ts            # Twilio media download
│
└── utils/
    └── trace-logger.ts         # Request tracing and debug logging

tests/
├── setup.ts                    # Global test setup
├── mocks/                      # Anthropic, Twilio, Google Calendar mocks
├── fixtures/                   # Webhook payloads
├── helpers/                    # Test app factory, mock HTTP
├── unit/                       # Unit tests (by feature)
│   ├── date/
│   ├── tools/
│   ├── agents/
│   ├── orchestrator/
│   ├── executor/
│   ├── scheduler/
│   ├── services/
│   └── admin/
└── integration/                # Integration tests (webhook, calendar, LLM)
```
