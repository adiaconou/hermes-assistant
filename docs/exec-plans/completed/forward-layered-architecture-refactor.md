# Enforce Forward-Only Layered Domain Architecture

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`docs/PLANS.md` is checked into this repository and is the governing standard for this document. This file must be maintained in accordance with `docs/PLANS.md`.

## Purpose / Big Picture

Today Hermes works, but its module dependencies are not consistently forward-only. The practical result is architectural drift: modules in one layer can reach across boundaries and create coupling that makes future changes slower and riskier. After this refactor, each domain will follow a strict layer order (`types -> config -> repo -> service -> runtime -> ui`) with `providers` as the only explicit ingress for cross-cutting concerns, and these rules will be mechanically enforced in CI.

A user-visible way to see this working is to run a dependency check command that fails on illegal imports and passes when boundaries are respected. A second way to see it working is to run the existing server and test suites and observe no regressions while domain packages are migrated behind compatibility adapters.

## Progress

- [x] (2026-02-20 18:25Z) Created this ExecPlan in `docs/exec-plans/active/forward-layered-architecture-refactor.md` with full scope, milestones, and validation guidance.
- [x] (2026-02-21 20:45Z) Milestone 1 complete. Created `scripts/check-layer-deps.mjs`, `scripts/check-agent-registry.mjs`, `scripts/generate-agent-catalog.mjs`, `config/architecture-boundaries.json`, `src/registry/agents.ts`, `src/types/domain.ts`. Added `lint:architecture`, `lint:agents`, `docs:agents` scripts. Made `src/agents/index.ts` a compatibility shim re-exporting from registry. Baseline report generated at `docs/generated/architecture-deps-baseline.txt` (268 edges, 7 exceptions, 0 violations). All 719 unit tests pass, build succeeds. Discovered additional exception: `src/services/anthropic/index.ts` re-exports TOOLS from tools layer.
- [x] (2026-02-21 23:30Z) Milestone 2 complete. Removed all 6 Milestone-2 exceptions (down from 7 to 1 remaining). Fix 1: Moved `generateAuthUrl`/`encryptState`/`decryptState`/`AuthRequiredError` to `src/providers/auth.ts`. Fix 2: Moved `MediaAttachment` to `src/types/media.ts` with re-exports for backward compat. Fix 3: `classifyMessage()` now receives `tools` as a parameter; removed TOOLS re-export from `services/anthropic/index.ts`. Fix 4: Scheduler executor receives `readOnlyToolNames` as a parameter injected from `src/index.ts`. Fix 5: `synthesizeResponse()` receives `ComposerDeps` (compositionTools + executeTool) injected by `orchestrate.ts`. Architecture check: 1 exception, 0 violations. TypeScript compiles cleanly.
- [x] (2026-02-22 00:45Z) Milestone 3 complete. Migrated scheduler to `src/domains/scheduler/` with full layered structure: `types.ts`, `capability.ts`, `repo/sqlite.ts`, `providers/sms.ts`, `providers/executor.ts`, `service/parser.ts`, `service/executor.ts`, `runtime/index.ts`, `runtime/tools.ts`, `runtime/agent.ts`, `runtime/prompt.ts`. Pre-step: extracted `Poller` to `src/utils/poller.ts`. All original files replaced with re-export shims. Bootstrap wired in `src/index.ts` with `setExecuteWithTools()`. Registry updated to import from domain. Boundary checker updated: same-layer imports now allowed, `repo` added to runtime's allowed imports, `src/tools/`, `src/agents/`, `src/services/memory/` added to domain external allowed list. Architecture check: 1 exception, 0 violations. TypeScript compiles cleanly.
- [x] (2026-02-22 02:00Z) Milestone 4 complete. Migrated email-watcher to `src/domains/email-watcher/` with full layered structure: `types.ts`, `capability.ts`, `repo/sqlite.ts`, `providers/gmail-sync.ts`, `providers/executor.ts`, `service/prompt.ts`, `service/classifier.ts`, `service/actions.ts`, `service/skills.ts`, `runtime/index.ts`, `runtime/tools.ts`. Classifier moved from providers to service layer (needs repo+service access). All 9 original files replaced with re-export shims. Bootstrap wired in `src/index.ts` with `setEmailWatcherExecuteWithTools()`. Last exception removed from architecture-boundaries.json (actions.ts→executor now uses injected provider). Added `src/services/google/` to domain external allowed list, fixed `src/config.ts`→`src/config` in config. Architecture check: 0 exceptions, 0 violations. TypeScript compiles cleanly.
- [x] (2026-02-22 04:00Z) Milestone 5 complete. Migrated remaining 6 domains: google-core (internal), calendar, memory, email, drive, ui. Created `src/domains/google-core/` with shared auth and drive-folder infrastructure. All domains follow layered structure with `types.ts`, `capability.ts`, `providers/`, `service/` (where needed), `runtime/`. Cross-domain rules added for google-core imports via `providers/google-core.ts`. Memory service→runtime violation fixed by extracting store factory to `service/store.ts`. Provider injection wired in `src/index.ts` for all 7 agent-bearing domains. Architecture check: 0 exceptions, 0 violations (default + strict). TypeScript compiles cleanly.
- [x] (2026-02-22 05:30Z) Milestone 6 complete. Removed all 50 compatibility adapter/shim files. Rewired all callers to import directly from domain paths (tools/index.ts, executor/router.ts, executor/registry.ts, orchestrator/index.ts, index.ts, admin/, routes/, services/anthropic/, services/media/, 22 test files). Created cross-domain provider bridges for scheduler→memory, email-watcher→memory, email-watcher→email. Tightened `domainExternalRules`: removed `src/services/memory/` and `src/services/google/` from allowed list (no longer needed). Enabled `--strict` mode as default in `package.json` (`lint:architecture`). Fixed agent registry checker regex for hyphenated exposure values. Updated ARCHITECTURE.md (enforced state), DESIGN.md (domain onboarding guide), QUALITY_SCORE.md (updated structural compliance grades). Generated `docs/generated/agent-catalog.md` and `docs/generated/architecture-deps-final.txt`. Architecture check: 0 violations (strict). TypeScript compiles cleanly.

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

- Observation: Google services (`calendar.ts`, `gmail.ts`, `drive.ts`, `sheets.ts`, `docs.ts`) are tightly coupled through shared auth infrastructure and folder hierarchy. `docs.ts` and `sheets.ts` both import `getOrCreateHermesFolder`, `moveToHermesFolder`, and `searchFiles` from `drive.ts`. `drive.ts` imports `AuthRequiredError` from `calendar.ts`. All services share `auth.ts` for `getAuthenticatedClient` and `withRetry`.
  Evidence: Static import analysis shows `docs → drive`, `sheets → drive`, `drive → calendar`, and all → `auth.ts`. Separating calendar, email, and drive into independent domains without a shared base would immediately require cross-domain exceptions or circular dependencies.

- Observation: `AuthRequiredError` is defined in `src/services/google/calendar.ts` but consumed by `drive.ts` and other Google services. It is a provider-agnostic error type that does not belong in any single Google service.
  Evidence: `drive.ts` imports `AuthRequiredError` from `calendar.ts`, creating an artificial `drive → calendar` dependency.

- Observation: `src/services/media/` is not a domain — it has no tools, no agent, no persistence, and no business rules. It is a stateless pipeline that downloads from Twilio, uploads to Drive, and analyzes with Gemini in parallel. Its only consumer is `src/routes/sms.ts`.
  Evidence: `media/process.ts` imports from `services/google/drive.ts`, `services/google/vision.ts`, `services/twilio/fetch-with-retry.ts`, and `conversation/types.ts`. It does not meet the plan's own domain definition ("a bounded business capability with its own data, tools, and/or agent").

- Observation: `src/services/email-watcher/actions.ts` imports `executeWithTools` directly from `src/executor/tool-executor.ts`. This cross-boundary edge is not listed in the plan's known violations but will need to be addressed when email-watcher moves to a domain.
  Evidence: `import { executeWithTools } from '../../executor/tool-executor.js'` in `actions.ts`.

- Observation: The email-watcher classifier was initially placed in the `providers` layer but required imports from `repo` (sqlite) and `service` (prompt), violating `providers → [types, config]` rules. It belongs in the `service` layer because it orchestrates repo and prompt data to produce classification results.
  Evidence: Boundary checker flagged `providers/classifier-llm.ts → repo/sqlite` and `providers/classifier-llm.ts → service/prompt` as violations. Moved to `service/classifier.ts` — resolved.

- Observation: `src/services/anthropic/index.ts` barrel file re-exports `TOOLS` and `READ_ONLY_TOOLS` from `../../tools/index.js`. This is a `services -> tools` reverse edge not listed in the original plan exceptions. No consumer uses this re-export (only `classifyMessage` is imported from this barrel by `routes/sms.ts`).
  Evidence: Line 22: `export { TOOLS, READ_ONLY_TOOLS } from '../../tools/index.js'`. Added as exception with deadline 2026-03-15.

- Observation: The domain layer rule `runtime: [types, config, service, providers]` was too restrictive. Runtime files within the same domain need to import each other (agent imports prompt, tools imports index), and the runtime index needs to re-export repo functions. Updated to allow same-layer imports and added `repo` to runtime's allowed imports.
  Evidence: Scheduler domain had 4 violations for runtime->runtime and runtime->repo before rule updates.

