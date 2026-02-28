# Architecture

System design for Hermes Assistant — an SMS/WhatsApp personal assistant powered by Claude and Google Workspace.

## Table of Contents

1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Forward-Only Layered Architecture (Enforced)](#forward-only-layered-architecture-enforced)
4. [Enforcement Scripts](#enforcement-scripts)
5. [Request Processing Flow](#request-processing-flow)
6. [Orchestrator](#orchestrator)
7. [Agent System](#agent-system)
8. [Tool Registry](#tool-registry)
9. [Memory System](#memory-system)
10. [Scheduler System](#scheduler-system)
11. [Email Watcher System](#email-watcher-system)
12. [Date Resolution](#date-resolution)
13. [Data Storage](#data-storage)
14. [External Integrations](#external-integrations)
15. [UI Generation](#ui-generation)
16. [Media Handling](#media-handling)
17. [File Structure](#file-structure)

---

## System Overview

Hermes is a multi-agent assistant that receives messages via Twilio (SMS/WhatsApp), plans and executes tasks using specialized agents, and replies via SMS. It integrates with Google Calendar, Gmail, Drive, Sheets, Docs, and Gemini Vision.

### Key Design Principles

- **Always-orchestrate**: Every message routes through the orchestrator for deep processing. WhatsApp skips the classifier entirely (typing indicator provides UX feedback); SMS retains a fast classifier call for an immediate ack but always runs async processing regardless of classification result
- **Agent orchestration**: An LLM planner decomposes requests into steps and delegates to specialized agents
- **Tool isolation**: Each agent has access to only the tools it needs
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
│  Webhook ──▶ Orchestrator ──▶ Agents ──▶ Compose     │  │  Classify ──▶ Actions  │
│  (always)    (planner)       (execute)   (reply)     │  │  (Haiku)    (tools/SMS)│
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

## Forward-Only Layered Architecture (Enforced)

This repository enforces **forward-only import direction** at two levels: between top-level slices and within each business domain. These rules are **mechanically enforced** — a custom boundary checker runs in CI and locally via `npm run lint:architecture`, and the build fails on any violation.

### Why Forward-Only?

Forward-only means imports flow in one direction: from pure data shapes at the bottom toward executable entry points at the top. This prevents circular dependencies, keeps layers independently testable, and makes the impact of any change predictable — a change in `types` can ripple forward, but a change in `runtime` cannot break `service` or `repo`.

### Two Levels of Enforcement

The forward-only principle applies at both the **top-level slice** level and the **within-domain layer** level:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         src/                                        │
│                                                                     │
│  Top-level slices (enforced by "forbidden" rules):                  │
│                                                                     │
│    routes/  admin/           ← HTTP handlers (top)                  │
│         │                                                           │
│         ▼                                                           │
│    orchestrator/  executor/  registry/   ← App wiring               │
│         │                                                           │
│         ▼                                                           │
│    tools/                    ← Tool definitions                     │
│         │                                                           │
│         ▼                                                           │
│    services/                 ← Shared business services             │
│         │                                                           │
│         ▼                                                           │
│    providers/  types/  utils/  config.ts  ← Shared infrastructure   │
│                                                                     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                                                     │
│    domains/                  ← Domain packages (internal 7-layer    │
│      ├── calendar/             model enforced per domain)           │
│      ├── scheduler/                                                 │
│      ├── memory/               Each domain: types → config → repo   │
│      └── ...                   → providers → service → runtime → ui │
│                                                                     │
│  Domains import shared infrastructure (↑) but never app wiring.     │
│  App wiring imports domains, not the reverse.                       │
└─────────────────────────────────────────────────────────────────────┘

  Arrows = allowed import direction. Everything else is a violation.
```

### Top-Level Slice Rules

The top-level directories under `src/` follow their own forward-only constraints. These are enforced as **forbidden edges** — specific cross-slice imports that are always violations:

| From | To | Why |
|------|----|-----|
| `src/services/` | `src/tools/` | Services are lower-level; pass tool dependencies via function params |
| `src/services/` | `src/routes/` | Services cannot reach up to HTTP handlers |
| `src/services/` | `src/orchestrator/` | Services cannot reach into orchestrator wiring |
| `src/tools/` | `src/routes/` | Tools cannot reach up to HTTP handlers |

The top-level slices and their responsibilities:

| Slice | Layer role | What goes here |
|-------|-----------|----------------|
| `types/`, `providers/`, `utils/`, `config.ts` | Shared infrastructure (bottom) | Pure types (`MediaAttachment`, `DomainCapability`), cross-cutting adapters (`AuthRequiredError`, `generateAuthUrl`), utilities (`Poller`, phone formatting) |
| `services/` | Shared business services | Date resolution, credential storage, conversation history, Anthropic client, user config, media pipeline, UI page storage |
| `tools/` | Tool registry | Aggregates tool definitions from all domains, shared tools (maps, user-config) |
| `executor/` | Agent execution engine | Tool executor, agent router, agent registry lookup |
| `orchestrator/` | Request orchestration | Planner, replanner, response composer, conversation window |
| `registry/` | Agent/tool wiring | Centralized agent registry (imports from domains) |
| `routes/`, `admin/` | HTTP handlers (top) | SMS webhook, OAuth callback, health check, admin APIs |

### Within-Domain Layer Rules

Each business domain under `src/domains/<domain>/` follows the canonical 7-layer model. Dependencies within a domain must move in one direction only:

```
                              ┌──────────┐
                              │    UI    │  Leaf layer: HTML rendering
                              └────┬─────┘
                                   │ imports
                              ┌────▼─────┐
                              │ Runtime  │  Tool adapters, agents, pollers, HTTP handlers
                              └────┬─────┘
                                   │ imports
                              ┌────▼─────┐
                              │ Service  │  Business logic, orchestration
                              └────┬─────┘
                                   │ imports
                    ┌──────────────┼──────────────┐
                    │              │              │
               ┌────▼─────┐  ┌────▼─────┐  ┌────▼──────┐
               │   Repo   │  │Providers │  │  (skip)   │
               │  (data)  │  │ (bridges)│  │           │
               └────┬─────┘  └────┬─────┘  └───────────┘
                    │              │
                    └──────┬───────┘
                           │ imports
                      ┌────▼─────┐
                      │  Config  │  Constants, validated settings
                      └────┬─────┘
                           │ imports
                      ┌────▼─────┐
                      │  Types   │  Pure data shapes, DTOs, value objects
                      └──────────┘

  Arrow direction = "imports from". Flow is always downward (forward-only).
  Same-layer imports are allowed (e.g., runtime/agent.ts → runtime/prompt.ts).
```

### Allowed Imports Matrix

Each layer can only import from layers below it (or same-layer peers):

| Layer | Can import from | Cannot import from |
|-------|----------------|--------------------|
| `types` | *(nothing)* | everything else |
| `config` | `types` | `repo`, `providers`, `service`, `runtime`, `ui` |
| `repo` | `types`, `config`, `providers` | `service`, `runtime`, `ui` |
| `providers` | `types`, `config` | `repo`, `service`, `runtime`, `ui` |
| `service` | `types`, `config`, `repo`, `providers` | `runtime`, `ui` |
| `runtime` | `types`, `config`, `repo`, `service`, `providers` | `ui` |
| `ui` | `types`, `service` | `config`, `repo`, `providers`, `runtime` |

### Domain Package Template

Not every domain uses every layer. A domain includes only the layers it needs.

```
src/domains/<domain>/
├── types.ts            # Pure data shapes (required)
├── capability.ts       # Domain metadata: exposure, agentId, tools (required)
├── config/             # Constants, feature flags (optional)
├── repo/               # Persistence / data access (optional)
├── providers/          # Bridges to cross-cutting systems and other domains (optional)
├── service/            # Business rules and workflow logic (optional)
├── runtime/            # Agents, tool definitions, pollers, handlers (optional)
└── ui/                 # HTML/UI rendering (optional)
```

### Layer Responsibilities

| Layer | What goes here | Domain examples | Top-level equivalent |
|-------|---------------|-----------------|---------------------|
| `types` | Pure data shapes, DTOs, value objects, enums | `ScheduledJob`, `EmailSkill`, `UserFact` | `src/types/` (`MediaAttachment`, `DomainCapability`) |
| `config` | Domain-specific constants and validated settings | Polling intervals, confidence thresholds | `src/config.ts` |
| `repo` | Persistence — data read/write | `SqliteJobStore`, `SqliteMemoryStore` | `src/services/credentials/`, `src/services/conversation/` |
| `providers` | Adapters/bridges for cross-cutting systems and other domains | `providers/google-core.ts`, `providers/executor.ts` | `src/providers/` (`AuthRequiredError`, `generateAuthUrl`) |
| `service` | Business logic and orchestration | Schedule parser, memory processor, email classifier | `src/services/` (date resolver, Anthropic client) |
| `runtime` | Executable entry points: tool definitions, agent configs, pollers, HTTP handlers | `runtime/tools.ts`, `runtime/agent.ts`, `runtime/index.ts` | `src/tools/`, `src/routes/`, `src/orchestrator/`, `src/executor/` |
| `ui` | HTML/UI rendering and presentation | (used only by the ui domain) | `src/admin/views/` |

### Domain Capability Metadata

Every domain declares a `capability.ts` file that exports metadata about how the domain is exposed:

```typescript
// src/types/domain.ts
type DomainExposure = 'agent' | 'tool-only' | 'internal';

interface DomainCapability {
  domain: string;
  exposure: DomainExposure;
  agentId?: string;      // Only for exposure: 'agent'
  tools?: string[];
}
```

| Exposure | Meaning | Example domains |
|----------|---------|-----------------|
| `agent` | Has its own agent + tools, registered in the agent registry | calendar, scheduler, email, memory, drive, ui |
| `tool-only` | Exposes tools but no agent (tools attached to other agents) | email-watcher |
| `internal` | Shared infrastructure consumed by other domains, no tools or agent | google-core |

### Current Domains

```
src/domains/
├── google-core/     (internal)   Shared Google OAuth2, drive folders
├── calendar/        (agent)      Google Calendar CRUD
├── scheduler/       (agent)      Scheduled jobs and reminders
├── email/           (agent)      Gmail search and read
├── email-watcher/   (tool-only)  Background email monitoring + skill management
├── memory/          (agent)      User fact extraction and management
├── drive/           (agent)      Drive, Sheets, Docs, Vision
└── ui/              (agent)      HTML page generation
```

### Cross-Domain Import Rules

Cross-domain imports are **denied by default**. Every allowed cross-domain edge must be declared in `config/architecture-boundaries.json` with a `via` constraint that restricts the import to a single provider re-export file in the consuming domain.

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   calendar   │         │    email     │         │    drive     │
│              │         │              │         │              │
│  providers/  │────────▶│              │         │  providers/  │
│  google-core │         │  providers/  │────────▶│  google-core │
│              │         │  google-core │         │              │
└──────────────┘         └──────────────┘         └──────────────┘
                                                        ▲
                                                        │
                              ┌──────────────┐          │
                              │ email-watcher │──────────┘
                              │              │   (via providers/google-core)
                              │  providers/  │
                              │  memory.ts ──│──▶ memory domain
                              │  email.ts  ──│──▶ email domain
                              └──────────────┘

                              ┌──────────────┐
                              │  scheduler   │
                              │              │
                              │  providers/  │
                              │  memory.ts ──│──▶ memory domain
                              └──────────────┘

All arrows go through a providers/*.ts file in the consuming domain.
No domain ever directly imports another domain's repo, service, or runtime.
```

### Domain ↔ Top-Level Import Rules

Domains can import from shared top-level infrastructure but are **forbidden from importing runtime wiring modules**:

| Allowed (shared infrastructure) | Forbidden (runtime wiring) |
|--------------------------------|---------------------------|
| `src/config.ts` | `src/routes/` |
| `src/providers/` | `src/orchestrator/` |
| `src/types/` | `src/executor/` |
| `src/utils/` | `src/registry/` |
| `src/twilio.ts` | |
| `src/services/date/` | |
| `src/services/credentials/` | |
| `src/services/conversation/` | |
| `src/services/anthropic/` | |
| `src/services/user-config/` | |

The boundary: **registry and orchestrator import domains, not the reverse.** This ensures domains are self-contained and testable without the full app wiring.

---

## Enforcement Scripts

The architecture is enforced by three scripts that run locally and in CI. All are zero-dependency Node scripts (no third-party linters required).

### `npm run lint:architecture` — Boundary Checker

**Script**: [check-layer-deps.mjs](scripts/check-layer-deps.mjs)
**Config**: [architecture-boundaries.json](config/architecture-boundaries.json)
**Exit code**: 0 = pass, 1 = violations found

Walks every `.ts` file under `src/`, extracts all import edges (static + dynamic, skipping type-only imports), resolves them to absolute paths, and checks four rule categories:

```
┌─────────────────────────────────────────────────────────────┐
│                   check-layer-deps.mjs                      │
│                                                             │
│  1. Top-level forbidden rules                               │
│     services→tools, services→routes, tools→routes, etc.     │
│                                                             │
│  2. Same-domain layer rules                                 │
│     Is repo importing runtime? → VIOLATION                  │
│     Is service importing types? → OK                        │
│                                                             │
│  3. Cross-domain rules                                      │
│     Is calendar importing scheduler? → VIOLATION            │
│     Is calendar importing google-core via providers? → OK   │
│                                                             │
│  4. Domain → external rules                                 │
│     Is a domain importing src/config? → OK (allowed)        │
│     Is a domain importing src/routes? → VIOLATION           │
│     Is a domain importing src/executor? → VIOLATION         │
│                                                             │
│  Modes:                                                     │
│  --strict   Warnings become violations (default in CI)      │
│  --report   Print full edge report before violations        │
│                                                             │
│  Exceptions:                                                │
│  Listed in config/architecture-boundaries.json "exceptions" │
│  (currently empty — 0 exceptions, 0 violations)             │
└─────────────────────────────────────────────────────────────┘
```

The config file (`config/architecture-boundaries.json`) contains all rules:
- `forbidden` — top-level slice-to-slice import bans
- `domainLayerRules` — the canonical layer ordering and allowed-imports matrix
- `crossDomainRules` — deny-by-default with an explicit allowlist (each entry has `from`, `to`, `via`)
- `domainExternalRules` — which top-level modules domains may/may not import
- `exceptions` — temporary allowlist for known violations with expiry dates

### `npm run lint:agents` — Agent Registry Checker

**Script**: [check-agent-registry.mjs](scripts/check-agent-registry.mjs)
**Exit code**: 0 = consistent, 1 = issues found

Validates structural consistency between domain capabilities and the agent registry:

| Check | What it verifies |
|-------|-----------------|
| Agent domains have required files | Every domain with `exposure: 'agent'` must have `runtime/agent.ts` and `runtime/prompt.ts` |
| Agent domains are registered | Every `exposure: 'agent'` domain must appear in `src/registry/agents.ts` |
| Non-agent domains are not registered | `tool-only` and `internal` domains must NOT appear in the agent registry |
| Capability files exist | Every domain under `src/domains/` must have a `capability.ts` |

This prevents drift between what a domain declares about itself and how it's wired into the system.

### `npm run docs:agents` — Agent Catalog Generator

**Script**: [generate-agent-catalog.mjs](scripts/generate-agent-catalog.mjs)
**Output**: [docs/generated/agent-catalog.md](docs/generated/agent-catalog.md)

Reads domain capabilities, agent metadata (descriptions, examples), tool definitions (names, descriptions), layer structure, and cross-domain dependencies to produce an enriched domain catalog. Each domain section includes its agent info, example prompts, active layers, cross-domain dependencies, and a tool table with descriptions.

### Summary of All Enforcement Commands

| Command | What it enforces | Fails on |
|---------|-----------------|----------|
| `npm run lint:architecture` | Forward-only layer deps, cross-domain boundaries, domain↔external rules | Any import that violates the layer matrix, crosses domains without a declared `via`, or reaches forbidden top-level modules |
| `npm run lint:agents` | Agent registry ↔ domain capability consistency | Missing `capability.ts`, missing `runtime/agent.ts` or `runtime/prompt.ts` for agent domains, registry mismatches |
| `npm run lint` | TypeScript/ESLint code quality | Standard lint errors |
| `npm run build` | TypeScript compilation | Type errors, unresolved imports |
| `npm run test:unit` | Unit test suite | Test failures |

For the full migration history, see [forward-layered-architecture-refactor.md](docs/exec-plans/active/forward-layered-architecture-refactor.md).

---

## Request Processing Flow

### Always-Orchestrate Model

Every inbound message — regardless of complexity — routes through the orchestrator. The sync phase differs by channel:

| Channel | Sync Phase | Async Phase |
|---------|-----------|-------------|
| **WhatsApp** | Return empty TwiML `<Response></Response>` immediately. Start typing indicator (dots visible in WhatsApp). No classifier call. | Download media → Upload to Drive + Pre-analyze via Gemini (parallel) → Create plan → Execute agents → Compose response → Send WhatsApp reply. Stop typing indicator in `.finally()`. |
| **SMS** | Classifier LLM call (512 tokens) → Return TwiML with immediate ack text. | Same async pipeline as WhatsApp. Classifier result is used only for ack text — it does **not** gate whether async work runs. |

### Classification (SMS only)

The classifier (`src/services/anthropic/classification.ts`) provides a fast ack for SMS:

- Uses Claude with max 512 tokens, no tools enabled
- Only considers last 4 conversation messages
- Returns `{needsAsyncWork: boolean, immediateResponse: string}`
- The `immediateResponse` is sent as the TwiML ack; `needsAsyncWork` is **ignored** — async processing always runs

### WhatsApp Typing Indicator

`src/services/twilio/typing-indicator.ts` provides UX feedback while the orchestrator processes:

- **Fire immediately** on webhook receipt (non-blocking)
- **Re-fire every 20 seconds** — WhatsApp indicators expire ~25s
- **Stop function** returned to caller — called in `.finally()` after orchestrator completes
- **Best-effort**: Errors logged but never thrown (UX polish, not critical path)
- **API**: POST to `https://messaging.twilio.com/v2/Indicators/Typing.json` with Basic Auth, body `messageId=<MessageSid>&channel=whatsapp`

### Sequence: WhatsApp Inbound Message

```
User ──WhatsApp──▶ Twilio ──POST──▶ /webhook/sms
                                         │
                              Validate Twilio signature
                              Deduplicate by MessageSid
                              Store user message
                              Return empty TwiML
                              Start typing indicator (dots)
                                         │
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
                                         │
                              updateMediaAttachments()  ← backfill storedMedia
                              persist pre-analysis      ← as message metadata
                                         │
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
                + <media_context>                       │
                   agents                               ▼
                                                Twilio sendSms()
                                                Stop typing indicator
```

### Sequence: SMS Inbound Message

```
User ──SMS──▶ Twilio ──POST──▶ /webhook/sms
                                    │
                         Validate Twilio signature
                         Deduplicate by MessageSid
                         classifyMessage() → ack text via TwiML
                         Store user message + ack
                                    │
                                    ▼  (always — not gated by needsAsyncWork)
                        processMediaAttachments()
                                    │
                          downloadAllMedia()
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                  uploadBuffersToDrive()  preAnalyzeMedia()
                    (Google Drive)        (Gemini Vision)
                         └──────────┬──────────┘
                                    │
                         updateMediaAttachments()  ← backfill storedMedia
                         persist pre-analysis      ← as message metadata
                                    │
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
           + <media_context>                       │
              agents                               ▼
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
| **media-context.ts** | `media-context.ts` | Builds `<media_context>` XML from historical image analysis metadata (capped at 10 most recent) |

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

Agents are registered in `src/registry/agents.ts` and looked up via `src/executor/registry.ts`. The planner selects agents by name; the router dispatches execution.

### Agents

| Agent | Tools | Purpose |
|-------|-------|---------|
| **calendar-agent** | `get_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `resolve_date` | Google Calendar CRUD |
| **scheduler-agent** | `create_scheduled_job`, `list_scheduled_jobs`, `update_scheduled_job`, `delete_scheduled_job`, `resolve_date` | Reminders and recurring jobs |
| **email-agent** | `get_emails`, `read_email`, `get_email_thread`, `create_email_skill`, `list_email_skills`, `update_email_skill`, `delete_email_skill`, `toggle_email_watcher`, `test_email_skill` | Gmail search/read + email skill management |
| **memory-agent** | `extract_memory`, `list_memories`, `update_memory`, `remove_memory` | Explicit user fact management |
| **drive-agent** | `upload_to_drive`, `list_drive_files`, `create_drive_folder`, `read_drive_file`, `search_drive`, `get_hermes_folder`, `create_spreadsheet`, `read_spreadsheet`, `write_spreadsheet`, `append_to_spreadsheet`, `find_spreadsheet`, `create_document`, `read_document`, `append_to_document`, `find_document`, `analyze_image` | Google Drive, Sheets, Docs, and Vision |
| **ui-agent** | `generate_ui` | Generate interactive HTML pages (no network access) |

### Agent Execution

All agents share the same execution engine (`src/executor/tool-executor.ts`):

1. Build agent-specific system prompt with context (time, user config, previous results)
2. Call Claude with the agent's allowed tools
3. Handle tool call loop (up to 10 iterations)
4. Return `StepResult` with success/failure, output, and tool calls made

### Agent Selection

The planner LLM chooses agents based on:
- Agent descriptions and examples (injected into the planning prompt)
- Rules in the planning prompt (e.g., "pick the best-fit specialized agent")
- Data flow rules (e.g., "fetch data with one agent, then pass to ui-agent to render")
- Replan loop recovery (if the first agent choice was wrong, replanning routes to a better one)

---

## Tool Registry

Tool definitions live in each domain's runtime layer (`src/domains/*/runtime/tools.ts`) and are aggregated by the central registry at `src/tools/index.ts`. Each tool follows a consistent pattern:

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

### Background Processor (`src/domains/memory/service/processor.ts`)

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

The parser (`src/domains/scheduler/service/parser.ts`) converts natural language to:
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
| `conversation_messages` | `id`, `phone_number`, `role`, `content`, `channel`, `created_at`, `memory_processed`, `media_attachments`. Note: `media_attachments` is backfilled after media processing via `updateMediaAttachments()` |
| `conversation_message_metadata` | `id`, `message_id` (FK), `phone_number`, `kind`, `payload_json`. Used for `image_analysis` metadata (pre-analysis persisted per image) |

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
| Typing indicator | POST to Messaging API v2 | Show "..." dots in WhatsApp while processing (re-fires every 20s) |

### Google APIs (OAuth2)

| API | Scope | Operations |
|-----|-------|------------|
| Calendar | `calendar.events` | CRUD events |
| Gmail | `gmail.readonly` | Search and read emails |
| Drive | `drive.file` | Upload files, manage Hermes folder |
| Sheets | `spreadsheets` | Create and update spreadsheets |
| Docs | `documents` | Create and update documents |

OAuth route hardening:
- `state` payload is encrypted and includes a one-time nonce consumed on callback
- `/auth/*` endpoints apply per-IP rate limiting

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
   - **Drive upload** — file uploaded to Google Drive (Hermes folder). Each `StoredMediaAttachment` carries `originalIndex` so downstream lookups aren't broken by skipped failures
   - **Pre-analysis** — Gemini Vision produces a compact summary + category per image
4. **Backfill**: `updateMediaAttachments()` patches the user message row with `storedMedia` (user message is stored before media processing, so `media_attachments` starts null)
5. **Persist pre-analysis**: Each summary is written as `image_analysis` metadata via `addMessageMetadata()`, ensuring the analysis survives even if `analyze_image` is never called
6. Pre-analysis summaries injected into planner prompt as `<current_media>` XML block
7. Historical media analysis (from earlier turns) injected as `<media_context>` — capped at the 10 most recent entries (`MAX_HISTORICAL_MEDIA_ENTRIES`)
8. Drive agent can do deeper analysis via Gemini Vision tool if needed — this supplements (not replaces) the pre-analysis

### Media-First Intent Resolution

When the user sends media (images), the planner receives structured `<current_media>` context with per-attachment summaries. For text-only follow-ups referencing earlier images, `<media_context>` provides historical analysis. Four prompt rules govern how the planner interprets media:

| Rule | Behavior |
|------|----------|
| **Intent precedence** | (1) explicit user text → (2) current-turn media → (3) prior conversation history |
| **Deictic resolution** | "this", "that", "it" bind to `<current_media>` attachments before conversation history |
| **Image-only clarification** | If the user sends only an image with no text and the category is ambiguous, the planner emits a memory-agent step that asks a concise clarification question |
| **Historical media routing** | If `<media_context>` exists (previous turns had images), the planner routes to the appropriate agent (usually drive-agent) rather than asking unnecessary clarification |

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
├── domains/                    # Domain packages (forward-only layered)
│   ├── google-core/            # Shared Google OAuth2 infrastructure (internal)
│   │   ├── types.ts
│   │   ├── capability.ts
│   │   ├── providers/auth.ts
│   │   └── service/drive-folders.ts
│   ├── calendar/               # Google Calendar domain
│   │   ├── types.ts, capability.ts
│   │   ├── providers/          # google-core bridge, executor injection
│   │   ├── service/            # (none currently)
│   │   └── runtime/            # agent.ts, tools.ts, prompt.ts
│   ├── scheduler/              # Scheduled jobs domain
│   │   ├── types.ts, capability.ts
│   │   ├── repo/sqlite.ts      # Job CRUD
│   │   ├── providers/          # executor, sms, memory bridges
│   │   ├── service/            # parser.ts, executor.ts
│   │   └── runtime/            # agent.ts, tools.ts, prompt.ts, index.ts
│   ├── email-watcher/          # Email watching domain (tool-only, no agent)
│   │   ├── types.ts, capability.ts
│   │   ├── repo/sqlite.ts      # EmailSkillStore
│   │   ├── providers/          # google-core, gmail-sync, executor, memory, email bridges
│   │   ├── service/            # classifier, actions, skills, prompt
│   │   └── runtime/            # tools.ts, index.ts
│   ├── email/                  # Gmail read domain
│   │   ├── types.ts, capability.ts
│   │   ├── providers/          # google-core bridge, executor, gmail service
│   │   └── runtime/            # agent.ts, tools.ts, prompt.ts
│   ├── memory/                 # User memory domain
│   │   ├── types.ts, capability.ts
│   │   ├── repo/sqlite.ts      # SqliteMemoryStore
│   │   ├── providers/executor.ts
│   │   ├── service/            # processor.ts, ranking.ts, prompts.ts, store.ts
│   │   └── runtime/            # agent.ts, tools.ts, prompt.ts, index.ts
│   ├── drive/                  # Drive/Sheets/Docs/Vision domain
│   │   ├── types.ts, capability.ts
│   │   ├── providers/          # google-core, drive, sheets, docs, vision, executor
│   │   └── runtime/            # agent.ts, tools.ts, prompt.ts
│   └── ui/                     # UI generation domain
│       ├── types.ts, capability.ts
│       ├── providers/executor.ts
│       └── runtime/            # agent.ts, tools.ts, prompt.ts
│
├── registry/
│   └── agents.ts               # Centralized agent registry (imports from domains)
│
├── routes/
│   ├── sms.ts                  # SMS/WhatsApp webhook
│   ├── auth.ts                 # Google OAuth callback
│   ├── health.ts               # GET /health
│   └── pages.ts                # Serve generated UI pages
│
├── admin/
│   ├── index.ts                # Admin route registration
│   ├── memory.ts               # Admin memory management
│   └── email-skills.ts         # Admin email skills API
│
├── orchestrator/               # Request planning and execution
│   ├── orchestrate.ts, planner.ts, executor.ts
│   ├── replanner.ts, response-composer.ts
│   ├── handler.ts, conversation-window.ts
│   ├── media-context.ts
│   └── types.ts
│
├── executor/                   # Agent execution engine
│   ├── registry.ts, router.ts
│   ├── tool-executor.ts
│   └── types.ts
│
├── providers/
│   └── auth.ts                 # Provider-agnostic auth utilities
│
├── types/
│   ├── media.ts                # MediaAttachment
│   └── domain.ts               # DomainCapability, DomainExposure
│
├── tools/
│   ├── index.ts                # Tool registry (aggregates from domains)
│   ├── types.ts                # ToolDefinition, ToolHandler, ToolContext
│   ├── maps.ts                 # Maps link formatting (shared)
│   ├── user-config.ts          # User config tools (shared)
│   └── utils.ts                # Shared tool utilities
│
├── services/
│   ├── agent-context.ts        # Shared agent prompt context builders
│   ├── anthropic/              # Claude API client
│   ├── conversation/           # Message history storage
│   ├── credentials/            # OAuth token storage
│   ├── user-config/            # User preferences
│   ├── date/                   # Date resolution
│   ├── media/                  # Media handling pipeline
│   ├── ui/                     # UI page generation service
│   └── twilio/                 # Twilio media utilities + typing indicator
│
└── utils/
    ├── poller.ts               # Shared interval poller
    ├── phone.ts                # Phone number utilities
    └── trace-logger.ts         # Request tracing
```
