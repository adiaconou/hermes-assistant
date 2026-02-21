# Enforce Forward-Only Layered Domain Architecture

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`docs/PLANS.md` is checked into this repository and is the governing standard for this document. This file must be maintained in accordance with `docs/PLANS.md`.

## Purpose / Big Picture

Today Hermes works, but its module dependencies are not consistently forward-only. The practical result is architectural drift: modules in one layer can reach across boundaries and create coupling that makes future changes slower and riskier. After this refactor, each domain will follow a strict layer order (`types -> config -> repo -> service -> runtime -> ui`) with `providers` as the only explicit ingress for cross-cutting concerns, and these rules will be mechanically enforced in CI.

A user-visible way to see this working is to run a dependency check command that fails on illegal imports and passes when boundaries are respected. A second way to see it working is to run the existing server and test suites and observe no regressions while domain packages are migrated behind compatibility adapters.

## Progress

- [x] (2026-02-20 18:25Z) Created this ExecPlan in `docs/exec-plans/active/forward-layered-architecture-refactor.md` with full scope, milestones, and validation guidance.
- [ ] Establish a baseline architecture dependency report and commit it as a tracked artifact.
- [ ] Introduce machine-enforced import boundary checks in CI with a temporary exception allowlist.
- [ ] Establish explicit agent discoverability scaffolding (`src/registry/agents.ts`, capability metadata contract, validation, generated catalog).
- [ ] Remove currently known reverse edges (`tools -> routes`, `services -> tools` hotspots) without behavior changes.
- [ ] Migrate the first domain (`scheduler`) to the layered package structure with compatibility adapters.
- [ ] Migrate the second domain (`email-watcher`) to the layered package structure with compatibility adapters.
- [ ] Migrate remaining domains or establish strict shims for deferred domains with explicit deadlines.
- [ ] Remove compatibility adapters, tighten boundary checks to strict mode, and update docs and quality grades.

## Surprises & Discoveries

- Observation: The current architecture has bidirectional import flow between major slices that are expected to be directional.
  Evidence: A static import-edge pass showed `tools -> services` and `services -> tools` edges in the same graph.

- Observation: One explicit reverse dependency already crosses runtime boundaries.
  Evidence: `src/tools/utils.ts` imports `src/routes/auth.ts`.

- Observation: Structural boundary enforcement is not currently mechanical.
  Evidence: `package.json` includes `lint: eslint src/` but no dedicated dependency-boundary check command.

- Observation: There is no ESLint config file in the repository at all. ESLint 9 flat config is in use but unconfigured. The `eslint`, `@typescript-eslint/eslint-plugin`, and `@typescript-eslint/parser` packages are installed as devDependencies.
  Evidence: No `eslint.config.*` or `.eslintrc*` file at project root. `npm run lint` runs `eslint src/` with default behavior.

- Observation: `MediaAttachment` type originates in `src/tools/types.ts` but is consumed across four layers: tools, executor, orchestrator, services (media), and routes (sms). It is a pure data shape with no tool-layer dependencies and should live in a neutral types module.
  Evidence: Import chain is `tools/types.ts` → `executor/types.ts` (re-export) → `orchestrator/types.ts` (re-export). Services import directly from `tools/types.ts`.

## Decision Log

- Decision: Refactor in phased, additive migrations with adapters instead of a single atomic directory rewrite.
  Rationale: This keeps the system runnable at every step and supports incremental verification.
  Date/Author: 2026-02-20 / Codex

- Decision: Introduce enforcement before most domain moves, but start with an explicit exception allowlist that shrinks over time.
  Rationale: Immediate strict enforcement would block progress in a codebase that already contains violations.
  Date/Author: 2026-02-20 / Codex

- Decision: Migrate `scheduler` first, then `email-watcher`.
  Rationale: Both are bounded subsystems with clear runtime entry points and tests, making them good proving grounds for the pattern.
  Date/Author: 2026-02-20 / Codex

- Decision: Use function parameters (not context objects or DI containers) for dependency injection when removing reverse edges.
  Rationale: Simplest approach, explicit about what each function needs, easy to test. Fits core beliefs (explicit over clever). No new abstractions required.
  Date/Author: 2026-02-20 / Review

- Decision: Use a custom Node script for boundary checking instead of ESLint `no-restricted-imports` or a third-party dependency like `dependency-cruiser`.
  Rationale: ESLint `no-restricted-imports` matches raw import strings, not resolved paths, so it cannot reliably enforce directory-level rules across varying relative path depths. A custom script (~100 lines) resolves paths, supports an exception allowlist with expiry dates, and produces agent-friendly error messages with remediation instructions. No new dependency.
  Date/Author: 2026-02-20 / Review

- Decision: In the target domain structure, each domain owns its tool definitions in `runtime/tools.ts`. A central `src/registry/tools.ts` aggregates all domain tools into the flat `TOOLS` array, `toolHandlers` map, and `executeTool()` function. The planner and executor import from the registry, same as today.
  Rationale: Tool definitions are runtime adapters (they map LLM tool schemas to domain service calls) and belong in each domain's runtime layer. The registry is thin app wiring that belongs at the bootstrap level. Adding a tool means editing the domain. Adding a domain means adding one import in the registry.
  Date/Author: 2026-02-20 / Review

- Decision: The `orchestrator -> tools` import edge is acceptable and should be removed from the violation list. The orchestrator is a runtime coordinator; the tool registry is a runtime aggregator. This is a lateral dependency, not a backward one. The forbidden edges are `services -> tools` and `tools -> routes`.
  Rationale: Eliminating orchestrator→tools entirely would require threading tool functions through multiple call layers for no architectural benefit. The orchestrator already dispatches to agents and tools via the executor. Making it explicitly import from the tool registry is honest about what it does.
  Date/Author: 2026-02-20 / Review