- Observation: The `domainExternalRules.allowed` entry `src/twilio.ts` didn't match resolved import paths because the boundary checker strips `.js` extensions. Changed to `src/twilio` for correct matching.
  Evidence: Warning for `providers/sms.ts -> src/twilio` despite `src/twilio.ts` being in allowed list.

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

- Decision: Introduce `src/domains/google-core/` as an internal domain (`exposure: 'internal'`) that owns shared Google OAuth2 infrastructure and the Hermes Drive folder hierarchy. Calendar, email, and drive remain separate domains that import google-core only through their own `providers/google-core.ts` re-export files.
  Rationale: Static import analysis shows `docs.ts → drive.ts`, `sheets.ts → drive.ts`, and `drive.ts → calendar.ts` (for `AuthRequiredError`). Placing calendar, email, and drive in separate domains without a shared base would immediately require cross-domain exceptions or create circular dependencies. The google-core approach breaks these cycles, preserves 1-domain-per-agent alignment, and allows future provider swaps (e.g., replacing Gmail with Outlook in the email domain without touching calendar or drive).
  Date/Author: 2026-02-21 / Review

- Decision: Split auth into two layers. Top-level `src/providers/auth.ts` owns provider-agnostic concerns (`AuthRequiredError`, `generateAuthUrl`, `encryptState`, `decryptState`). Google-specific OAuth2 client creation (`getAuthenticatedClient`, `withRetry`, `refreshAccessToken`) lives in `src/domains/google-core/providers/auth.ts`.
  Rationale: `AuthRequiredError` and `generateAuthUrl` are consumed by every domain's tool handlers regardless of which provider threw the error. Google-specific OAuth2 client setup is only consumed by Google API wrappers. Separating these lets any future provider (Microsoft Graph, etc.) throw the same `AuthRequiredError` without importing Google-specific code. Also fixes the current misplacement of `AuthRequiredError` in `services/google/calendar.ts`.
  Date/Author: 2026-02-21 / Review

- Decision: `src/services/media/` stays as shared infrastructure, not a domain. It does not move to `src/domains/media/`.
  Rationale: Media has no tools, no agent, no persistence, and no business rules. It is a stateless pipeline that coordinates Twilio downloads, Drive uploads, and Gemini pre-analysis. Its only consumer is `src/routes/sms.ts`. It does not meet the plan's own domain definition ("a bounded business capability with its own data, tools, and/or agent").
  Date/Author: 2026-02-21 / Review

- Decision: Cross-domain imports are denied by default and enforced mechanically. Allowed cross-domain edges must be declared in `config/architecture-boundaries.json` with a `via` field that restricts imports to a single provider re-export file per consuming domain.
  Rationale: Without mechanical enforcement, the "cross-domain imports are disallowed by default" statement (previously just a note) would be advisory. The `via` constraint forces the provider re-export pattern and keeps each domain's cross-domain ingress points explicit and auditable.
  Date/Author: 2026-02-21 / Review

- Decision: Domain imports from top-level shared infrastructure are allowed for a specific set of modules (`src/config.ts`, `src/providers/`, `src/types/`, `src/utils/`, `src/twilio.ts`, `src/services/date/`, `src/services/credentials/`, `src/services/conversation/`, `src/services/anthropic/`, `src/services/user-config/`) and forbidden for runtime/wiring modules (`src/routes/`, `src/orchestrator/`, `src/executor/`, `src/registry/`). Enforced in `domainExternalRules` in the boundary config.
  Rationale: Domains must be able to use cross-cutting infrastructure (config, auth, date resolution, credential storage, LLM client, user preferences, SMS sending, utilities) but must not reach into runtime wiring (routes, orchestrator, executor, registry). Without explicit rules, nothing prevents a domain service from importing the orchestrator.
  Date/Author: 2026-02-21 / Review

- Decision: Correct three errors in `domainLayerRules.allowedImports`. `repo` adds `types`. `runtime` adds `config`. `ui` changes from `["types", "runtime"]` to `["types", "service"]`.
  Rationale: Repos always need domain type definitions. Runtime layers need config values (intervals, feature flags). UI is a leaf layer that should depend on the service layer for data, not on runtime (a peer leaf). `ui → runtime` would create lateral coupling between two leaf layers.
  Date/Author: 2026-02-21 / Review

- Decision: Orphaned cross-cutting tools (`format_maps_link` from `tools/maps.ts`, `set_user_config` and `delete_user_data` from `tools/user-config.ts`) move to `src/registry/shared-tools.ts` alongside the tool registry.
  Rationale: These tools do not belong to any single domain. `format_maps_link` is used only by the response composer. User config tools are cross-cutting (used by general-agent). Placing them in the registry module keeps them discoverable without creating a fake domain.
  Date/Author: 2026-02-21 / Review

- Decision: Extract `createIntervalPoller` and the `Poller` interface from `src/services/scheduler/poller.ts` to `src/utils/poller.ts` as shared infrastructure before domain migrations begin.
  Rationale: `createIntervalPoller` is consumed by three independent modules: scheduler, email-watcher, and memory processor. Leaving it inside the scheduler domain would force two cross-domain exceptions (email-watcher → scheduler and memory → scheduler) for a generic utility with zero scheduler-specific logic. Moving it to `src/utils/` makes the dependency graph accurate.
  Date/Author: 2026-02-21 / Review

- Decision: Add `src/services/anthropic/`, `src/services/user-config/`, `src/twilio.ts`, and `src/utils/` to `domainExternalRules.allowed`.
  Rationale: Code-level import analysis of scheduler and email-watcher shows both modules depend on anthropic client (email-watcher classifier), user-config store (both), and twilio SDK wrapper (both for SMS/WhatsApp sending). These are cross-cutting infrastructure consumed by multiple domains and meet the same criteria as the already-allowed modules. Without listing them, they would be implicitly allowed during migration but fail under strict mode in Milestone 5.
  Date/Author: 2026-02-21 / Review

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

Domain structure reflects code-level dependency analysis. Key structural decisions: `google-core` as a shared internal domain for Google OAuth2 and folder hierarchy; calendar, email, and drive as separate agent domains importing google-core via provider re-exports; media removed from domain list (stays as shared infrastructure); auth split into provider-agnostic top-level (`src/providers/auth.ts`) and Google-specific (`google-core/providers/auth.ts`). See Decision Log for rationale.

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

#### `src/domains/google-core/`

Shared Google OAuth2 infrastructure and Hermes Drive folder hierarchy. No agent, no tools. Exists to break circular dependencies between Google service domains.

    src/domains/google-core/
    ├── types.ts                ← GoogleClientOptions, token types, (AuthRequiredError re-exported from src/providers/auth.ts for convenience)
    ├── capability.ts           ← exposure: 'internal'
    ├── providers/
    │   └── auth.ts             ← createOAuth2Client, getAuthenticatedClient, refreshAccessToken,
    │                              withRetry, isInsufficientScopesError, handleScopeError
    │                              (from services/google/auth.ts)
    └── service/
        └── drive-folders.ts    ← getOrCreateHermesFolder, moveToHermesFolder, searchFiles
                                   (extracted from services/google/drive.ts — shared folder hierarchy)

#### `src/domains/scheduler/`

Business capability: scheduled reminders and recurring jobs.

    src/domains/scheduler/
    ├── types.ts                ← ScheduledJob, CreateJobInput, ExecutionResult (from services/scheduler/types.ts)
    ├── capability.ts           ← exposure: 'agent'
    ├── repo/
    │   └── sqlite.ts           ← job CRUD operations (from services/scheduler/sqlite.ts)
    ├── providers/
    │   ├── sms.ts              ← interface for sending SMS/WhatsApp (wraps twilio.ts)
    │   └── executor.ts         ← wraps injected executeWithTools function (avoids domain → executor
    │                              reverse edge; receives executeWithTools at init time via runtime/index.ts)
    ├── service/
    │   ├── parser.ts           ← natural language → cron/timestamp (from services/scheduler/parser.ts)
    │   └── executor.ts         ← job execution logic (from services/scheduler/executor.ts)
    └── runtime/
        ├── index.ts            ← initScheduler, getSchedulerDb, stopScheduler (from services/scheduler/index.ts)
        ├── tools.ts            ← scheduler ToolDefinition[] (from tools/scheduler.ts)
        ├── agent.ts            ← agent capability definition (from agents/scheduler/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/scheduler/prompt.ts)

#### `src/domains/email-watcher/`

