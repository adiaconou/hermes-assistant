# Introduce Generic Filesystem Skills (`skills/<name>/SKILL.md`) and Retire Email-Specific Skills

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` is checked into this repository and is the governing standard for this document. This file must be maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

Today Hermes has one skill system that is tightly scoped to the email watcher (`email_skills` rows in SQLite). After this change, Hermes will support Anthropic-style filesystem skills: each skill lives in `skills/<skill-name>/SKILL.md` with optional bundled resources (for example `scripts/`, `references/`, `assets/`, `agents/`). This lets contributors add reusable cross-domain skills without creating new hardcoded agents or preserving an email-only skill subsystem.

A user-visible way to verify the change is to add a new skill folder, run the server, send an SMS, and observe the orchestrator select either a skill or an agent step based on the request. A second verification path is to run a skill validation command and see clear validation errors for malformed skill packs.

## Progress

- [x] (2026-02-22 02:19Z) Revised architecture to orchestrator-first skill selection for conversational flows; direct skill invocation retained only for background triggers.
- [x] (2026-02-22 16:10Z) Created this ExecPlan in `docs/exec-plans/active/generic-skills-framework.md` with requirements, milestones, interfaces, and acceptance criteria.
- [x] (2026-02-22 16:20Z) Revised scope to require full decommission of legacy email-skill architecture after filesystem skill architecture is in place.
- [x] (2026-02-22 17:05Z) Made explicit app-level skill registry requirements and documented scheduler access via cross-domain provider bridge (`scheduler/providers/skills.ts` -> `domains/skills/runtime`).
- [x] (2026-02-21) Revised plan to fix architecture violations, type accuracy, deployment safety, and PLANS.md compliance issues identified during review.
- [ ] Implement Milestone 1: add the new `skills` domain, parser, validator, loader, and bootstrap wiring.
- [ ] Implement Milestone 2: integrate skills into planner/executor so orchestrator chooses `skill` or `agent` for conversational requests.
- [ ] Implement Milestone 3: add direct skill invocation for background triggers (scheduler and email watcher).
- [ ] Implement Milestone 4: add deployment ergonomics, admin visibility, docs updates, and migration tooling.
- [ ] Implement Milestone 5: migrate and remove legacy email skill storage, APIs, tools, and UI.

## Surprises & Discoveries

- Observation: `docs/archive/design-docs/skills-system-design.md` already describes a generalization effort, but it uses pre-refactor paths (`src/services/...`) and has not been applied to the current domain-layered layout.
  Evidence: Current code uses `src/domains/email-watcher/*`, while the draft design references `src/services/email-watcher/*`.

- Observation: The only active skill subsystem in runtime is email-watcher-specific and is deeply integrated across tools, admin routes, and prompt text.
  Evidence: `src/domains/email-watcher/repo/sqlite.ts`, `src/domains/email-watcher/runtime/tools.ts`, `src/admin/email-skills.ts`, and `src/admin/views/email-skills.html` all assume email-only semantics and the `email_skills` table.

- Observation: There is no existing `skills/` directory or SKILL.md loader in Hermes.
  Evidence: Repository search returns no `skills/<name>/SKILL.md` usage and no filesystem skill-loading module.

## Decision Log

- Decision: Interim compatibility is not required during migration; only final migrated behavior is required.
  Rationale: The user explicitly prefers simpler architecture work over maintaining temporary dual-path stability.
  Date/Author: 2026-02-22 / Codex

- Decision: Treat Anthropic-style skill folders as prompt/runtime assets, not executable code packages.
  Rationale: `scripts/` resources may exist inside a skill pack, but Hermes will not auto-execute arbitrary files; execution remains mediated by existing tool handlers and `executeWithTools`.
  Date/Author: 2026-02-22 / Codex

- Decision: Resolve terminology conflict by using “email automation skills” for the existing DB-backed watcher rules and “filesystem skills” (or “skill packs”) for the new SKILL.md framework.
  Rationale: The repository currently uses “skills” to mean email-watcher rules. Without explicit naming separation, requirements and code paths remain ambiguous.
  Date/Author: 2026-02-22 / Codex

- Decision: Include an explicit data migration and decommission milestone for `email_skills` and related email-skill APIs/tools/UI.
  Rationale: The user requirement is to avoid permanent parallel systems. Migration must preserve useful existing data while deleting email-specific codepaths.
  Date/Author: 2026-02-22 / Codex

- Decision: Conversational skill usage must be orchestrator-native: the planner chooses between skills and agents, and the executor dispatches accordingly.
  Rationale: This avoids maintaining a parallel request-time routing lane and keeps planning logic in one place.
  Date/Author: 2026-02-22 / Codex

- Decision: Direct skill invocation is allowed only for background triggers (email watcher and scheduler).
  Rationale: Background pipelines are event-driven and do not naturally flow through conversational planning.
  Date/Author: 2026-02-22 / Codex

- Decision: Keep `domains/skills` scaffolding minimal; do not add layers or abstractions beyond what is needed for load/validate/registry/execute.
  Rationale: Skill files are primarily prompt artifacts, so architecture code should stay thin and operational, not framework-heavy.
  Date/Author: 2026-02-22 / Codex

- Decision: Use an OpenClaw-style harness behavior: compact skill catalog in planner context, on-demand `SKILL.md` body loading at execution time.
  Rationale: This controls token usage while keeping skill invocation model-led within the orchestrator loop.
  Date/Author: 2026-02-22 / Codex

- Decision: Use single-user skill storage semantics. Do not implement per-user skill partitioning.
  Rationale: Hermes is currently single-user; per-user scoping would add unnecessary complexity and maintenance overhead.
  Date/Author: 2026-02-22 / Codex

- Decision: Keep a dedicated app-level skill registry facade (`src/registry/skills.ts`) even though orchestration is unified.
  Rationale: A stable registry seam simplifies cross-domain access, keeps imports layer-safe, and provides one contract for orchestrator plus background-provider bridges.
  Date/Author: 2026-02-22 / Codex

- Decision: Use `gray-matter` for YAML frontmatter parsing rather than writing a custom parser.
  Rationale: YAML has non-obvious edge cases (multiline strings, type coercion, anchors) that make custom parsers error-prone. `gray-matter` is focused, widely used, and returns both parsed data and body content separately, which aligns with the on-demand body loading design. No YAML-related dependency currently exists in the project.
  Date/Author: 2026-02-21 / Claude

- Decision: Use an explicit `SKILLS_ENABLED` feature flag (default `false` during migration, `true` after Milestone 2 acceptance) to gate skill loading and planner skill-step generation. During migration, the email watcher should be disabled via the existing `EMAIL_WATCHER_ENABLED` flag if its skill source is being swapped, and re-enabled after Milestone 5 validation.
  Rationale: Even though interim compatibility is not required, production runs continuously. A feature flag prevents partial-migration states from affecting live request handling, and the existing email watcher toggle avoids in-flight email processing against a half-migrated skill source. Scheduler jobs with `skillName` references that do not yet resolve should fail gracefully with a logged error rather than crash.
  Date/Author: 2026-02-21 / Claude

## Outcomes & Retrospective

Initial state: plan authored, no implementation changes yet. Intermediate milestones may temporarily break old behavior; the required bar is that the final milestone delivers complete migration with legacy email-skill architecture removed.

## Context and Orientation

Hermes currently has two request-time paths that matter for this feature:

1. `src/routes/sms.ts` handles inbound SMS/WhatsApp. It sends a fast TwiML acknowledgment, then does async work via `processAsyncWork()` which currently always calls `handleWithOrchestrator(...)`.
2. `src/domains/scheduler/service/executor.ts` runs scheduled prompts by calling `executeWithTools(...)` with `READ_ONLY_TOOLS`.

Runtime-loop model for this plan:

- Conversational requests use one runtime loop: Twilio webhook -> sync classifier/ack -> orchestrator (planner + executor + composer).
- Background pipelines (scheduler and email watcher) are separate loops by design and may invoke skills directly.

The current “skill” concept is email-only:

- Storage is `email_skills` in `data/credentials.db` via `src/domains/email-watcher/repo/sqlite.ts`.
- Runtime management is in `src/domains/email-watcher/runtime/tools.ts`.
- Admin API/UI is `src/admin/email-skills.ts` and `src/admin/views/email-skills.html`.

This plan introduces a filesystem skill model using Anthropic-style structure, then makes it the only skill model after cutover. In this document, “filesystem skill” means:

- A folder at `skills/<skill-name>/`.
- A required `SKILL.md` with YAML frontmatter containing at minimum `name` and `description`.
- Optional resource subfolders (`references/`, `assets/`, `scripts/`, `agents/`) whose contents are treated as read-only context for the LLM, not as executable code. When a skill executes, the executor reads referenced files from these subfolders and injects their content into the skill's system prompt alongside the SKILL.md body. For example, a `references/receipts.md` file would be included as additional context when the receipt-summarizer skill runs. The `scripts/` subfolder follows the same pattern — script file contents are provided as prompt context (e.g., showing the LLM a normalization procedure to follow), but Hermes never shells out to execute them. This is enforced by the skill executor reading files through `repo/filesystem.ts`, which only performs safe reads with path-traversal guards.

This work must respect the existing layered-domain architecture described in `ARCHITECTURE.md` and enforced by `config/architecture-boundaries.json`.

## Skills vs Agents Distinction

This plan treats skills and agents as complementary, not competing abstractions.

- A **skill** is a workflow definition artifact (`SKILL.md` + metadata). It encodes repeatable task structure, constraints, and expected outputs. Skills are data-defined and easier to add or modify without shipping new runtime code.
- An **agent** is a code-defined domain capability (`runtime/agent.ts`) that uses model reasoning over a bounded tool set to handle broader or less-structured domain tasks.

In practical terms:

- Use a skill when the task benefits from explicit workflow framing (for example extraction/checklist/transform/report pipelines).
- Use an agent when the task needs open-ended domain reasoning, domain-specific runtime behavior, or tighter code-level controls.

To avoid duplicate abstractions:

- Conversational execution uses one planner/executor substrate (`targetType: skill | agent`), not two separate orchestration systems.
- Every new capability starts as a skill by default unless it requires code-level runtime semantics.
- Promotion path is explicit: when a skill repeatedly needs custom runtime logic, promote it to an agent and retire or reduce the skill.

## Requirements

Filesystem skills must be first-class runtime inputs that can be added and deployed by adding folders under `skills/` and shipping them with the app. Hermes must load valid skills at startup, surface invalid skills with actionable errors, and use valid skills in the final migrated request handling architecture.

Hermes discovers skills from two locations: bundled skills at repository root `skills/` and imported runtime skills at `data/skills/imported/`. Both are exposed through a unified in-memory registry at startup. Each skill's `SKILL.md` frontmatter is parsed safely to extract manifest data (`name`, `description`, plus optional Hermes-specific metadata under `metadata.hermes`). Hermes-specific metadata is additive — a valid skill needs only `name` and `description`, keeping compatibility with the standard SKILL.md convention.

Conversational requests (SMS/WhatsApp) use orchestrator-native selection: the planner chooses between a skill step and an agent step based on a compact skill catalog injected alongside the agent capability list. Skills are represented similarly to agents (name, description, trigger hints, allowed channels and tools). Full `SKILL.md` body content is never injected into the planner prompt — it is loaded on demand only when the executor dispatches a skill step. Skills may reference or delegate to agents through explicit metadata (`delegateAgent`), and runtime execution must support that delegation safely. Planner guidance must distinguish workflow-oriented skill use from domain-oriented agent use so both abstractions remain coherent and non-duplicative.

Background triggers (scheduler and email watcher) may invoke skills directly without planner involvement, using the skill matcher and executor APIs through cross-domain provider bridges.

Skill loading must be safe: no path traversal, no symlink escape, no automatic script execution, and no dynamic `eval` or import of skill-pack files. Deployment must be deterministic — skills present in source must be available at runtime in both `npm run dev` and `npm start` (production dist build). Operators need visibility into loaded skills and validation failures through startup logs and a read-only admin endpoint.

Legacy `email_skills` data must have an explicit migration path (or explicit archival export) before the table and codepaths are removed. The final state must remove all email-specific skill artifacts: the CRUD tools (`create_email_skill`, `list_email_skills`, `update_email_skill`, `delete_email_skill`), the admin email-skills page and API, and `email_skills` table access code.

The skill registry must be an explicit and stable public runtime contract (list, find, errors, execute-by-name). All non-skills domains must access skills through this contract or cross-domain provider bridges, never by importing skills-domain internals. Unit and integration tests must prove planner skill selection, executor dispatch, background-trigger invocation, migration behavior, and decommission behavior.

## Layer Compliance Strategy

This section defines exactly how this feature stays compliant with the forward-layer architecture and where skill content lives.

### Skill Storage (Content vs. Code)

- Skill content files (`SKILL.md`, `references/`, `assets/`, `scripts/`) are not domain code and must not live under `src/domains/`.
- Bundled/versioned skills live at repository root: `skills/<skill-name>/SKILL.md`.
- Imported runtime skills live in data storage: `data/skills/imported/<skill-name>/SKILL.md` (or `/app/data/skills/imported/...` in production).
- Domain code for loading/parsing/executing skills lives in `src/domains/skills/`.

### Forward-Layer Rules for `src/domains/skills/`

- `types` defines skill manifests and execution result types only.
- `config` reads skill-path configuration and defaults.
- `repo/filesystem` handles directory scanning and file reads only.
- `providers` contains injected bridges (for example `executeWithTools` access).
- `service` contains parser, validator, registry, and execution orchestration.
- `runtime/index.ts` is the only public entrypoint consumed by orchestrator and background domains.
- `src/registry/skills.ts` provides the app-level registry facade over `domains/skills/runtime` for consumers that should not know skills-domain internals.

No layer may import backward. `service` must not import `runtime`; `repo` must not import `service`; and `domains/skills` must not import `src/orchestrator/` or `src/executor/` directly.

### Cross-Domain Integration Rules

- Conversational routing: orchestrator imports only `src/registry/skills.ts` (preferred) or `src/domains/skills/runtime/index.ts`, never service/repo internals.
- Scheduler and email-watcher access skills through cross-domain provider bridges (`providers/skills.ts`) that re-export from `src/domains/skills/runtime/index.ts`, following the same pattern as `scheduler/providers/memory.ts`. Each bridge requires a declared `crossDomainRules` entry in `config/architecture-boundaries.json` with a `via` constraint pointing to the provider file. Domains must never import `src/registry/` directly — that path is forbidden by `domainExternalRules`.
- Skill-to-agent delegation is resolved by orchestrator/executor dispatch logic or injected callbacks, never by direct `domains/skills` imports of agent registry internals.

### Mechanical Verification

Every milestone that edits architecture-sensitive files must pass:

    npm run lint:architecture --strict
    npm run test:unit

If a new cross-domain edge is needed, add it explicitly to `config/architecture-boundaries.json` with a `via` provider file and reason.

## Plan of Work

### Milestone 1: Skill Pack Domain, Parsing, Validation, and Startup Registry

Create a new domain at `src/domains/skills/` with a layered structure that mirrors current conventions:

- `src/domains/skills/types.ts` defines manifest, loaded skill, and execution context/result types.
- `src/domains/skills/config.ts` reads defaults such as root directory and confidence threshold from `src/config.ts`.
- `src/domains/skills/repo/filesystem.ts` scans skill directories and reads files safely.
- `src/domains/skills/service/parser.ts` parses `SKILL.md` frontmatter and body.
- `src/domains/skills/service/validator.ts` validates required fields and Hermes-specific metadata.
- `src/domains/skills/service/registry.ts` builds an in-memory registry of loaded skills plus load errors.
- `src/domains/skills/providers/executor.ts` receives injected `executeWithTools` dependency.
- `src/domains/skills/runtime/index.ts` exposes init/get/list APIs.
- `src/registry/skills.ts` exposes app-level skill registry APIs used by orchestrator and provider bridges.
- `src/domains/skills/capability.ts` declares domain metadata with `exposure: 'internal'`. The skills domain does not expose its own agent or tools — it is infrastructure consumed by the orchestrator (via the registry facade) and by other domains (via provider bridges). Skills are dispatched through the existing orchestrator executor and agent tool execution loop, not through a dedicated skills agent.

Wire startup in `src/index.ts` so skills are loaded once after config validation and before routes begin handling traffic.

Add a simple script-driven validation entry point (for CI and local authoring), for example `scripts/skills/validate.mjs` and `npm run skills:validate`, using the same parser/validator as runtime.

Milestone acceptance: skills load with structured success/error reporting, and startup behavior is deterministic for valid and invalid skill packs.

### Milestone 2: Orchestrator-Native Skill Routing (Conversational Flows)

Integrate skills into planner and executor so orchestrator decides between skills and agents:

- Add skill catalog formatting to planner context (parallel to agent capability formatting).
- Ensure planner input uses compact skill metadata only (no eager full `SKILL.md` injection).
- Update planner prompt/rules so steps may target either an agent or a skill, with explicit guidance: prefer skills for structured workflows and agents for broader domain reasoning.
- Extend orchestrator step schema/types to encode step target type (`agent` or `skill`).
- Add skill dispatch in executor path so skill steps call `executeFilesystemSkill(...)`.
- Load the selected skill body on demand during skill-step execution.
- Keep existing agent dispatch unchanged for agent steps.
- Add explicit logging for planner skill selection and executor skill dispatch.

This milestone should not introduce route-level pre-matching in `src/routes/sms.ts`; conversational requests continue to enter orchestrator normally.

Milestone acceptance: for conversational SMS/WhatsApp, the planner can choose a skill step when appropriate and choose an agent step otherwise; both paths execute through one orchestrator pipeline.

### Milestone 3: Direct Skill Invocation for Background Triggers

Add direct invocation where planning is not the right entry point:

- Extend scheduler schema and tools to support explicit filesystem-skill execution by name.
- Update scheduler executor to run `executeFilesystemSkill(...)` for scheduler skill jobs.
- Add email watcher skill matching/execution against filesystem skills scoped for `email` channel.
- Support optional skill-to-agent delegation in runtime execution for cases where a background skill should hand off to a specialized agent.

Milestone acceptance: scheduler and email watcher can invoke filesystem skills directly without planner, while conversational requests still go through orchestrator routing.

### Milestone 4: Deployment Ergonomics, Admin Visibility, and Migration

Ensure filesystem skills are deployable and observable, and migrate email-skill data:

- Update build scripts to copy `skills/` into dist artifact (or guarantee runtime path points to source tree in deployment environment).
- Add read-only admin/debug endpoint and/or admin page for loaded filesystem skills and validation errors at `/admin/api/skills` (not `/admin/api/skills/filesystem` — after Milestone 5, filesystem skills are the only skill system, so the path should be clean).
- Add migration tooling to convert legacy `email_skills` rows into filesystem skill packs under a runtime path (for example `data/skills/imported/<skill>/SKILL.md`) with an audit log.
- Add authoring and migration documentation at `docs/archive/design-docs/` (new design doc or update existing `skills-system-design.md`) describing folder structure, metadata, execution semantics, migration semantics, and safety boundaries.
- Update `ARCHITECTURE.md` and relevant docs (`PRODUCT_SENSE.md`, `FRONTEND.md` admin route table) to reflect orchestrator-native skill routing and upcoming email-skill removal.

Milestone acceptance: production build contains skill packs, admin endpoint reports loaded packs, migration tooling produces imported skill packs and audit output, and docs describe the decommission path.

### Milestone 5: Email Skill Decommission and Final Cleanup

Remove legacy email-specific skill architecture after migration is validated:

- Update email watcher classifier/action code to consume filesystem skills filtered by `channels` including `email`.
- Remove `src/domains/email-watcher/repo/sqlite.ts` usage from runtime paths and eliminate `email_skills` table reads/writes in application logic.
- Remove email skill CRUD tool definitions from `src/domains/email-watcher/runtime/tools.ts` and remove registrations from `src/tools/index.ts` and `src/domains/email/runtime/agent.ts`.
- Remove admin email-skill endpoints/UI (`src/admin/email-skills.ts`, `/admin/api/email-skills/*`, `/admin/email-skills`).
- Keep non-skill email watcher behavior intact (`toggle_email_watcher`, Gmail sync/classification/action execution) using filesystem skills as the only skill source.
- Remove temporary migration helpers that are no longer needed at runtime after cutover.

Milestone acceptance: no production codepath depends on `email_skills` architecture, no email-skill CRUD tools/endpoints remain exposed, and email watcher continues to process email via filesystem skills.

## Concrete Steps

Work from `/mnt/c/Code/hermes-assistant` in WSL.

1. Implement Milestone 1 and run:

    npm run lint:architecture
    npm run test:unit
    npm run build

2. Implement Milestone 2 and run:

    npm run test:unit
    npm run test:integration
    npm run build

3. Implement Milestone 3 and run:

    npm run test:unit
    npm run test:integration
    npm run lint
    npm run build

4. Implement Milestone 4 and run:

    npm run skills:validate
    npm run test:unit && npm run test:integration
    npm run lint && npm run build

5. Implement Milestone 5 and run:

    npm run skills:validate
    npm run test:unit && npm run test:integration
    npm run lint:architecture && npm run lint
    npm run build

Expected high-level output at each stage is “all tests pass, zero lint errors, build succeeds”, plus startup logs showing filesystem skill load results.

## Validation and Acceptance

Acceptance is behavior-first and must be demonstrated with tests plus manual checks.

Required automated coverage:

- Parser/validator tests for SKILL.md frontmatter and malformed files.
- Registry loading tests for missing folders, invalid folders, and valid folders.
- Planner/executor tests proving skill-step selection and dispatch for conversational flows.
- Planner tests proving workflow-style requests resolve to skill steps and open-ended domain requests resolve to agent steps.
- Scheduler tests proving background skill invocation works after migration.
- Email watcher tests proving direct background matching/execution against filesystem skills.
- Admin/API tests for listing filesystem skills and load errors.
- Migration tests proving `email_skills` export/transform behavior.
- Decommission tests proving email-skill CRUD tools and admin routes are no longer registered after cutover.

Required manual checks:

1. Create a sample skill at `skills/sample-reminder-helper/SKILL.md`.
2. Start server with `npm run dev:server`.
3. Send a conversational message that should map to this skill and verify planner chooses a skill step and executor dispatches it.
4. Send a conversational message that should map to a normal agent and verify planner chooses an agent step.
5. Trigger a scheduled job with `skill_name` and verify execution uses direct background skill invocation.
6. Trigger email watcher processing for a matching email and verify direct background skill invocation is used.
7. Run migration and verify no skill rows are silently dropped.
8. After Milestone 5, verify legacy email-skill commands/endpoints are retired and email watcher still processes email using filesystem skills only.

## Idempotence and Recovery

The implementation must be safe to rerun:

- Registry loading is read-only over filesystem and can run repeatedly.
- Validation command should be deterministic for the same directory state.
- SQLite migrations for scheduler must use additive `ALTER TABLE ... ADD COLUMN` with existence guards.
- Email-skill migration tooling must write an audit artifact (JSON or CSV) so migrated records can be verified and replayed.
- Before deleting legacy email-skill codepaths, take a one-time backup/export of `email_skills` rows.
- If a single skill is malformed, Hermes should skip that skill and continue running with clear error logs; malformed skill files should never crash startup after initial parser hardening is complete.

## Artifacts and Notes

Example expected filesystem skill layout:

    skills/
      receipt-summarizer/
        SKILL.md
        references/
          receipts.md
        scripts/
          normalize-receipt.sh
        assets/
          template.csv

Example minimum `SKILL.md` shape:

    ---
    name: receipt-summarizer
    description: Summarize receipt-like messages and extract merchant, total, and date.
    metadata:
      hermes:
        channels: [sms, whatsapp, scheduler]
        tools: [analyze_image, append_to_spreadsheet, find_spreadsheet]
        delegate_agent: drive-agent
        match:
          - "summarize this receipt"
          - "track this expense"
    ---

    # Receipt Summarizer

    When invoked, extract merchant name, transaction date, total amount, and category.
    If confidence is low, say what is missing instead of inventing values.

These examples are illustrative and should be kept aligned with actual parser/validator rules as implementation proceeds.

## Interfaces and Dependencies

Define these interfaces during implementation so downstream modules have stable contracts:

In `src/domains/skills/types.ts`, define:

    export type SkillChannel = 'sms' | 'whatsapp' | 'scheduler' | 'email';

    export type SkillFrontmatter = {
      name: string;
      description: string;
      metadata?: {
        hermes?: {
          channels?: SkillChannel[];
          tools?: string[];
          match?: string[];
          enabled?: boolean;
          delegateAgent?: string;
        };
      };
    };

    export type LoadedSkill = {
      name: string;
      description: string;
      markdownPath: string;
      rootDir: string;
      channels: SkillChannel[];
      tools: string[];
      matchHints: string[];
      enabled: boolean;
      source: 'bundled' | 'imported';
      delegateAgent?: string | null;
    };

The `LoadedSkill` type intentionally omits `body`. Skill bodies (the markdown content below the frontmatter) are loaded on demand at execution time, not at startup. This keeps the in-memory registry compact and avoids injecting large prompt text into planner context. To read a skill body, use `loadSkillBody(skill: LoadedSkill): Promise<string>` from `src/domains/skills/repo/filesystem.ts`, which reads `skill.markdownPath` and returns the content below the frontmatter separator.

    export type SkillLoadError = {
      skillDir: string;
      error: string;
      source: 'bundled' | 'imported';
    };

    export type SkillMatch = {
      skill: LoadedSkill;
      confidence: number;
      rationale: string;
    };

    export type SkillExecutionResult = {
      success: boolean;
      output: string | null;
      error?: string;
    };

In `src/domains/skills/runtime/index.ts`, expose:

    export function initFilesystemSkills(): Promise<void>;
    export function listFilesystemSkills(): LoadedSkill[];
    export function listFilesystemSkillErrors(): SkillLoadError[];
    export function findFilesystemSkill(name: string): LoadedSkill | null;
    export function executeFilesystemSkillByName(
      skillName: string,
      userMessage: string,
      context: AgentExecutionContext
    ): Promise<SkillExecutionResult>;

In `src/registry/skills.ts`, expose the explicit app-level registry contract:

    export type SkillsRegistry = {
      list(): LoadedSkill[];
      listErrors(): SkillLoadError[];
      findByName(name: string): LoadedSkill | null;
      executeByName(
        skillName: string,
        userMessage: string,
        context: AgentExecutionContext
      ): Promise<SkillExecutionResult>;
    };

    export function getSkillsRegistry(): SkillsRegistry;

In `src/domains/skills/service/matcher.ts`, expose the skill matcher used exclusively by background triggers (scheduler and email watcher) for direct skill invocation. Conversational requests (SMS/WhatsApp) do not use this matcher; they rely on the orchestrator planner to select skills via the compact skill catalog in planner context.

    export async function matchSkillForMessage(
      message: string,
      channel: SkillChannel
    ): Promise<SkillMatch | null>;

In `src/domains/skills/service/executor.ts`, expose:

    export async function executeFilesystemSkill(
      skill: LoadedSkill,
      userMessage: string,
      context: AgentExecutionContext
    ): Promise<SkillExecutionResult>;

In `src/orchestrator/types.ts`, extend the existing `PlanStep` interface to support skill dispatch. The current interface has an `agent` field. This change adds a `targetType` discriminator while preserving backward compatibility and all existing fields:

    export type PlanStepTargetType = 'agent' | 'skill';

    export interface PlanStep {
      id: string;
      targetType: PlanStepTargetType;  // NEW — discriminates dispatch path
      agent: string;                   // EXISTING — repurposed as target identifier (agent id or skill name)
      task: string;
      status: StepStatus;
      result?: StepResult;             // EXISTING — must be preserved, populated on completion/failure
      retryCount: number;
      maxRetries: number;
    }

The `agent` field name is retained rather than renamed to `target` to minimize downstream changes in the planner, executor, replanner, and response-composer. The `targetType` field defaults to `'agent'` for all existing codepaths, so current plan generation continues to work without changes until skill routing is added. Downstream files that must handle the new discriminator are `src/orchestrator/planner.ts` (plan generation), `src/orchestrator/executor.ts` (step dispatch), `src/orchestrator/replanner.ts` (replan logic), and `src/executor/router.ts` (agent lookup).

Dependencies and constraints:

- Reuse existing Anthropic client from `src/services/anthropic/client.ts`.
- Reuse existing tool execution loop via injected `executeWithTools`.
- Keep cross-domain imports compliant with `config/architecture-boundaries.json`; add provider bridges if `skills` must call into other domains.
- Use `gray-matter` (npm package) for YAML frontmatter parsing. This is a widely-used, focused library that handles the `---` delimiter extraction and YAML parsing in one step. Writing a custom YAML parser would be error-prone (YAML has subtle edge cases around multiline strings, type coercion, and anchors). `gray-matter` is a single-purpose dependency with no transitive bloat, and it returns both the parsed frontmatter object and the body content separately, which aligns with the on-demand body loading design. Add `@types/gray-matter` if available, otherwise add inline type declarations.

Example scheduler-provider access pattern (required shape). This follows the same cross-domain bridge pattern as `scheduler/providers/memory.ts`, which re-exports from the memory domain's runtime entrypoint. The scheduler domain must never import `src/registry/` directly — that is forbidden by `domainExternalRules` in `config/architecture-boundaries.json`. Instead, the provider re-exports from the skills domain, and a `crossDomainRules` entry must be added to allow `scheduler` → `skills` via `providers/skills.ts`.

`src/domains/scheduler/providers/skills.ts`

    import {
      findFilesystemSkill,
      executeFilesystemSkillByName,
    } from '../../skills/runtime/index.js';
    import type { SkillExecutionResult, LoadedSkill } from '../../skills/types.js';

    export { findFilesystemSkill, executeFilesystemSkillByName };
    export type { SkillExecutionResult, LoadedSkill };

Required `config/architecture-boundaries.json` entry under `crossDomainRules.allowed`:

    {
      "from": "src/domains/scheduler/",
      "to": "src/domains/skills/",
      "via": "providers/skills.ts",
      "reason": "Scheduler executor needs skill lookup and execution for scheduled skill jobs"
    }

`src/domains/scheduler/service/executor.ts` (usage through provider)

    import { findFilesystemSkill, executeFilesystemSkillByName } from '../providers/skills.js';

    if (job.skillName) {
      const skill = findFilesystemSkill(job.skillName);
      if (!skill) {
        logger.warn(`Scheduled skill "${job.skillName}" not found in registry`);
        return { success: false, error: `Skill not found: ${job.skillName}` };
      }
      const skillResult = await executeFilesystemSkillByName(
        job.skillName,
        job.prompt,
        agentContext
      );
      return mapSkillResultToScheduledExecution(skillResult);
    }

## Revision Note

2026-02-22 / Codex: Initial plan created from current codebase audit and Anthropic-style skill format requirements. This revision establishes additive milestones and explicitly separates filesystem skills from legacy email automation skills.
2026-02-22 / Codex: Revised after user feedback to require full retirement of legacy email-skill architecture, including migration tooling, explicit cutover, and final codepath deletion. Without this, two parallel skill systems would accumulate maintenance burden indefinitely.
2026-02-22 / Codex: Revised after user feedback to make conversational skill usage orchestrator-native (planner selects skill vs agent), while preserving direct skill invocation only for background triggers. This avoids a parallel routing mechanism that would duplicate planning logic.
2026-02-22 / Codex: Revised after user feedback to remove interim-compatibility constraints; temporary migration breakage is acceptable as long as final migrated state is correct. This simplifies implementation by eliminating dual-path scaffolding.
2026-02-22 / Codex: Added explicit Layer Compliance Strategy (storage locations, forward-layer constraints, cross-domain integration rules, and strict architecture verification commands). Without this, implementers would have to reverse-engineer layer constraints from `config/architecture-boundaries.json` without clear guidance on where skill content vs code belongs.
2026-02-22 / Codex: Added explicit single-conversational-loop clarification and OpenClaw-style harness mechanics (compact catalog + on-demand skill-body read). This was needed because the prior revision did not specify how skill bodies interact with planner token budgets.
2026-02-22 / Codex: Added explicit skills-vs-agents distinction (workflow artifacts vs domain reasoning runtimes), planner selection guidance, and anti-duplication guardrails. Without this, the boundary between skills and agents was ambiguous enough to produce duplicate abstractions.
2026-02-22 / Codex: Simplified to single-user storage semantics by removing per-user migrated skill partitioning and phone-scoped skill interfaces. Hermes is single-user; per-user scoping would add complexity with no current benefit.
2026-02-22 / Codex: Made skill registry explicit as a first-class runtime contract and documented concrete scheduler provider bridge wiring through `src/domains/skills/runtime`.
2026-02-21 / Claude: Fixed architecture violation in scheduler provider example (was importing from `src/registry/`, which is forbidden for domains — changed to cross-domain bridge pattern). Fixed PlanStep type to preserve existing fields (`result`, `status` type alias) and retain `agent` field name to minimize downstream changes. Made `LoadedSkill.body` lazy to match on-demand loading decision. Added `whatsapp` to `SkillChannel`. Scoped `matchSkillForMessage` to background triggers only. Added `SKILLS_ENABLED` feature flag and deployment safety strategy. Committed to `gray-matter` for YAML parsing. Defined `scripts/` resource behavior (read-only prompt context, never executed). Set domain exposure to `internal`. Fixed admin endpoint to `/admin/api/skills`. Rewrote Requirements as prose per PLANS.md. Fixed non-chronological progress timestamps.