- Decision: Agent discoverability is explicit and centralized in `src/registry/agents.ts`, while each domain declares exposure metadata in `capability.ts` when migrated.
  Rationale: Some domains are `agent`, some are `tool-only`, and some are `internal`. Making this explicit avoids implicit folder-based assumptions and lets linters validate consistency.
  Date/Author: 2026-02-20 / Review

## Outcomes & Retrospective

Initial state: plan authored, no implementation changes yet. The next contributor should begin at Milestone 1 and update `Progress`, `Surprises & Discoveries`, and `Decision Log` at every stopping point.

## Context and Orientation

Hermes currently organizes backend code by technical slice (`src/routes`, `src/services`, `src/tools`, `src/orchestrator`, `src/agents`) rather than by domain-layer packages. This is not inherently wrong, but it makes forward-only dependency direction hard to enforce. The goal of this plan is to preserve behavior while introducing domain-local packages with strict layer direction.

In this repository, a domain is a business capability boundary such as scheduler, email watcher, calendar, memory, media, or UI generation. A layer is a code responsibility tier within one domain. This plan uses these terms in plain meaning:

- `types`: plain data shapes and contracts.
- `config`: domain-specific constants and validated settings.
- `repo`: data read/write code for persistence.
- `providers`: adapters for cross-cutting systems like Google APIs, Twilio, auth link creation, telemetry, and feature flags.
- `service`: business rules and workflow logic.
- `runtime`: request handlers, pollers, tool adapters, and executable entry points.
- `ui`: rendering/presentation code.

The canonical direction is forward-only:

    types -> config -> repo -> service -> runtime -> ui
                     ^
                 providers (cross-cutting ingress only)

Key files that illustrate current coupling and must be addressed early:

- `src/tools/utils.ts` currently imports route code for auth URL generation.
- `src/services/anthropic/classification.ts` currently imports tool registry.
- `src/services/scheduler/executor.ts` currently imports read-only tool registry.
- `src/orchestrator/response-composer.ts` currently imports tool execution helpers.
- `src/services/media/process.ts` currently imports `MediaAttachment` type from tools.

The architecture document already records the target contract and a gap review in `ARCHITECTURE.md` near the top sections titled "Layered Domain Contract (Target)" and "Forward-Layer Compliance Review (2026-02-20)".

## Domain Boundaries and Target Folder Structure

Not everything becomes a domain. A domain is a bounded business capability with its own data, tools, and/or agent. Cross-cutting infrastructure that serves multiple domains stays in shared top-level modules.

Domain structure in this plan stays unchanged. The updates in this revision add explicit metadata and registry rules so an agent can discover all active agents without traversing the whole domain tree.

### Agent Exposure and Discoverability Contract

Not every domain has its own agent, and that is valid by design.

- `agent`: domain has `runtime/agent.ts` and `runtime/prompt.ts`.
- `tool-only`: domain exposes tools but no standalone agent.
- `internal`: domain is runtime/service-only and exposes neither tools nor agent.

To make this explicit:

1. `src/registry/agents.ts` is the only runtime source of truth for active agents.
2. Each migrated domain adds `src/domains/<name>/capability.ts` with:

       export type DomainExposure = 'agent' | 'tool-only' | 'internal';

       export interface DomainCapability {
         domain: string;
         exposure: DomainExposure;
         agentId?: string;
         agentModule?: string;
         tools?: string[];
       }

3. Domains with `exposure: 'agent'` must include `runtime/agent.ts` and `runtime/prompt.ts`.
4. Domains with `exposure: 'tool-only'` or `exposure: 'internal'` do not require `runtime/agent.ts`.
5. `docs/generated/agent-catalog.md` is generated from `src/registry/agents.ts` plus domain capability metadata.

### Domains (move to `src/domains/<name>/`)

#### `src/domains/scheduler/`

Business capability: scheduled reminders and recurring jobs.

    src/domains/scheduler/
    ├── types.ts                ← ScheduledJob, CreateJobInput, ExecutionResult (from services/scheduler/types.ts)
    ├── repo/
    │   └── sqlite.ts           ← job CRUD operations (from services/scheduler/sqlite.ts)
    ├── providers/
    │   └── sms.ts              ← interface for sending SMS/WhatsApp (wraps twilio.ts)
    ├── service/
    │   ├── parser.ts           ← natural language → cron/timestamp (from services/scheduler/parser.ts)
    │   └── executor.ts         ← job execution logic (from services/scheduler/executor.ts)
    └── runtime/
        ├── index.ts            ← initScheduler, getSchedulerDb, stopScheduler (from services/scheduler/index.ts)
        ├── poller.ts           ← createIntervalPoller (from services/scheduler/poller.ts)
        ├── tools.ts            ← scheduler ToolDefinition[] (from tools/scheduler.ts)
        ├── agent.ts            ← agent capability definition (from agents/scheduler/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/scheduler/prompt.ts)

#### `src/domains/email-watcher/`

Business capability: background email monitoring, skill-based classification, automated actions.

    src/domains/email-watcher/
    ├── types.ts                ← IncomingEmail, EmailSkill, ClassificationResult (from services/email-watcher/types.ts)
    ├── repo/
    │   └── sqlite.ts           ← email_skills CRUD (from services/email-watcher/sqlite.ts)
    ├── providers/
    │   ├── gmail-sync.ts       ← Gmail history.list incremental sync (from services/email-watcher/sync.ts)
    │   └── classifier-llm.ts   ← LLM classification call (from services/email-watcher/classifier.ts)
    ├── service/
    │   ├── actions.ts          ← action routing: execute_with_tools, notify (from services/email-watcher/actions.ts)
    │   ├── skills.ts           ← skill loading, seeding, management (from services/email-watcher/skills.ts)
    │   └── prompt.ts           ← classifier prompt construction (from services/email-watcher/prompt.ts)
    └── runtime/
        ├── index.ts            ← startEmailWatcher, stopEmailWatcher lifecycle (from services/email-watcher/index.ts)
        └── tools.ts            ← email skill management ToolDefinition[] (from tools/email-skills.ts)