Business capability: background email monitoring, skill-based classification, automated actions.

    src/domains/email-watcher/
    ├── types.ts                ← IncomingEmail, EmailSkill, ClassificationResult (from services/email-watcher/types.ts)
    ├── capability.ts           ← exposure: 'tool-only'
    ├── repo/
    │   └── sqlite.ts           ← email_skills CRUD (from services/email-watcher/sqlite.ts)
    ├── providers/
    │   ├── google-core.ts      ← re-exports getAuthenticatedClient, withRetry from google-core
    │   ├── gmail-sync.ts       ← Gmail history.list incremental sync (from services/email-watcher/sync.ts)
    │   ├── classifier-llm.ts   ← LLM classification call (from services/email-watcher/classifier.ts)
    │   └── executor.ts         ← wraps injected executeWithTools function (currently a direct
    │                              import from src/executor/tool-executor.ts — provider injection
    │                              needed to avoid domain → executor reverse edge)
    ├── service/
    │   ├── actions.ts          ← action routing: execute_with_tools, notify (from services/email-watcher/actions.ts)
    │   ├── skills.ts           ← skill loading, seeding, management (from services/email-watcher/skills.ts)
    │   └── prompt.ts           ← classifier prompt construction (from services/email-watcher/prompt.ts)
    └── runtime/
        ├── index.ts            ← startEmailWatcher, stopEmailWatcher lifecycle (from services/email-watcher/index.ts)
        └── tools.ts            ← email skill management ToolDefinition[] (from tools/email-skills.ts)

#### `src/domains/calendar/`

Business capability: Google Calendar CRUD. Depends on `google-core` for OAuth2 client and retry infrastructure.

    src/domains/calendar/
    ├── types.ts                ← CalendarEvent, CreateEventInput, etc.
    ├── capability.ts           ← exposure: 'agent'
    ├── providers/
    │   ├── google-core.ts      ← re-exports getAuthenticatedClient, withRetry from google-core
    │   └── google-calendar.ts  ← Google Calendar API wrapper (from services/google/calendar.ts)
    ├── service/
    │   └── calendar.ts         ← calendar business logic (extracted from tools/calendar.ts handlers)
    └── runtime/
        ├── tools.ts            ← calendar ToolDefinition[] + resolve_date (schemas from tools/calendar.ts)
        ├── agent.ts            ← agent capability definition (from agents/calendar/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/calendar/prompt.ts)

#### `src/domains/email/`

Business capability: Gmail read access. Depends on `google-core` for OAuth2 client. Designed so an alternative provider (e.g., Outlook via Microsoft Graph) can be added by implementing the same `EmailProvider` interface without touching calendar or drive.

    src/domains/email/
    ├── types.ts                ← EmailSearchResult, EmailThread, EmailMessage, EmailProvider interface
    ├── capability.ts           ← exposure: 'agent'
    ├── providers/
    │   ├── google-core.ts      ← re-exports getAuthenticatedClient, withRetry from google-core
    │   └── gmail.ts            ← Gmail API wrapper implementing EmailProvider (from services/google/gmail.ts)
    ├── service/
    │   └── email.ts            ← email search/read logic against EmailProvider interface (extracted from tools/email.ts handlers)
    └── runtime/
        ├── tools.ts            ← email ToolDefinition[] (from tools/email.ts)
        ├── agent.ts            ← agent capability definition (from agents/email/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/email/prompt.ts)

#### `src/domains/memory/`

Business capability: user fact extraction, storage, and retrieval.

    src/domains/memory/
    ├── types.ts                ← UserFact, MemoryStore (from services/memory/types.ts)
    ├── capability.ts           ← exposure: 'agent'
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

Business capability: Google Drive, Sheets, Docs, and Gemini Vision. Depends on `google-core` for OAuth2 client and shared folder hierarchy (`getOrCreateHermesFolder`, `moveToHermesFolder`).

    src/domains/drive/
    ├── types.ts                ← DriveFile, SheetRange, DocContent, vision types
    ├── capability.ts           ← exposure: 'agent'
    ├── providers/
    │   ├── google-core.ts      ← re-exports auth + drive-folders from google-core
    │   ├── google-drive.ts     ← Drive API file ops only (from services/google/drive.ts,
    │   │                          minus folder hierarchy which moved to google-core)
    │   ├── google-sheets.ts    ← Sheets API wrapper (from services/google/sheets.ts)
    │   ├── google-docs.ts      ← Docs API wrapper (from services/google/docs.ts)
    │   └── gemini-vision.ts    ← Gemini Vision API wrapper (from services/google/vision.ts)
    ├── service/
    │   └── drive.ts            ← file management, spreadsheet ops, doc ops, image analysis
    └── runtime/
        ├── tools/
        │   ├── drive.ts
        │   ├── sheets.ts
        │   ├── docs.ts
        │   └── vision.ts
        ├── agent.ts            ← agent capability definition (from agents/drive/index.ts)
        └── prompt.ts           ← agent system prompt (from agents/drive/prompt.ts)

#### `src/domains/ui/`

Business capability: interactive HTML page generation.

    src/domains/ui/
    ├── types.ts                ← page types, storage provider interface (from services/ui/providers/types.ts)
    ├── capability.ts           ← exposure: 'agent'
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

### Shared Infrastructure (stays at top level)

These modules serve multiple domains and do not have their own tools or agents. They remain in their current locations (or move to explicitly shared modules).

    src/
    ├── index.ts                    ← bootstrap / app wiring (stays)
    ├── config.ts                   ← env var loading (stays)
    ├── twilio.ts                   ← Twilio SDK wrapper for outbound SMS/WhatsApp (stays)
    ├── conversation.ts             ← legacy conversation helper (stays)
    │
    ├── types/
    │   ├── media.ts                ← MediaAttachment (created in Milestone 2)
    │   └── tools.ts                ← ToolDefinition, ToolHandler, ToolContext (from tools/types.ts)
    │
    ├── providers/
    │   └── auth.ts                 ← AuthRequiredError, generateAuthUrl, encryptState, decryptState
    │                                  (provider-agnostic auth error + link generation — cross-cutting,
    │                                  consumed by every domain's tool handlers)
    │
    ├── registry/
    │   ├── tools.ts                ← aggregates ToolDefinition[] from all domains, exports TOOLS, toolHandlers, READ_ONLY_TOOLS, executeTool()
    │   ├── agents.ts               ← single source of truth for active agent definitions
    │   └── shared-tools.ts         ← format_maps_link (from tools/maps.ts), set_user_config,
    │                                  delete_user_data (from tools/user-config.ts) — cross-cutting
    │                                  tools that belong to no single domain
    │
    ├── routes/
    │   ├── sms.ts                  ← Twilio webhook handler (thin: delegates to orchestrator)
    │   ├── auth.ts                 ← OAuth callback handler (thin: delegates to providers/auth.ts)
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
    │   ├── date/                   ← chrono-node + Luxon date resolver
    │   └── media/                  ← stays here (stateless pipeline, not a domain — see Decision Log)
    │
    ├── admin/                      ← admin routes (stays)
    └── utils/                      ← trace-logger, phone formatting (stays)
        └── poller.ts               ← createIntervalPoller, Poller interface (extracted from
                                       services/scheduler/poller.ts — shared by scheduler,
                                       email-watcher, and memory processor)

### What moves vs. what stays — summary

| Current location | Target | Rationale |
|-----------------|--------|-----------|
| `src/agents/<name>/` (except general) | `src/domains/<name>/runtime/agent.ts` + `prompt.ts` only for `exposure: 'agent'` domains | Not all domains have standalone agents |
| `src/tools/<name>.ts` (except utils, maps, user-config) | `src/domains/<name>/runtime/tools.ts` | Tool definitions are runtime adapters |
| `src/services/scheduler/` | `src/domains/scheduler/` | Bounded domain with own persistence |
| `src/services/email-watcher/` | `src/domains/email-watcher/` | Bounded domain with own persistence |
| `src/services/memory/` | `src/domains/memory/` | Bounded domain with own persistence |
| `src/services/scheduler/poller.ts` | `src/utils/poller.ts` | Generic polling utility consumed by scheduler, email-watcher, and memory (see Decision Log) |
| `src/services/media/` | stays at `src/services/media/` | **Not a domain** — stateless pipeline, no tools/agent/persistence (see Decision Log) |
| `src/services/ui/` | `src/domains/ui/` | Bounded domain |
| `src/services/google/auth.ts` | split: OAuth2 client → `src/domains/google-core/providers/auth.ts`, error type + link generation → `src/providers/auth.ts` | Google-specific auth vs provider-agnostic auth error/link |
| `src/services/google/drive.ts` | split: folder hierarchy → `src/domains/google-core/service/drive-folders.ts`, file ops → `src/domains/drive/providers/google-drive.ts` | Shared folder logic extracted to google-core |
| `src/services/google/calendar.ts` | `src/domains/calendar/providers/google-calendar.ts` | Domain-specific Google API; `AuthRequiredError` moves to `src/providers/auth.ts` |
| `src/services/google/gmail.ts` | `src/domains/email/providers/gmail.ts` | Domain-specific Google API |
| `src/services/google/sheets.ts`, `docs.ts`, `vision.ts` | `src/domains/drive/providers/` | Domain-specific Google APIs |
| `src/services/anthropic/` | stays | Cross-cutting LLM client |
| `src/services/credentials/` | stays | Cross-cutting credential storage |
| `src/services/conversation/` | stays | Cross-cutting message history |
| `src/services/user-config/` | stays | Cross-cutting user preferences |
| `src/services/date/` | stays | Cross-cutting date resolution |
| `src/tools/index.ts` | `src/registry/tools.ts` | Becomes the aggregator, imports from all domains |
| `src/tools/types.ts` | `src/types/tools.ts` + `src/types/media.ts` | Shared types, not domain-specific |
| `src/tools/utils.ts` | split: auth → `src/providers/auth.ts`, rest stays or moves to relevant domain | Cross-cutting utilities |
| `src/tools/maps.ts` | `src/registry/shared-tools.ts` | Cross-cutting tool, no domain home |
| `src/tools/user-config.ts` | `src/registry/shared-tools.ts` | Cross-cutting tool, no domain home |
| `src/orchestrator/` | stays | Cross-cutting runtime coordinator |
| `src/executor/` | stays | Cross-cutting agent execution engine |
| `src/agents/general/` | stays | Escape-hatch agent, not a domain |
| `src/agents/index.ts` | `src/registry/agents.ts` | Centralized active-agent registry for discoverability and enforcement |
| `src/routes/` | stays (thins out as domain runtimes take over) | HTTP wiring layer |

### Edge cases and notes

**`src/tools/maps.ts`** and **`src/tools/user-config.ts`** are cross-cutting tools with no domain home. Both move to `src/registry/shared-tools.ts` alongside the tool registry (see Decision Log).

**`src/agents/general/`** is not a domain. It is the fallback agent with access to all tools. It stays in `src/agents/general/` (or could move to `src/orchestrator/` since it is part of the orchestration fallback path). The executor/registry already handles general-agent dispatch.

**`src/registry/agents.ts`** becomes the only source of truth for active agents. It imports `runtime/agent.ts` from domains with `exposure: 'agent'` plus `src/agents/general/`. Agents should not be discovered by directory traversal.

**Tests** mirror the domain structure. When `src/services/scheduler/` moves to `src/domains/scheduler/`, the corresponding tests move from `tests/unit/scheduler/` to `tests/unit/domains/scheduler/`. Import paths in test files update accordingly.

## Plan of Work

### Milestone 1: Baseline and Mechanical Guardrails

Create a repeatable dependency report and add machine-enforced boundary checks with temporary exceptions. The immediate deliverable is not a fully clean graph; it is a reliable gate that reports and blocks new violations while known violations are explicitly tracked.

There is currently no ESLint config file in the repository (ESLint 9 flat config is used but unconfigured). The project has `eslint`, `@typescript-eslint/eslint-plugin`, and `@typescript-eslint/parser` as devDependencies.

#### Files to create

**`scripts/check-layer-deps.mjs`** — A Node script (~150-200 lines, no dependencies beyond Node builtins) that:

1. Recursively walks all `.ts` files under `src/`.
2. Extracts `import ... from '...'` and `export ... from '...'` declarations via regex (no need for a full parser since TypeScript imports are syntactically regular).
3. Also extracts dynamic `import('...')` declarations. Dynamic imports are present in the current codebase and must be checked by the same boundary rules.
4. Resolves each import's relative path to determine both top-level `src/` directory and, when applicable, domain-layer location (`src/domains/<name>/<layer>/...`).
5. Checks each resolved edge against rules loaded from `config/architecture-boundaries.json`:

   **a. Top-level `forbidden` rules** — matches `from` and `to` directory prefixes against the resolved source and target paths. Example: `services/ → tools/` is forbidden.

   **b. `domainLayerRules`** — applies when both source and target are inside the same `src/domains/<name>/` domain. Determines source and target layers from the directory structure and checks `allowedImports`. Example: `repo/sqlite.ts → runtime/poller.ts` within the same domain is forbidden because `repo` is not allowed to import `runtime`.

   **c. `crossDomainRules`** — applies when source and target are in different `src/domains/<name>/` directories. Default is `deny`. For each `allowed` entry, checks that the source domain and target domain match, and that the importing file matches the `via` path relative to the source domain. Example: `calendar/service/calendar.ts → google-core/providers/auth.ts` is a violation because the `via` constraint requires the import to go through `calendar/providers/google-core.ts`.

   **d. `domainExternalRules`** — applies when the source is inside `src/domains/` and the target is a top-level module outside `src/domains/`. Checks `forbidden` paths first (violation if matched), then checks `allowed` paths (valid if matched). Paths not in either list are warnings in default mode and violations in `--strict` mode.

6. Skips edges listed in the `exceptions` array after validating each entry includes `from`, `to`, `reason`, `owner`, and `deadline`.
7. For each violation, prints a three-line block: the forbidden edge (source file → target file), the rule that was broken, and a remediation instruction. Example outputs:

        VIOLATION: src/services/scheduler/executor.ts -> src/tools/index.ts
        Rule: services/ cannot import from tools/
        Fix: pass tool names as a function parameter instead of importing the registry directly.

        VIOLATION: src/domains/calendar/service/calendar.ts -> src/domains/google-core/providers/auth.ts
        Rule: cross-domain import must go through providers/google-core.ts
        Fix: import from ../providers/google-core.ts instead of importing google-core directly.

        VIOLATION: src/domains/scheduler/service/executor.ts -> src/executor/tool-executor.ts
        Rule: domains cannot import src/executor/ directly
        Fix: inject executeWithTools via providers layer.

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
          "repo": ["types", "config", "providers"],
          "providers": ["types", "config"],
          "service": ["types", "config", "repo", "providers"],
          "runtime": ["types", "config", "service", "providers"],
          "ui": ["types", "service"]
        }
      },
      "crossDomainRules": {
        "default": "deny",
        "allowed": [
          {
            "from": "src/domains/calendar/",
            "to": "src/domains/google-core/",
            "via": "providers/google-core.ts",
            "reason": "Shared Google OAuth2 and retry infrastructure"
          },
          {
            "from": "src/domains/email/",
            "to": "src/domains/google-core/",
            "via": "providers/google-core.ts",
            "reason": "Shared Google OAuth2"
          },
          {
            "from": "src/domains/drive/",
            "to": "src/domains/google-core/",
            "via": "providers/google-core.ts",
            "reason": "Shared Google OAuth2 and folder hierarchy"
          },
          {
            "from": "src/domains/email-watcher/",
            "to": "src/domains/google-core/",
            "via": "providers/google-core.ts",
            "reason": "Shared Google OAuth2 for Gmail history sync"
          }
        ]
      },
      "domainExternalRules": {
        "allowed": [
          "src/config.ts",
          "src/providers/",
          "src/types/",
          "src/utils/",
          "src/twilio.ts",
          "src/services/date/",
          "src/services/credentials/",
          "src/services/conversation/",
          "src/services/anthropic/",
          "src/services/user-config/"
        ],
        "forbidden": [
          {
            "to": "src/routes/",
            "message": "Domains cannot import routes. Routes import domains, not the reverse."
          },
          {
            "to": "src/orchestrator/",
            "message": "Domains cannot import orchestrator. Use providers for cross-cutting concerns."
          },
          {
            "to": "src/executor/",
            "message": "Domains cannot import executor directly. Inject executeWithTools via providers."
          },
          {
            "to": "src/registry/",
            "message": "Domains cannot import registry. Registry imports domains, not the reverse."
          }
        ]
      },
      "exceptions": [
        {
          "from": "src/tools/utils.ts",
          "to": "src/routes/auth.ts",
          "reason": "generateAuthUrl — will be moved to src/providers/auth.ts in Milestone 2",
          "owner": "forward-layered-architecture-refactor",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/anthropic/classification.ts",
          "to": "src/tools/index.ts",
          "reason": "TOOLS import — will be passed as parameter in Milestone 2",
          "owner": "forward-layered-architecture-refactor",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/scheduler/executor.ts",
          "to": "src/tools/index.ts",
          "reason": "READ_ONLY_TOOLS import — will be passed as parameter in Milestone 2",
          "owner": "forward-layered-architecture-refactor",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/media/upload.ts",
          "to": "src/tools/types.ts",
          "reason": "MediaAttachment type — will be moved to src/types/media.ts in Milestone 2",
          "owner": "forward-layered-architecture-refactor",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/media/process.ts",
          "to": "src/tools/types.ts",
          "reason": "MediaAttachment type — will be moved to src/types/media.ts in Milestone 2",
          "owner": "forward-layered-architecture-refactor",
          "deadline": "2026-03-15"
        },
        {
          "from": "src/services/email-watcher/actions.ts",
          "to": "src/executor/tool-executor.ts",
          "reason": "executeWithTools import — will be injected via providers/executor.ts when email-watcher migrates to domain in Milestone 4",
          "owner": "forward-layered-architecture-refactor",
          "deadline": "2026-04-15"
        }
      ]
    }

Note: `orchestrator -> tools` is intentionally NOT forbidden. The orchestrator is a runtime coordinator; the tool registry is a runtime aggregator. This is a lateral dependency (see Decision Log).

Note: Domain-layer rules apply only when both files are inside the same `src/domains/<name>/` domain.

Note: Cross-domain imports are denied by default (`crossDomainRules.default: "deny"`). Allowed cross-domain edges must be declared with a `via` field that restricts the import to a single provider re-export file in the consuming domain. If `calendar/service/calendar.ts` imports `google-core/providers/auth.ts` directly (bypassing `calendar/providers/google-core.ts`), it is a violation.

Note: Domain imports from top-level modules are governed by `domainExternalRules`. Domains may import from `allowed` paths but not from `forbidden` paths. Any top-level path not in either list is a warning in default mode and a violation in `--strict` mode. Milestone 5 runs strict as a preflight gate; Milestone 6 makes strict mode the default.

#### Files to modify