#### `src/domains/calendar/`

Business capability: Google Calendar CRUD.

    src/domains/calendar/
    ├── types.ts                ← calendar event shapes, input/output types
    ├── providers/
    │   └── google-calendar.ts  ← Google Calendar API wrapper (from services/google/calendar.ts)
    ├── service/
    │   └── calendar.ts         ← calendar business logic (extracted from tools/calendar.ts handlers)
    └── runtime/
        ├── tools.ts            ← calendar ToolDefinition[] (schemas from tools/calendar.ts)
        ├── agent.ts            ← agent capability definition (from agents/calendar/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/calendar/prompt.ts)

#### `src/domains/email/`

Business capability: Gmail read access.

    src/domains/email/
    ├── types.ts                ← email search/read types
    ├── providers/
    │   └── gmail.ts            ← Gmail API wrapper (from services/google/gmail.ts)
    ├── service/
    │   └── email.ts            ← email search/read logic (extracted from tools/email.ts handlers)
    └── runtime/
        ├── tools.ts            ← email ToolDefinition[] (from tools/email.ts)
        ├── agent.ts            ← agent capability definition (from agents/email/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/email/prompt.ts)

#### `src/domains/memory/`

Business capability: user fact extraction, storage, and retrieval.

    src/domains/memory/
    ├── types.ts                ← UserFact, MemoryStore (from services/memory/types.ts)
    ├── repo/
    │   └── sqlite.ts           ← user_facts CRUD (from services/memory/sqlite.ts)
    ├── service/
    │   ├── processor.ts        ← background extraction (from services/memory/processor.ts)
    │   ├── ranking.ts          ← confidence sorting + selection (from services/memory/ranking.ts)
    │   └── prompts.ts          ← extraction prompt builder (from services/memory/prompts.ts)
    └── runtime/
        ├── index.ts            ← init, getMemoryStore (from services/memory/index.ts)
        ├── tools.ts            ← memory ToolDefinition[] (from tools/memory.ts)
        ├── agent.ts            ← agent capability definition (from agents/memory/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/memory/prompt.ts)

#### `src/domains/drive/`

Business capability: Google Drive, Sheets, Docs, and Gemini Vision.

    src/domains/drive/
    ├── types.ts                ← drive/sheets/docs/vision types
    ├── providers/
    │   ├── google-drive.ts     ← Drive API wrapper (from services/google/drive.ts)
    │   ├── google-sheets.ts    ← Sheets API wrapper (from services/google/sheets.ts)
    │   ├── google-docs.ts      ← Docs API wrapper (from services/google/docs.ts)
    │   └── gemini-vision.ts    ← Gemini Vision API wrapper (from services/google/vision.ts)
    ├── service/
    │   └── drive.ts            ← file management, spreadsheet ops, doc ops, image analysis
    └── runtime/
        ├── tools.ts            ← drive + sheets + docs + vision ToolDefinition[] (from tools/drive.ts, sheets.ts, docs.ts, vision.ts)
        ├── agent.ts            ← agent capability definition (from agents/drive/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/drive/prompt.ts)

#### `src/domains/ui/`

Business capability: interactive HTML page generation.

    src/domains/ui/
    ├── types.ts                ← page types, storage provider interface (from services/ui/providers/types.ts)
    ├── service/
    │   ├── generator.ts        ← HTML generation (from services/ui/generator.ts)
    │   └── validator.ts        ← HTML validation (from services/ui/validator.ts)
    └── runtime/
        ├── tools.ts            ← generate_ui ToolDefinition (from tools/ui.ts)
        ├── agent.ts            ← agent capability definition (from agents/ui/index.ts)
        ├── prompt.ts           ← agent system prompt (from agents/ui/prompt.ts)
        ├── pages.ts            ← page serving route handler (from routes/pages.ts)
        └── providers/          ← storage providers (from services/ui/providers/)
            ├── local-storage.ts
            └── memory-shortener.ts

#### `src/domains/media/`

Business capability: inbound media download, upload, and pre-analysis.

    src/domains/media/
    ├── types.ts                ← MediaProcessingResult, DownloadedMedia, ImageBufferEntry
    ├── providers/
    │   ├── twilio-download.ts  ← Twilio media download with retry (from services/twilio/fetch-with-retry.ts + services/media/upload.ts download logic)
    │   └── gemini-analyze.ts   ← Gemini pre-analysis (from services/media/pre-analyze.ts)
    └── service/
        ├── upload.ts           ← Drive upload logic (from services/media/upload.ts)
        └── process.ts          ← combined download → upload + pre-analyze pipeline (from services/media/process.ts)

### Shared Infrastructure (stays at top level)