**`package.json`** — Add script:

    "lint:architecture": "node scripts/check-layer-deps.mjs",
    "lint:agents": "node scripts/check-agent-registry.mjs",
    "docs:agents": "node scripts/generate-agent-catalog.mjs"

#### Acceptance

Run from WSL:

    npm run lint:architecture

Expected: exits 0, prints "6 known exceptions (see config/architecture-boundaries.json)" and "0 violations".

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
- `AuthRequiredError` class — moved from `src/services/google/calendar.ts` (this is a provider-agnostic error; placing it here removes the artificial `drive → calendar` dependency and makes it available to any future provider)
- `encryptState(phoneNumber: string, channel: 'sms' | 'whatsapp'): string` — moved from `src/routes/auth.ts` lines 77-102 (the `OAuthStatePayload` type and `STATE_*` constants move with it)
- `generateAuthUrl(phoneNumber: string, channel: 'sms' | 'whatsapp'): string` — moved from `src/routes/auth.ts` lines 163-166
- Both functions import from `../config.js` and Node `crypto`. No Express dependency.

**Modify `src/services/google/calendar.ts`**:
- Remove `AuthRequiredError` class definition
- Add `import { AuthRequiredError } from '../../providers/auth.js'`
- Re-export for backward compat: `export { AuthRequiredError } from '../../providers/auth.js'`

**Modify `src/services/google/drive.ts`**:
- Change `import { AuthRequiredError } from './calendar.js'` to `import { AuthRequiredError } from '../../providers/auth.js'` (eliminates the `drive → calendar` circular edge)

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

Remove the five Milestone 2 entries from the `exceptions` array in `config/architecture-boundaries.json`. Run:

    npm run lint:architecture

Expected: exits 0 with "1 known exception" (the email-watcher `executeWithTools` edge tracked for Milestone 4) and "0 violations".

Run full quality gates:

    npm run lint && npm run lint:architecture && npm run lint:agents && npm run test:unit && npm run test:integration && npm run build

Generate updated edge report and compare against baseline:

    npm run lint:architecture -- --report > docs/generated/architecture-deps-post-m2.txt

### Milestone 3: Migrate Scheduler to Domain Layers

Create `src/domains/scheduler/` with the layered package structure. Move scheduler logic from `src/services/scheduler/*`, `src/tools/scheduler.ts`, and `src/agents/scheduler/` into domain layers while preserving existing public entry points with compatibility re-exports so current callers continue to work.

#### Pre-step: Extract poller to shared infrastructure

`createIntervalPoller` and the `Poller` interface are consumed by scheduler, email-watcher, and memory processor. They must be extracted before the scheduler becomes a domain, otherwise email-watcher and memory would need cross-domain imports into the scheduler domain for a generic utility.

**Create `src/utils/poller.ts`** — move the entire contents of `src/services/scheduler/poller.ts` (the `Poller` interface and `createIntervalPoller` function) here unchanged.

**Modify `src/services/scheduler/poller.ts`** — replace contents with a re-export shim:

    export { createIntervalPoller, type Poller } from '../../utils/poller.js'

**Modify `src/services/email-watcher/index.ts`**:
- Change `import { createIntervalPoller, type Poller } from '../scheduler/poller.js'` to `import { createIntervalPoller, type Poller } from '../../utils/poller.js'`

**Modify `src/services/memory/processor.ts`**:
- Change `import { createIntervalPoller, type Poller } from '../scheduler/poller.js'` to `import { createIntervalPoller, type Poller } from '../../utils/poller.js'`

**Verify**: `npm run test:unit && npm run build` — pure move, no behavior change.

#### Step 1: Create domain type, capability, and repo layers

**Create `src/domains/scheduler/types.ts`** — copy `src/services/scheduler/types.ts` unchanged. Exports: `MessageChannel`, `ScheduledJob`, `CreateJobInput`, `JobUpdates`, `ExecutionResult`.

**Create `src/domains/scheduler/capability.ts`**:

    import type { DomainCapability } from '../../types/domain.js'

    export const capability: DomainCapability = {
      domain: 'scheduler',
      exposure: 'agent',
      agentId: 'scheduler-agent',
      agentModule: './runtime/agent.js',
      tools: ['create_scheduled_job', 'list_scheduled_jobs', 'update_scheduled_job', 'delete_scheduled_job'],
    }

**Create `src/domains/scheduler/repo/sqlite.ts`** — copy `src/services/scheduler/sqlite.ts`. Change its import from `./types` to `../types.js`. Exports: `initSchedulerDb`, `createJob`, `getJobById`, `getJobsByPhone`, `getDueJobs`, `updateJob`, `deleteJob`.

#### Step 2: Create providers layer

**Create `src/domains/scheduler/providers/sms.ts`** — thin wrapper around `src/twilio.ts`:

    import { sendSms, sendWhatsApp } from '../../../twilio.js'
    import type { MessageChannel } from '../types.js'

    export async function sendScheduledMessage(
      phoneNumber: string,
      channel: MessageChannel,
      body: string
    ): Promise<void> {
      if (channel === 'whatsapp') {
        await sendWhatsApp(phoneNumber, body)
      } else {
        await sendSms(phoneNumber, body)
      }
    }

**Create `src/domains/scheduler/providers/executor.ts`** — wraps the injected `executeWithTools` function to avoid a direct `domain → src/executor/` import:

    import type { AgentExecutionContext, StepResult } from '../../../executor/types.js'

    type ExecuteWithToolsFn = (
      systemPrompt: string,
      task: string,
      toolNames: string[],
      context: AgentExecutionContext
    ) => Promise<StepResult>

    let _executeWithTools: ExecuteWithToolsFn | null = null

    export function setExecuteWithTools(fn: ExecuteWithToolsFn): void {
      _executeWithTools = fn
    }

    export function getExecuteWithTools(): ExecuteWithToolsFn {
      if (!_executeWithTools) throw new Error('executeWithTools not initialized — call setExecuteWithTools() at bootstrap')
      return _executeWithTools
    }

Note: `executor/types.ts` contains only type definitions. The `domainExternalRules` forbids importing `src/executor/` modules. However, `import type` (type-only imports) do not create runtime edges. The boundary checker should be updated in Milestone 1 to skip `import type` statements when checking `domainExternalRules.forbidden`, or this file should import the types from a re-export in `src/types/`. If the checker does not distinguish type-only imports, create `src/types/executor.ts` that re-exports `AgentExecutionContext` and `StepResult` from `src/executor/types.ts`, and import from there instead.

#### Step 3: Create service layer

**Create `src/domains/scheduler/service/parser.ts`** — copy `src/services/scheduler/parser.ts`. Update its import from `../date/resolver` to `../../../services/date/resolver.js` (allowed by `domainExternalRules`). Exports: `ParsedSchedule`, `parseSchedule`, `parseReminderTime`, `parseScheduleToCron`, `isValidCron`, `cronToHuman`.

**Create `src/domains/scheduler/service/executor.ts`** — copy `src/services/scheduler/executor.ts` with these changes:
- Remove `import { executeWithTools } from '../../executor/tool-executor.js'` — replace with `import { getExecuteWithTools } from '../providers/executor.js'`
- Remove `import { READ_ONLY_TOOLS } from '../../tools/index.js'` — this was already replaced with a `readOnlyToolNames: string[]` parameter in Milestone 2 Fix 4
- Change `import { sendSms, sendWhatsApp } from '../../twilio.js'` to `import { sendScheduledMessage } from '../providers/sms.js'`
- Change `import { getUserConfigStore } from '../user-config/index.js'` to `import { getUserConfigStore } from '../../../services/user-config/index.js'`
- Change `import { getMemoryStore } from '../memory/index.js'` to `import { getMemoryStore } from '../../../services/memory/index.js'`
- Change `import { ... } from './sqlite.js'` to `import { ... } from '../repo/sqlite.js'`
- Change `import type { ... } from './types.js'` to `import type { ... } from '../types.js'`
- Replace direct `executeWithTools(...)` call with `getExecuteWithTools()(...)`
- Replace `sendSms`/`sendWhatsApp` conditional with `sendScheduledMessage(job.phoneNumber, job.channel, body)`

#### Step 4: Create runtime layer

**Create `src/domains/scheduler/runtime/index.ts`** — copy `src/services/scheduler/index.ts` with these changes:
- Change `import { ... } from './types.js'` to `import { ... } from '../types.js'`
- Change `import { ... } from './sqlite.js'` to `import { ... } from '../repo/sqlite.js'`
- Change `import { ... } from './parser.js'` to `import { ... } from '../service/parser.js'`
- Change `import { ... } from './executor.js'` to `import { ... } from '../service/executor.js'`
- Change `import { createIntervalPoller } from './poller.js'` to `import { createIntervalPoller } from '../../../utils/poller.js'`
- Re-export all domain public API for convenience:

      export * from '../types.js'
      export * from '../repo/sqlite.js'
      export * from '../service/parser.js'
      export * from '../service/executor.js'
      export { createIntervalPoller, type Poller } from '../../../utils/poller.js'

**Create `src/domains/scheduler/runtime/tools.ts`** — copy `src/tools/scheduler.ts`. Change its import from `../services/scheduler/index.js` to `./index.js` (re-exports everything). Exports: `createScheduledJob`, `listScheduledJobs`, `updateScheduledJob`, `deleteScheduledJob` (4 ToolDefinition objects).

**Create `src/domains/scheduler/runtime/agent.ts`** — copy `src/agents/scheduler/index.ts`. Update the import for `AgentCapability` / `AgentExecutionContext` types as needed. Exports: `capability`, `executor`.

**Create `src/domains/scheduler/runtime/prompt.ts`** — copy `src/agents/scheduler/prompt.ts` unchanged. Exports: `SCHEDULER_AGENT_PROMPT`.

#### Step 5: Create compatibility adapters

These re-export shims keep existing imports working during the transition period. They are removed in Milestone 6.

**Modify `src/services/scheduler/index.ts`** — replace the body with:

    // Compatibility adapter — remove in Milestone 6
    export * from '../../domains/scheduler/runtime/index.js'

**Modify `src/services/scheduler/types.ts`** — replace with:

    export * from '../../domains/scheduler/types.js'

**Modify `src/services/scheduler/sqlite.ts`** — replace with:

    export * from '../../domains/scheduler/repo/sqlite.js'

**Modify `src/services/scheduler/parser.ts`** — replace with:

    export * from '../../domains/scheduler/service/parser.js'

**Modify `src/services/scheduler/executor.ts`** — replace with:

    export * from '../../domains/scheduler/service/executor.js'

**Modify `src/tools/scheduler.ts`** — replace with:

    export * from '../domains/scheduler/runtime/tools.js'

**Modify `src/agents/scheduler/index.ts`** — replace with:

    export * from '../../domains/scheduler/runtime/agent.js'

**Modify `src/agents/scheduler/prompt.ts`** — replace with:

    export * from '../../domains/scheduler/runtime/prompt.js'

#### Step 6: Wire bootstrap and registries

**Modify `src/index.ts`**:
- Add `import { setExecuteWithTools } from './domains/scheduler/providers/executor.js'`
- Add `import { executeWithTools } from './executor/tool-executor.js'`
- Before `initScheduler()`, call: `setExecuteWithTools(executeWithTools)`

**Modify `src/registry/agents.ts`**:
- Import scheduler agent from `../domains/scheduler/runtime/agent.js` instead of `../agents/scheduler/index.js`

**Modify `src/registry/tools.ts`**:
- Import scheduler tools from `../domains/scheduler/runtime/tools.js` instead of `../tools/scheduler.js`

#### Step 7: Move tests

**Move `tests/unit/tools/scheduler.test.ts`** to `tests/unit/domains/scheduler/tools.test.ts`. Update import paths from `../../../src/tools/scheduler` to `../../../../src/domains/scheduler/runtime/tools` (or keep importing from the compatibility shim if import paths are simpler during transition).

**Move `tests/unit/scheduler/`** (if it exists as a directory) to `tests/unit/domains/scheduler/`. Update import paths accordingly.

#### Acceptance

Run from WSL:

    npm run lint && npm run lint:architecture && npm run lint:agents && npm run test:unit && npm run test:integration && npm run build

Expected: all pass with no new violations. `npm run lint:agents` validates that the scheduler domain has `exposure: 'agent'`, `runtime/agent.ts` exists, `runtime/prompt.ts` exists, and the scheduler agent is present in `src/registry/agents.ts`.

Run:

    npm run docs:agents

Expected: `docs/generated/agent-catalog.md` includes the scheduler agent entry.

Verify server boot:

    npm run dev:server

Expected: scheduler initializes, poller starts, `/health` responds HTTP 200.

### Milestone 4: Migrate Email Watcher to Domain Layers

Create `src/domains/email-watcher/` with the layered package structure. Move email-watcher logic from `src/services/email-watcher/*` and `src/tools/email-skills.ts` into domain layers while preserving existing public entry points with compatibility re-exports.

Email-watcher is `exposure: 'tool-only'` — it has no standalone agent (no `src/agents/email-watcher/` directory exists). It exposes 6 tools for SMS-based skill management but runs as a background service, not as an orchestrator agent.

#### Step 1: Create domain type, capability, and repo layers

**Create `src/domains/email-watcher/types.ts`** — copy `src/services/email-watcher/types.ts` unchanged. Exports: `IncomingEmail`, `EmailAttachment`, `EmailSkill`, `ClassificationResult`, `SkillMatch`, `SkillValidationError`, `ThrottleState`.

**Create `src/domains/email-watcher/capability.ts`**:

    import type { DomainCapability } from '../../types/domain.js'

    export const capability: DomainCapability = {
      domain: 'email-watcher',
      exposure: 'tool-only',
      tools: ['create_email_skill', 'list_email_skills', 'update_email_skill', 'delete_email_skill', 'toggle_email_watcher', 'test_email_skill'],
    }

**Create `src/domains/email-watcher/repo/sqlite.ts`** — copy `src/services/email-watcher/sqlite.ts`. Change `./types` import to `../types.js`. Exports: `EmailSkillStore` class, `getEmailSkillStore`, `resetEmailSkillStore`.

#### Step 2: Create providers layer

**Create `src/domains/email-watcher/providers/gmail-sync.ts`** — copy `src/services/email-watcher/sync.ts`. Update imports:
- Change `../google/auth` to `../../../services/google/auth.js` as a temporary compatibility path. This must be rewired in Milestone 5 to `./google-core.js` so strict mode can pass without allowlisting `src/services/google/`.
- Change `../user-config/index` to `../../../services/user-config/index.js`
- Change `../../config` to `../../../config.js`
- Change `./types` to `../types.js`
- Exports: `syncNewEmails`, `prepareEmailForClassification`

**Create `src/domains/email-watcher/providers/classifier-llm.ts`** — copy `src/services/email-watcher/classifier.ts`. Update imports:
- Change `../anthropic/client` to `../../../services/anthropic/client.js`
- Change `./sqlite` to `../repo/sqlite.js`
- Change `../memory/index` to `../../../services/memory/index.js`
- Change `./prompt` to `../service/prompt.js`
- Change `../../config` to `../../../config.js`
- Change `./types` to `../types.js`
- Exports: `classifyEmails`

**Create `src/domains/email-watcher/providers/executor.ts`** — wraps the injected `executeWithTools` function, same pattern as scheduler:

    type ExecuteWithToolsFn = (
      systemPrompt: string,
      task: string,
      toolNames: string[],
      context: AgentExecutionContext
    ) => Promise<StepResult>

    let _executeWithTools: ExecuteWithToolsFn | null = null

    export function setExecuteWithTools(fn: ExecuteWithToolsFn): void {
      _executeWithTools = fn
    }

    export function getExecuteWithTools(): ExecuteWithToolsFn {
      if (!_executeWithTools) throw new Error('executeWithTools not initialized — call setExecuteWithTools() at bootstrap')
      return _executeWithTools
    }

Same note as Milestone 3 Step 2 regarding type-only imports from `src/executor/types.ts`.

#### Step 3: Create service layer

**Create `src/domains/email-watcher/service/actions.ts`** — copy `src/services/email-watcher/actions.ts` with these changes:
- Remove `import { executeWithTools } from '../../executor/tool-executor.js'` — replace with `import { getExecuteWithTools } from '../providers/executor.js'`
- Change `./sqlite` to `../repo/sqlite.js`
- Change `../user-config/index` to `../../../services/user-config/index.js`
- Change `../memory/index` to `../../../services/memory/index.js`
- Change `../../twilio` to `../../../twilio.js`
- Change `../../config` to `../../../config.js`
- Change `./types` to `../types.js`
- Change `../../executor/types` to `../../../executor/types.js` (type-only import; same caveat as Milestone 3 Step 2)
- Replace direct `executeWithTools(...)` call with `getExecuteWithTools()(...)`

**Create `src/domains/email-watcher/service/skills.ts`** — copy `src/services/email-watcher/skills.ts`. Update imports:
- Change `./sqlite` to `../repo/sqlite.js`
- Change `../user-config/index` to `../../../services/user-config/index.js`
- Change `./types` to `../types.js`
- Exports: `seedDefaultSkills`, `validateSkillDefinition`, `initEmailWatcherState`

**Create `src/domains/email-watcher/service/prompt.ts`** — copy `src/services/email-watcher/prompt.ts`. Update imports:
- Change `../../config` to `../../../config.js`
- Change `./types` to `../types.js`
- Exports: `buildClassifierPrompt`

#### Step 4: Create runtime layer

**Create `src/domains/email-watcher/runtime/index.ts`** — copy `src/services/email-watcher/index.ts` with these changes:
- Change `../../config` to `../../../config.js`
- Change `../scheduler/poller` to `../../../utils/poller.js`
- Change `../user-config/index` to `../../../services/user-config/index.js`
- Change `./sync` to `../providers/gmail-sync.js`
- Change `./classifier` to `../providers/classifier-llm.js`
- Change `./actions` to `../service/actions.js`
- Exports: `startEmailWatcher`, `stopEmailWatcher`

**Create `src/domains/email-watcher/runtime/tools.ts`** — copy `src/tools/email-skills.ts`. Update imports:
- Change `../services/email-watcher/sqlite.js` to `../repo/sqlite.js`
- Change `../services/email-watcher/skills.js` to `../service/skills.js`
- Change `../services/email-watcher/sync.js` to `../providers/gmail-sync.js`
- Change `../services/email-watcher/classifier.js` to `../providers/classifier-llm.js`
- Exports: `createEmailSkill`, `listEmailSkills`, `updateEmailSkill`, `deleteEmailSkill`, `toggleEmailWatcher`, `testEmailSkill` (6 ToolDefinition objects)