These modules serve multiple domains and do not have their own tools or agents. They remain in their current locations (or move to explicitly shared modules).

    src/
    ├── index.ts                    ← bootstrap / app wiring (stays)
    ├── config.ts                   ← env var loading (stays)
    ├── twilio.ts                   ← Twilio SDK wrapper for outbound SMS/WhatsApp (stays)
    ├── conversation.ts             ← legacy conversation helper (stays)
    │
    ├── types/
    │   └── media.ts                ← MediaAttachment (created in Milestone 2)
    │
    ├── providers/
    │   └── auth.ts                 ← generateAuthUrl, encryptState (created in Milestone 2)
    │
    ├── registry/
    │   ├── tools.ts                ← aggregates ToolDefinition[] from all domains, exports TOOLS, toolHandlers, READ_ONLY_TOOLS, executeTool()
    │   └── agents.ts               ← single source of truth for active agent definitions
    │
    ├── routes/
    │   ├── sms.ts                  ← Twilio webhook handler (thin: delegates to orchestrator)
    │   ├── auth.ts                 ← OAuth routes (thin: delegates to providers/auth.ts)
    │   └── health.ts               ← healthcheck endpoint
    │
    ├── orchestrator/               ← cross-cutting runtime coordinator (stays as-is)
    │   ├── orchestrate.ts
    │   ├── planner.ts
    │   ├── executor.ts
    │   ├── replanner.ts
    │   ├── response-composer.ts
    │   ├── handler.ts
    │   ├── conversation-window.ts
    │   ├── media-context.ts
    │   └── types.ts
    │
    ├── executor/                   ← agent execution engine (stays as-is)
    │   ├── registry.ts
    │   ├── router.ts
    │   ├── tool-executor.ts
    │   └── types.ts
    │
    ├── agents/
    │   └── general/                ← fallback agent with all tools (stays — not a domain, it's the escape hatch)
    │       ├── index.ts
    │       └── prompt.ts
    │
    ├── services/                   ← shared infrastructure services (stay)
    │   ├── anthropic/              ← Claude API client, classification, prompts
    │   ├── credentials/            ← encrypted OAuth token storage
    │   ├── conversation/           ← message history SQLite store
    │   ├── user-config/            ← user preferences SQLite store
    │   └── date/                   ← chrono-node + Luxon date resolver
    │
    ├── admin/                      ← admin routes (stays)
    └── utils/                      ← trace-logger, phone formatting (stays)

### What moves vs. what stays — summary

| Current location | Target | Rationale |
|-----------------|--------|-----------|
| `src/agents/<name>/` (except general) | `src/domains/<name>/runtime/agent.ts` + `prompt.ts` only for `exposure: 'agent'` domains | Not all domains have standalone agents |
| `src/tools/<name>.ts` (except utils, maps, user-config) | `src/domains/<name>/runtime/tools.ts` | Tool definitions are runtime adapters |
| `src/services/scheduler/` | `src/domains/scheduler/` | Bounded domain with own persistence |
| `src/services/email-watcher/` | `src/domains/email-watcher/` | Bounded domain with own persistence |
| `src/services/memory/` | `src/domains/memory/` | Bounded domain with own persistence |
| `src/services/media/` | `src/domains/media/` | Bounded domain |
| `src/services/ui/` | `src/domains/ui/` | Bounded domain |
| `src/services/google/calendar.ts` | `src/domains/calendar/providers/` | Domain-specific Google API |
| `src/services/google/gmail.ts` | `src/domains/email/providers/` | Domain-specific Google API |
| `src/services/google/drive.ts`, `sheets.ts`, `docs.ts`, `vision.ts` | `src/domains/drive/providers/` | Domain-specific Google APIs |
| `src/services/google/auth.ts` | `src/providers/auth.ts` + `src/routes/auth.ts` | Cross-cutting, not domain-specific |
| `src/services/anthropic/` | stays | Cross-cutting LLM client |
| `src/services/credentials/` | stays | Cross-cutting credential storage |
| `src/services/conversation/` | stays | Cross-cutting message history |
| `src/services/user-config/` | stays | Cross-cutting user preferences |
| `src/services/date/` | stays | Cross-cutting date resolution |
| `src/tools/index.ts` | `src/registry/tools.ts` | Becomes the aggregator, imports from all domains |
| `src/tools/types.ts` | `src/types/tools.ts` + `src/types/media.ts` | Shared types, not domain-specific |
| `src/tools/utils.ts` | split: auth → `src/providers/auth.ts`, rest stays or moves to relevant domain | Cross-cutting utilities |
| `src/tools/maps.ts` | `src/registry/tools.ts` or a small shared utility | Used only by response composer |
| `src/tools/user-config.ts` | stays in shared tools or moves to user-config service | Cross-cutting user preferences |
| `src/orchestrator/` | stays | Cross-cutting runtime coordinator |
| `src/executor/` | stays | Cross-cutting agent execution engine |
| `src/agents/general/` | stays | Escape-hatch agent, not a domain |
| `src/agents/index.ts` | `src/registry/agents.ts` | Centralized active-agent registry for discoverability and enforcement |
| `src/routes/` | stays (thins out as domain runtimes take over) | HTTP wiring layer |

### Edge cases and notes

**`src/tools/maps.ts`** (the `format_maps_link` tool) is used only by the response composer. It does not belong to any single domain. It can stay in a small `src/registry/shared-tools.ts` alongside the tool registry, or remain in `src/tools/maps.ts` with a re-export from the registry.

**`src/tools/user-config.ts`** manages user preferences (name, timezone). It is cross-cutting (not domain-specific). It can stay in a shared tools module or move into `src/services/user-config/` as a runtime adapter.

**`src/agents/general/`** is not a domain. It is the fallback agent with access to all tools. It stays in `src/agents/general/` (or could move to `src/orchestrator/` since it is part of the orchestration fallback path). The executor/registry already handles general-agent dispatch.

**`src/registry/agents.ts`** becomes the only source of truth for active agents. It imports `runtime/agent.ts` from domains with `exposure: 'agent'` plus `src/agents/general/`. Agents should not be discovered by directory traversal.

**Tests** mirror the domain structure. When `src/services/scheduler/` moves to `src/domains/scheduler/`, the corresponding tests move from `tests/unit/scheduler/` to `tests/unit/domains/scheduler/`. Import paths in test files update accordingly.

## Plan of Work

### Milestone 1: Baseline and Mechanical Guardrails

Create a repeatable dependency report and add machine-enforced boundary checks with temporary exceptions. The immediate deliverable is not a fully clean graph; it is a reliable gate that reports and blocks new violations while known violations are explicitly tracked.

There is currently no ESLint config file in the repository (ESLint 9 flat config is used but unconfigured). The project has `eslint`, `@typescript-eslint/eslint-plugin`, and `@typescript-eslint/parser` as devDependencies.

#### Files to create

**`scripts/check-layer-deps.mjs`** — A Node script (~100-150 lines, no dependencies beyond Node builtins) that:

1. Recursively walks all `.ts` files under `src/`.
2. Extracts `import ... from '...'` and `export ... from '...'` declarations via regex (no need for a full parser since TypeScript imports are syntactically regular).
3. Also extracts dynamic `import('...')` declarations. Dynamic imports are present in the current codebase and must be checked by the same boundary rules.
4. Resolves each import's relative path to determine both top-level `src/` directory and, when applicable, domain-layer location (`src/domains/<name>/<layer>/...`).
5. Checks each resolved edge against the forbidden rules loaded from `config/architecture-boundaries.json`, including both top-level legacy rules and domain-layer direction rules.
6. Skips edges listed in the exceptions array.
7. For each violation, prints a three-line block: the forbidden edge (source file → target file), the rule that was broken, and a remediation instruction. Example output:

        VIOLATION: src/services/scheduler/executor.ts -> src/tools/index.ts
        Rule: services/ cannot import from tools/
        Fix: pass tool names as a function parameter instead of importing the registry directly.

8. If `--report` flag is passed, prints a full edge summary (all edges grouped by source→target directory and domain layer) before violations.
9. Exits with code 0 if no unapproved violations, code 1 otherwise.

**`scripts/check-agent-registry.mjs`** — A Node script that validates agent discoverability invariants:

1. Loads `src/registry/agents.ts` and parses the declared agent IDs.
2. For each `src/domains/*/capability.ts` with `exposure: 'agent'`, verifies `runtime/agent.ts` and `runtime/prompt.ts` exist.
3. Verifies every `exposure: 'agent'` domain is present in `src/registry/agents.ts`.
4. Verifies `tool-only` and `internal` domains are not present in `src/registry/agents.ts`.
5. Exits non-zero with clear remediation messages when drift is detected.

**`scripts/generate-agent-catalog.mjs`** — A Node script that writes `docs/generated/agent-catalog.md` from `src/registry/agents.ts` plus domain capabilities.

**`src/registry/agents.ts`** — Central active-agent registry. In the initial state (before all domains are migrated), this file can import the existing agent modules from `src/agents/*` and export the same AGENTS array semantics currently provided by `src/agents/index.ts`.

During transition, keep `src/agents/index.ts` as a compatibility shim that re-exports from `src/registry/agents.ts` so existing imports continue to work.

**`config/architecture-boundaries.json`** — Machine-readable boundary rules:

    {
      "forbidden": [
        {
          "from": "src/services/",
          "to": "src/tools/",
          "message": "Services cannot import from tools layer. Pass dependencies via function parameters or move shared types to src/types/."
        },
        {
          "from": "src/services/",
          "to": "src/routes/",
          "message": "Services cannot import from routes layer. Move shared logic to src/providers/."
        },
        {
          "from": "src/services/",
          "to": "src/orchestrator/",
          "message": "Services cannot import from orchestrator layer."
        },
        {
          "from": "src/tools/",
          "to": "src/routes/",
          "message": "Tools cannot import from routes layer. Move shared logic (e.g., generateAuthUrl) to src/providers/."
        }
      ],
      "domainLayerRules": {
        "layers": ["types", "config", "repo", "providers", "service", "runtime", "ui"],
        "allowedImports": {
          "types": [],
          "config": ["types"],
          "repo": ["config", "providers"],
          "providers": ["types", "config"],
          "service": ["types", "config", "repo", "providers"],
          "runtime": ["types", "service", "providers"],
          "ui": ["types", "runtime"]
        }
      },
      "exceptions": [
        {
          "from": "src/tools/utils.ts",
          "to": "src/routes/auth.ts",
          "reason": "generateAuthUrl — will be moved to src/providers/auth.ts in Milestone 2",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/anthropic/classification.ts",
          "to": "src/tools/index.ts",
          "reason": "TOOLS import — will be passed as parameter in Milestone 2",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/scheduler/executor.ts",
          "to": "src/tools/index.ts",
          "reason": "READ_ONLY_TOOLS import — will be passed as parameter in Milestone 2",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/media/upload.ts",
          "to": "src/tools/types.ts",
          "reason": "MediaAttachment type — will be moved to src/types/media.ts in Milestone 2",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/media/process.ts",
          "to": "src/tools/types.ts",
          "reason": "MediaAttachment type — will be moved to src/types/media.ts in Milestone 2",
          "deadline": "2026-03-15"
        }
      ]
    }

Note: `orchestrator -> tools` is intentionally NOT forbidden. The orchestrator is a runtime coordinator; the tool registry is a runtime aggregator. This is a lateral dependency (see Decision Log).

Note: Domain-layer rules apply only when both files are inside the same `src/domains/<name>/` domain. Cross-domain imports are disallowed by default unless explicitly added as exceptions with owner and deadline.

#### Files to modify

**`package.json`** — Add script:

    "lint:architecture": "node scripts/check-layer-deps.mjs",
    "lint:agents": "node scripts/check-agent-registry.mjs",
    "docs:agents": "node scripts/generate-agent-catalog.mjs"

#### Acceptance

Run from WSL:

    npm run lint:architecture

Expected: exits 0, prints "5 known exceptions (see config/architecture-boundaries.json)" and "0 violations".

Run:

    npm run lint:agents
    npm run docs:agents

Expected: `lint:agents` exits 0 and `docs/generated/agent-catalog.md` is generated/updated.

Then add a temporary forbidden import to any service file (for example, add `import '../routes/sms.js'` to `src/services/memory/processor.ts`), run again, and confirm it exits 1 with a clear violation message. Revert the test edit.

Also run the existing quality gates to ensure nothing was broken:

    npm run lint && npm run lint:architecture && npm run lint:agents && npm run test:unit && npm run test:integration && npm run build

Generate and commit the baseline edge report:

    npm run lint:architecture -- --report > docs/generated/architecture-deps-baseline.txt

### Milestone 2: Remove High-Impact Reverse Edges Without Behavior Changes

Eliminate the five currently documented reverse dependencies in small additive edits. Each fix is a self-contained change that can be committed and verified independently. The injection pattern for all fixes is function parameters (see Decision Log).

#### Fix 1: Move `generateAuthUrl` out of routes → create `src/providers/auth.ts`

The function `generateAuthUrl()` in `src/routes/auth.ts` (line 163) depends only on `encryptState()` (line 77) and `config.baseUrl`. Neither requires Express request/response context. Move both to a new providers module.

**Create `src/providers/auth.ts`** containing:
- `encryptState(phoneNumber: string, channel: 'sms' | 'whatsapp'): string` — moved from `src/routes/auth.ts` lines 77-102 (the `OAuthStatePayload` type and `STATE_*` constants move with it)
- `generateAuthUrl(phoneNumber: string, channel: 'sms' | 'whatsapp'): string` — moved from `src/routes/auth.ts` lines 163-166
- Both functions import from `../config.js` and Node `crypto`. No Express dependency.

**Modify `src/routes/auth.ts`**:
- Remove `encryptState` and `generateAuthUrl` function bodies
- Add `import { encryptState, generateAuthUrl } from '../providers/auth.js'`
- Keep exporting both (the route module re-exports for backward compat with tests)

**Modify `src/tools/utils.ts`**:
- Change line 7 from `import { generateAuthUrl } from '../routes/auth.js'` to `import { generateAuthUrl } from '../providers/auth.js'`

**Verify**: `npm run test:unit -- --reporter=verbose tests/unit/tools/` and any auth route tests still pass.

#### Fix 2: Move `MediaAttachment` type to `src/types/media.ts`

The `MediaAttachment` interface (currently in `src/tools/types.ts` lines 12-16) is a plain data shape with no tool-layer dependencies. It is imported by services (`media/upload.ts`, `media/process.ts`), the executor (`executor/types.ts`), and the orchestrator (`orchestrator/types.ts`).

**Create `src/types/media.ts`** containing the `MediaAttachment` interface:

    export interface MediaAttachment {
      url: string;
      contentType: string;
      index: number;
    }

**Modify `src/tools/types.ts`**:
- Remove the `MediaAttachment` interface definition (lines 12-16)
- Add `import type { MediaAttachment } from '../types/media.js'`
- Add `export type { MediaAttachment } from '../types/media.js'` (backward compat so existing tools imports still resolve)

**Modify `src/executor/types.ts`**:
- Change line 12 from `import type { MediaAttachment } from '../tools/types.js'` to `import type { MediaAttachment } from '../types/media.js'`
- Change line 16 from `export type { MediaAttachment } from '../tools/types.js'` to `export type { MediaAttachment } from '../types/media.js'`

**Modify `src/services/media/upload.ts`**:
- Change line 10 from `import type { MediaAttachment } from '../../tools/types.js'` to `import type { MediaAttachment } from '../../types/media.js'`

**Modify `src/services/media/process.ts`**:
- Change line 8 from `import type { MediaAttachment } from '../../tools/types.js'` to `import type { MediaAttachment } from '../../types/media.js'`

**Modify `src/routes/sms.ts`**:
- Change line 20 from `import type { MediaAttachment } from '../tools/types.js'` to `import type { MediaAttachment } from '../types/media.js'`

**Verify**: `npm run build` (type-only change, no runtime behavior affected).

#### Fix 3: Pass `tools` parameter to `classifyMessage()`

The function `classifyMessage()` in `src/services/anthropic/classification.ts` imports `TOOLS` from `../../tools/index.js` (line 17) solely to pass to `buildClassificationPrompt()` (line 47). The prompt builder already accepts `tools: Tool[]` as its first parameter.

**Modify `src/services/anthropic/classification.ts`**:
- Remove line 17: `import { TOOLS } from '../../tools/index.js'`
- Add `tools: Tool[]` as the first parameter of `classifyMessage()`, changing the signature from:

      export async function classifyMessage(
        userMessage: string,
        conversationHistory: Message[],
        userConfig?: UserConfig | null,
        userFacts: UserFact[] = []
      )

  to:

      export async function classifyMessage(
        tools: Tool[],
        userMessage: string,
        conversationHistory: Message[],
        userConfig?: UserConfig | null,
        userFacts: UserFact[] = []
      )

- Add `import type { Tool } from '@anthropic-ai/sdk/resources/messages'` if not already present
- Line 47 changes from `buildClassificationPrompt(TOOLS, ...)` to `buildClassificationPrompt(tools, ...)`

**Modify `src/routes/sms.ts`** (the sole caller, line 408):
- Add `import { TOOLS } from '../tools/index.js'` (routes is a runtime layer, this import is valid)
- Change the call from `classifyMessage(message, history, userConfig, userFacts)` to `classifyMessage(TOOLS, message, history, userConfig, userFacts)`

**Verify**: `npm run test:unit -- --reporter=verbose tests/unit/services/classification/` and `npm run test:integration` (the integration tests exercise the SMS webhook flow).

#### Fix 4: Pass `readOnlyToolNames` to scheduler executor

The function `executeJob()` in `src/services/scheduler/executor.ts` imports `READ_ONLY_TOOLS` from `../../tools/index.js` (line 11) solely to extract tool names at line 78: `READ_ONLY_TOOLS.map(t => t.name)`. The names are strings passed to `executeWithTools()`.

**Modify `src/services/scheduler/executor.ts`**:
- Remove line 11: `import { READ_ONLY_TOOLS } from '../../tools/index.js'`
- Add `readOnlyToolNames: string[]` as the third parameter of `executeJob()`:

      export async function executeJob(
        db: Database.Database,
        job: ScheduledJob,
        readOnlyToolNames: string[]
      ): Promise<ExecutionResult>

- Change line 78 from `READ_ONLY_TOOLS.map(t => t.name)` to `readOnlyToolNames`

**Modify `src/services/scheduler/index.ts`** (the caller, line 69):
- Add `readOnlyToolNames: string[]` parameter to `initScheduler()`:

      export function initScheduler(
        db: Database.Database,
        intervalMs?: number,
        readOnlyToolNames?: string[]
      ): Poller

- Store `readOnlyToolNames` in a module-level variable (next to `sharedDb`)
- Change line 69 from `await executeJob(db, job)` to `await executeJob(db, job, storedReadOnlyToolNames)`
- Default to an empty array if not provided (backward compat for tests)

**Modify `src/index.ts`** (bootstrap):
- Import `READ_ONLY_TOOLS` from `./tools/index.js` (this is the runtime entry point, valid import)
- Pass `READ_ONLY_TOOLS.map(t => t.name)` as the third argument to `initScheduler()`

**Verify**: `npm run test:unit -- --reporter=verbose tests/unit/scheduler/` and full build.

#### Fix 5: Move `formatMapsLink` and `executeTool` import to `orchestrate.ts`

The response composer (`src/orchestrator/response-composer.ts`) imports `formatMapsLink` and `executeTool` from `../tools/index.js` (line 18). Since the orchestrator is a runtime coordinator and `orchestrator -> tools` is an accepted lateral dependency (see Decision Log), the fix is to consolidate the import in the coordinator (`orchestrate.ts`) and pass the dependencies down.

**Modify `src/orchestrator/response-composer.ts`**:
- Remove line 18: `import { formatMapsLink, executeTool } from '../tools/index.js'`
- Add parameters to `synthesizeResponse()`:

      export async function synthesizeResponse(
        context: PlanContext,
        plan: ExecutionPlan,
        failureReason?: 'timeout' | 'step_failed',
        logger?: TraceLogger,
        composerDeps?: {
          mapsLinkTool: Tool;
          executeTool: (name: string, input: Record<string, unknown>, context: ToolContext) => Promise<string>;
        }
      ): Promise<string>

- Replace `formatMapsLink.tool` (line 156) with `composerDeps?.mapsLinkTool` (fall back to empty tools array if not provided)
- Replace `executeTool(...)` calls (lines 217, 305) with `composerDeps?.executeTool(...)` (fall back to returning error JSON if not provided)
- Add `import type { Tool } from '@anthropic-ai/sdk/resources/messages'` and `import type { ToolContext } from '../tools/types.js'` for the type signatures

**Modify `src/orchestrator/orchestrate.ts`**:
- Add `import { formatMapsLink, executeTool } from '../tools/index.js'`
- Pass `composerDeps` to all four `synthesizeResponse()` call sites (lines 146, 165, 310, 335):

      synthesizeResponse(context, plan, undefined, logger, {
        mapsLinkTool: formatMapsLink.tool,
        executeTool,
      })

**Verify**: `npm run test:unit -- --reporter=verbose tests/unit/orchestrator/` and integration tests.

#### After all five fixes

Remove all five entries from the `exceptions` array in `config/architecture-boundaries.json`. Run:

    npm run lint:architecture

Expected: exits 0 with "0 known exceptions" and "0 violations".

Run full quality gates:

    npm run lint && npm run lint:architecture && npm run lint:agents && npm run test:unit && npm run test:integration && npm run build

Generate updated edge report and compare against baseline:

    npm run lint:architecture -- --report > docs/generated/architecture-deps-post-m2.txt

### Milestone 3: Migrate Scheduler to Domain Layers

Create `src/domains/scheduler/` with `types`, `config`, `repo`, `providers`, `service`, and `runtime` submodules. Move scheduler logic from `src/services/scheduler/*` into these packages while preserving existing public entry points with adapter exports so current callers continue to work.

`runtime` in this domain should own the poller entry points and orchestration hooks; `service` should own scheduling logic; `repo` should own SQLite operations. Cross-cutting concerns like SMS sending and tool execution interfaces should be consumed via providers.

Add `src/domains/scheduler/capability.ts` with explicit exposure metadata. If scheduler remains an agent domain, set `exposure: 'agent'` and wire its runtime agent module into `src/registry/agents.ts`.

Acceptance is that scheduler behavior is unchanged, existing scheduler unit/integration tests pass, architecture lint reports no new violations, `lint:agents` passes, and `docs/generated/agent-catalog.md` reflects the scheduler entry.

### Milestone 4: Migrate Email Watcher to Domain Layers

Repeat the same migration structure for `email-watcher` into `src/domains/email-watcher/`. Keep API compatibility through adapters during transition. Ensure classification, sync, actions, skills, and prompt assembly align to layer boundaries and consume cross-cutting dependencies through providers.

Add `src/domains/email-watcher/capability.ts` with explicit exposure metadata. If email-watcher remains tool-only, set `exposure: 'tool-only'` and do not add it to `src/registry/agents.ts`.

Acceptance is that email watcher behavior remains unchanged in tests and manual smoke verification, with no new dependency violations, and agent registry validation passes with the declared exposure.

### Milestone 5: Expand Pattern and Tighten Enforcement

Apply the same domain layering pattern to remaining high-value domains (calendar, memory, media, UI generation) or create explicit temporary shims with dated TODO ownership if full migration is deferred. Reduce the exceptions list in the boundary config after each domain cutover.

At the end of this milestone, switch architecture lint from “allow known exceptions” to strict mode for migrated domains, and keep exception scope only for explicitly deferred domains with deadlines.

Acceptance is that migrated domains have zero boundary exceptions and the exceptions file is materially smaller than baseline.

### Milestone 6: Finalize and Document

Remove compatibility adapters once callers are updated. Update `ARCHITECTURE.md` to move language from “target” to “enforced” for completed domains, and add a short “how to add a new domain module” orientation in `docs/DESIGN.md` (or a new focused design doc if needed).

Update `docs/QUALITY_SCORE.md` architecture grades based on post-migration state. Ensure all standard quality gates pass from WSL.

Acceptance is reproducible clean runs of lint, tests, and build, plus updated docs that match real code.

## Concrete Steps

Run all commands from `/mnt/c/Code/hermes-assistant` in WSL.

1. Generate baseline architecture edge artifact.

    npm run lint:architecture -- --report > docs/generated/architecture-deps-baseline.txt

Expected outcome: a deterministic text report that lists import edges and explicit violations. If the command does not yet exist, implement Milestone 1 first.

2. Run quality gates after each milestone.

    npm run lint
    npm run lint:architecture
    npm run lint:agents
    npm run docs:agents
    npm run test:unit
    npm run test:integration
    npm run build

Expected outcome: all commands pass. If one fails, do not continue to next milestone until fixed or explicitly documented in `Progress` with a narrow follow-up task.

3. Verify server boot after domain migrations.

    npm run dev:server

Expected outcome: server starts cleanly, scheduler and background services initialize, and `/health` responds HTTP 200.

4. Perform targeted architecture regression check by intentionally adding a forbidden import in a temporary local change and confirming `npm run lint:architecture` fails, then revert only that local test edit.

Expected outcome: boundary gate correctly blocks illegal direction imports.

## Validation and Acceptance

Validation is complete only when all of the following are true:

- Architecture boundary check exists, runs locally, and is enforced in CI.
- Agent registry/capability validation exists, runs locally, and is enforced in CI.
- `docs/generated/agent-catalog.md` is generated from registry + capabilities and reflects active agents.
- Known reverse edges identified in this plan are removed or documented as temporary exceptions with owner and deadline.
- Scheduler and email watcher run through their existing flows with unchanged external behavior.
- Full test and build suite passes from WSL with the project’s standard commands.
- Architecture docs describe the enforced state, not aspirational state.

Behavioral acceptance scenarios:

- If a developer adds a new import from a lower layer to an upper layer (for example `repo` importing `runtime`), `npm run lint:architecture` fails with a clear error naming both files.
- If a domain sets `exposure: 'agent'` without adding `runtime/agent.ts` or omits registry wiring, `npm run lint:agents` fails with a clear error.
- Existing SMS request handling and background processors continue to function, evidenced by passing integration tests and successful local health check.

## Idempotence and Recovery

This migration is designed to be additive and retry-safe. Each milestone should preserve old entry points through adapter exports until callers are moved. If a migration step fails mid-way, revert only the partial edits for that domain slice and rerun the milestone quality gates before retrying.

Do not delete legacy files until equivalent domain-layer code is wired, tested, and validated in at least one full lint/test/build run. Keep exceptions explicit and shrink them only after passing verification so recovery is always possible by re-enabling a narrow exception.

## Artifacts and Notes

Keep concise evidence artifacts in-repo as milestones complete:

- `docs/generated/architecture-deps-baseline.txt` for initial and final edge snapshots.
- A short changelog entry in this file’s `Progress` section per completed milestone.
- If CI is updated, include the relevant job name and command in `Progress`.
- `docs/generated/agent-catalog.md` generated by `npm run docs:agents`.

Expected architecture-lint failure output should look like:

    Forbidden import: src/domains/scheduler/repo/sqlite.ts -> src/domains/scheduler/runtime/poller.ts
    Rule: repo may not import runtime
    Fix: move shared logic to service or providers layer

## Interfaces and Dependencies

Use the existing Node/TypeScript toolchain and avoid introducing heavy new dependencies unless required. Preferred implementation is a local script plus repository-owned boundary config so the rules are transparent and versioned with the code.

By the end of Milestone 1, the following interfaces must exist:

- A boundary configuration artifact that declares allowed layer directions and temporary exceptions.
- A deterministic command (`npm run lint:architecture`) that enforces those rules.
- A centralized active-agent registry at `src/registry/agents.ts`.
- A domain capability contract (`DomainCapability`) used by migrated domains.
- Deterministic commands `npm run lint:agents` and `npm run docs:agents`.

By the end of Milestones 3 and 4, each migrated domain must expose stable runtime entry points so existing callers continue working during transition. Adapter exports must be intentionally temporary and removed in Milestone 6.

Revision Note (2026-02-20): Initial version created in response to request for a dedicated major-refactor ExecPlan that follows `docs/PLANS.md` as sole source of truth.

Revision Note (2026-02-20): Milestones 1 and 2 expanded with concrete file-level specifications, exact function signatures, and specific line-number references. Decision Log updated with injection pattern choice (function parameters), boundary checker approach (custom script), tool architecture design (domain-local definitions + central registry), and orchestrator→tools lateral dependency ruling. Surprises section updated with ESLint config and MediaAttachment findings.

Revision Note (2026-02-20): Addressed review findings 1-3 by correcting the `src/providers/auth.ts` config import path to `../config.js`, extending Milestone 1 boundary spec with explicit `domainLayerRules` enforcement for `src/domains/<name>/...`, and requiring the dependency checker to parse dynamic `import('...')` edges in addition to static imports.

Revision Note (2026-02-20): Added agent discoverability and mixed-domain exposure guidance without changing domain structure: centralized `src/registry/agents.ts`, per-domain `capability.ts` metadata (`agent|tool-only|internal`), `lint:agents` validation, and generated `docs/generated/agent-catalog.md`.