#### Step 5: Create compatibility adapters

**Modify `src/services/email-watcher/index.ts`** — replace with:

    // Compatibility adapter — remove in Milestone 6
    export * from '../../domains/email-watcher/runtime/index.js'

**Modify `src/services/email-watcher/types.ts`** — replace with:

    export * from '../../domains/email-watcher/types.js'

**Modify `src/services/email-watcher/sqlite.ts`** — replace with:

    export * from '../../domains/email-watcher/repo/sqlite.js'

**Modify `src/services/email-watcher/skills.ts`** — replace with:

    export * from '../../domains/email-watcher/service/skills.js'

**Modify `src/services/email-watcher/sync.ts`** — replace with:

    export * from '../../domains/email-watcher/providers/gmail-sync.js'

**Modify `src/services/email-watcher/classifier.ts`** — replace with:

    export * from '../../domains/email-watcher/providers/classifier-llm.js'

**Modify `src/services/email-watcher/actions.ts`** — replace with:

    export * from '../../domains/email-watcher/service/actions.js'

**Modify `src/services/email-watcher/prompt.ts`** — replace with:

    export * from '../../domains/email-watcher/service/prompt.js'

**Modify `src/tools/email-skills.ts`** — replace with:

    export * from '../domains/email-watcher/runtime/tools.js'

#### Step 6: Wire bootstrap, registries, and consumers

**Modify `src/index.ts`**:
- Add `import { setExecuteWithTools as setEmailWatcherExecuteWithTools } from './domains/email-watcher/providers/executor.js'`
- Before `startEmailWatcher()`, call: `setEmailWatcherExecuteWithTools(executeWithTools)`

**Modify `src/registry/tools.ts`**:
- Import email-watcher tools from `../domains/email-watcher/runtime/tools.js` instead of `../tools/email-skills.js`

**Modify `src/routes/auth.ts`**:
- Change `import { initEmailWatcherState } from '../services/email-watcher/skills.js'` to import from `../domains/email-watcher/service/skills.js` (or keep the compatibility shim import)

**Modify `src/admin/email-skills.ts`**:
- Change `import { getEmailSkillStore } from '../services/email-watcher/sqlite.js'` to import from `../domains/email-watcher/repo/sqlite.js` (or keep the compatibility shim import)

#### Step 7: Remove resolved exception

**Modify `config/architecture-boundaries.json`**:
- Remove the exception entry for `src/services/email-watcher/actions.ts → src/executor/tool-executor.ts` (deadline 2026-04-15). The `executeWithTools` import is now injected via `providers/executor.ts`.

#### Step 8: Move tests

**Move `tests/unit/tools/email-skills.test.ts`** to `tests/unit/domains/email-watcher/tools.test.ts`. Update import paths.

**Move `tests/unit/services/email-watcher/`** (if directory exists) to `tests/unit/domains/email-watcher/`. Update import paths.

**Update `tests/unit/admin/email-skills.test.ts`** — update imports if they referenced email-watcher service files directly.

#### Acceptance

Run from WSL:

    npm run lint && npm run lint:architecture && npm run lint:agents && npm run test:unit && npm run test:integration && npm run build

Expected: all pass with no new violations. `npm run lint:agents` validates that email-watcher has `exposure: 'tool-only'` and is NOT present in `src/registry/agents.ts`. The exception list in `config/architecture-boundaries.json` is now empty (the five Milestone 2 exceptions were removed in M2, and the final email-watcher exception is removed in this milestone).

Verify server boot:

    npm run dev:server

Expected: email watcher starts its background poller, scheduler continues to work, `/health` responds HTTP 200.

### Milestone 5: Expand Pattern and Tighten Enforcement

Migrate remaining domains. The order is constrained: `google-core` must be created first because calendar, email, and drive all depend on its shared OAuth2 and folder hierarchy infrastructure.

Note: `AuthRequiredError` was already moved to `src/providers/auth.ts` in Milestone 2 Fix 1. The google-core extraction here covers only the remaining Google-specific auth functions and drive folder hierarchy.

#### Step 1: Create `google-core` (internal)

Extract shared Google OAuth2 infrastructure and Hermes Drive folder hierarchy into `src/domains/google-core/`.

**Create `src/domains/google-core/types.ts`** — extract Google-specific type definitions: `GoogleClientOptions`, token-related types. Re-export `AuthRequiredError` from `src/providers/auth.ts` for convenience (so downstream domains can import it from google-core instead of needing a separate import).

**Create `src/domains/google-core/capability.ts`**:

    import type { DomainCapability } from '../../types/domain.js'

    export const capability: DomainCapability = {
      domain: 'google-core',
      exposure: 'internal',
    }

**Create `src/domains/google-core/providers/auth.ts`** — extract from `src/services/google/auth.ts`:
- `createOAuth2Client`, `getAuthenticatedClient`, `refreshAccessToken`, `withRetry`, `isInsufficientScopesError`, `handleScopeError`
- These functions import from `googleapis`, `../../../services/credentials/` (allowed), and `../../../config.js` (allowed)
- `AuthRequiredError` stays in `src/providers/auth.ts` (already moved in M2); import it from there

**Create `src/domains/google-core/service/drive-folders.ts`** — extract from `src/services/google/drive.ts`:
- `getOrCreateHermesFolder`, `moveToHermesFolder`, `searchFiles`
- These are the shared folder hierarchy functions consumed by drive, docs, and sheets domains
- Import auth from `../providers/auth.js`

**Modify `src/services/google/auth.ts`** — replace with re-export shim:

    // Compatibility adapter — remove in Milestone 6
    export * from '../../domains/google-core/providers/auth.js'
    export { AuthRequiredError } from '../../providers/auth.js'

**Verify**: `npm run test:unit && npm run build`

#### Step 1a: Rewire email-watcher Google auth ingress

Email-watcher's `gmail-sync` provider still uses a temporary import from `src/services/google/auth.ts` introduced in Milestone 4. Rewire it to the same `google-core` provider pattern used by calendar/email/drive so strict external rules can pass without special-casing `src/services/google/`.

**Create `src/domains/email-watcher/providers/google-core.ts`**:
- Re-export `getAuthenticatedClient`, `withRetry` from `../../google-core/providers/auth.js`
- This is the required `via` path for the `email-watcher -> google-core` cross-domain rule

**Modify `src/domains/email-watcher/providers/gmail-sync.ts`**:
- Change import from `../../../services/google/auth.js` to `./google-core.js`

**Modify `config/architecture-boundaries.json`**:
- Ensure `crossDomainRules.allowed` includes:

      {
        "from": "src/domains/email-watcher/",
        "to": "src/domains/google-core/",
        "via": "providers/google-core.ts",
        "reason": "Shared Google OAuth2 for Gmail history sync"
      }

**Verify**: `npm run lint:architecture && npm run test:unit -- --reporter=verbose tests/unit/services/email-watcher/`

#### Step 2: Create `calendar` (agent)

**Create `src/domains/calendar/`** per the domain structure diagram. Key files:

- **`types.ts`** — `CalendarEvent`, `CreateEventInput`, etc.
- **`capability.ts`** — `exposure: 'agent'`, `agentId: 'calendar-agent'`
- **`providers/google-core.ts`** — re-exports `getAuthenticatedClient`, `withRetry` from `../../google-core/providers/auth.js` (this is the required `via` path for the cross-domain rule)
- **`providers/google-calendar.ts`** — move `src/services/google/calendar.ts` here (minus `AuthRequiredError` which is already in `src/providers/auth.ts`). Import auth via `./google-core.js`
- **`service/calendar.ts`** — extract business logic from `src/tools/calendar.ts` tool handlers into service functions
- **`runtime/tools.ts`** — calendar ToolDefinition[] (schemas from `src/tools/calendar.ts`, handlers call service layer)
- **`runtime/agent.ts`** — from `src/agents/calendar/index.ts`
- **`runtime/prompt.ts`** — from `src/agents/calendar/prompt.ts`

Create compatibility shims in `src/services/google/calendar.ts`, `src/tools/calendar.ts`, and `src/agents/calendar/`.

Wire into `src/registry/agents.ts` and `src/registry/tools.ts`.

**Verify**: `npm run test:unit && npm run lint:architecture && npm run lint:agents && npm run build`

#### Step 3: Create `email` (agent)

**Create `src/domains/email/`** per the domain structure diagram. Key files:

- **`types.ts`** — `EmailSearchResult`, `EmailThread`, `EmailMessage`, `EmailProvider` interface
- **`capability.ts`** — `exposure: 'agent'`, `agentId: 'email-agent'`
- **`providers/google-core.ts`** — re-exports from google-core (required `via` path)
- **`providers/gmail.ts`** — move `src/services/google/gmail.ts` here, implement `EmailProvider` interface for future provider swaps
- **`service/email.ts`** — email search/read logic against `EmailProvider` interface
- **`runtime/tools.ts`** — email ToolDefinition[] from `src/tools/email.ts`
- **`runtime/agent.ts`** — from `src/agents/email/index.ts`
- **`runtime/prompt.ts`** — from `src/agents/email/prompt.ts`

Create compatibility shims. Wire into registries.

Note: `src/domains/email/` (the Gmail agent domain) is distinct from `src/domains/email-watcher/` (the background skill-based email processor). The email domain handles interactive "search my email" requests; email-watcher handles autonomous classification and actions.

**Verify**: `npm run test:unit && npm run lint:architecture && npm run lint:agents && npm run build`

#### Step 4: Create `drive` (agent)

**Create `src/domains/drive/`** per the domain structure diagram. Key files:

- **`types.ts`** — `DriveFile`, `SheetRange`, `DocContent`, vision types
- **`capability.ts`** — `exposure: 'agent'`, `agentId: 'drive-agent'`
- **`providers/google-core.ts`** — re-exports auth + `getOrCreateHermesFolder`, `moveToHermesFolder`, `searchFiles` from google-core (required `via` path)
- **`providers/google-drive.ts`** — move `src/services/google/drive.ts` file operations here (minus folder hierarchy which is now in google-core)
- **`providers/google-sheets.ts`** — move `src/services/google/sheets.ts`
- **`providers/google-docs.ts`** — move `src/services/google/docs.ts`
- **`providers/gemini-vision.ts`** — move `src/services/google/vision.ts`
- **`service/drive.ts`** — file management, spreadsheet ops, doc ops, image analysis
- **`runtime/tools/`** — `drive.ts`, `sheets.ts`, `docs.ts`, `vision.ts` ToolDefinitions
- **`runtime/agent.ts`** — from `src/agents/drive/index.ts`
- **`runtime/prompt.ts`** — from `src/agents/drive/prompt.ts`

Create compatibility shims. Wire into registries.

After this step, `src/services/google/` should be nearly empty (only the compatibility re-export shims remain). Verify that the cross-domain `via` constraints are enforced: all drive imports from google-core must go through `providers/google-core.ts`.

**Verify**: `npm run test:unit && npm run lint:architecture && npm run lint:agents && npm run build`

#### Step 5: Create `memory` (agent)

**Create `src/domains/memory/`** per the domain structure diagram. Key files:

- **`types.ts`** — `UserFact`, `MemoryStore` from `src/services/memory/types.ts`
- **`capability.ts`** — `exposure: 'agent'`, `agentId: 'memory-agent'`
- **`repo/sqlite.ts`** — from `src/services/memory/sqlite.ts`
- **`service/processor.ts`** — from `src/services/memory/processor.ts`. Change poller import to `../../../utils/poller.js`
- **`service/ranking.ts`** — from `src/services/memory/ranking.ts`
- **`service/prompts.ts`** — from `src/services/memory/prompts.ts`
- **`runtime/index.ts`** — from `src/services/memory/index.ts`
- **`runtime/tools.ts`** — from `src/tools/memory.ts`
- **`runtime/agent.ts`** — from `src/agents/memory/index.ts`
- **`runtime/prompt.ts`** — from `src/agents/memory/prompt.ts`

Create compatibility shims. Wire into registries.

**Verify**: `npm run test:unit && npm run lint:architecture && npm run lint:agents && npm run build`

#### Step 6: Create `ui` (agent)

**Create `src/domains/ui/`** per the domain structure diagram. Key files:

- **`types.ts`** — page types, storage provider interface from `src/services/ui/providers/types.ts`
- **`capability.ts`** — `exposure: 'agent'`, `agentId: 'ui-agent'`
- **`service/generator.ts`** — from `src/services/ui/generator.ts`
- **`service/validator.ts`** — from `src/services/ui/validator.ts`
- **`runtime/tools.ts`** — from `src/tools/ui.ts`
- **`runtime/agent.ts`** — from `src/agents/ui/index.ts`
- **`runtime/prompt.ts`** — from `src/agents/ui/prompt.ts`
- **`runtime/pages.ts`** — page serving route handler from `src/routes/pages.ts`
- **`runtime/providers/local-storage.ts`** — from `src/services/ui/providers/`
- **`runtime/providers/memory-shortener.ts`** — from `src/services/ui/providers/`

Create compatibility shims. Wire into registries.

Note: `runtime/pages.ts` is a route handler that moves into the domain's runtime layer. `src/routes/` should import from the domain and delegate to it, keeping the route file as a thin wiring layer.

**Verify**: `npm run test:unit && npm run lint:architecture && npm run lint:agents && npm run build`

#### Step 7: Strict-mode preflight

After all six domains are migrated:

1. Verify the `exceptions` array in `config/architecture-boundaries.json` is empty.
2. Run `npm run lint:architecture -- --strict` and confirm exit 0. In strict mode, any domain import from a top-level path not in the `allowed` list must fail.
3. Verify all cross-domain `via` constraints are enforced for Google domains (calendar, email, drive, and email-watcher all import google-core only through `providers/google-core.ts`).
4. Keep `package.json` default command non-strict until Milestone 6 finalization.

#### Step 8: Move tests

Move test files for each domain from `tests/unit/services/<name>/` and `tests/unit/tools/<name>.test.ts` to `tests/unit/domains/<name>/`. Update import paths. Verify all tests still pass.

#### Acceptance

Run from WSL:

    npm run lint && npm run lint:architecture && npm run lint:agents && npm run test:unit && npm run test:integration && npm run build
    npm run lint:architecture -- --strict

Expected: all pass. The `exceptions` array is empty. Strict-mode preflight (`npm run lint:architecture -- --strict`) passes with zero violations. All 8 domains (google-core, scheduler, email-watcher, calendar, email, drive, memory, ui) pass domain-layer rules. Cross-domain `via` constraints are enforced for all Google domains.

Run:

    npm run docs:agents

Expected: `docs/generated/agent-catalog.md` lists all 7 agent domains (scheduler, calendar, email, drive, memory, ui, general) and omits tool-only (email-watcher) and internal (google-core) domains from the agent list while documenting their existence.

Generate final edge report:

    npm run lint:architecture -- --report > docs/generated/architecture-deps-post-m5.txt

### Milestone 6: Finalize and Document

Remove compatibility adapters once callers are updated. Finalize `domainExternalRules` as an explicit allowlist (no implicit external imports), update `package.json` to make strict mode the default (`"lint:architecture": "node scripts/check-layer-deps.mjs --strict"`), update `ARCHITECTURE.md` to move language from “target” to “enforced” for completed domains, and add a short “how to add a new domain module” orientation in `docs/DESIGN.md` (or a new focused design doc if needed).

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

Revision Note (2026-02-21): Major domain boundary revision based on code-level dependency analysis. Added `google-core` internal domain for shared Google OAuth2 and folder hierarchy. Updated calendar, email, drive domains to import google-core via `providers/google-core.ts` re-exports. Removed `media` from domain list (stays as shared infrastructure — no tools, no agent, no persistence). Split auth into provider-agnostic top-level (`AuthRequiredError`, `generateAuthUrl` in `src/providers/auth.ts`) and Google-specific (`getAuthenticatedClient`, `withRetry` in `google-core/providers/auth.ts`). Added `crossDomainRules` (deny-by-default + allowlist with `via` constraint) and `domainExternalRules` (allowed/forbidden top-level imports from domains) to boundary config. Fixed `domainLayerRules`: `repo` adds `types`, `runtime` adds `config`, `ui` changed from `runtime` to `service`. Added email-watcher → executor edge to exceptions. Moved orphaned tools (maps, user-config) to `src/registry/shared-tools.ts`. Updated Milestone 2 Fix 1 to include `AuthRequiredError` relocation. Updated Milestone 5 with ordered migration sequence starting from google-core. Updated checker script spec for cross-domain and external rule enforcement.

Revision Note (2026-02-21): Milestones 3, 4, and 5 expanded to match detail level of Milestones 1 and 2. Key changes: (1) Extracted `createIntervalPoller` to `src/utils/poller.ts` as shared infrastructure (used by scheduler, email-watcher, memory — cannot live inside any single domain). (2) Added `providers/executor.ts` injection pattern to both scheduler and email-watcher domains for `executeWithTools` dependency. (3) Added `src/services/anthropic/`, `src/services/user-config/`, `src/twilio.ts`, `src/utils/` to `domainExternalRules.allowed` (all consumed by domains, confirmed by import analysis). (4) Added `capability.ts` to scheduler, email-watcher, memory, and ui domain diagrams (were missing). (5) Resolved email-watcher exposure as definitively `tool-only` (no agent directory exists). (6) Fixed M5 step 1 duplication with M2 Fix 1 (`AuthRequiredError` relocation already done in M2). (7) Added explicit consumer lists, compatibility adapter specs, exception cleanup steps, registry wiring, and test migration for M3 and M4. (8) Added strict-mode enablement step and final edge report generation to M5.

Revision Note (2026-02-21): Addressed review consistency gaps. Corrected baseline exception count (6), updated Milestone 2/4 exception lifecycle expectations, added required `owner` metadata to exception schema examples, clarified `domainExternalRules` strict semantics (warnings in default mode, violations in strict mode), added explicit Milestone 5 rewire for email-watcher auth ingress (`services/google/auth` -> domain `providers/google-core.ts`), expanded cross-domain allowlist for `email-watcher -> google-core`, and moved "strict by default" package script switch to Milestone 6 finalization.
