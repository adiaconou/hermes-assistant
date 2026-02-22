# Retire the General Agent

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` is checked into this repository and is the governing standard for this document. This file must be maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

Today, Hermes has a "general agent" (`src/agents/general/index.ts`) that receives every tool in the system (~50 tools) and acts as a catch-all for requests the planner cannot route to a specialized agent. This is problematic: when an LLM sees 50 tools it must reason over all of them to pick the right one, which degrades tool-selection accuracy compared to a specialized agent that sees only 3-16 tools. The general agent also undermines the orchestrator's plan-execute-replan loop, which already handles cross-domain and ambiguous requests by decomposing them into multiple specialized-agent steps and replanning on failure.

After this change, the general agent will be gone. The planner will always route actionable requests to a specialized agent, never to a general catch-all. For ambiguous requests where the domain is unclear, the planner will pick the most likely specialized agent and let the replan loop recover if the first choice was wrong. Greetings and small talk are already handled by the classifier before the orchestrator is invoked — no new conversational handler is needed.

A user-visible way to verify the change: send a greeting like "Hey!" via SMS and observe that the classifier handles it immediately (as it already does today). Then send a cross-domain request like "find that document John sent" and observe the planner decomposing it into specialized-agent steps (e.g., email-agent then drive-agent) rather than routing to a general agent.

## Progress

- [x] (2026-02-22) Created this ExecPlan.
- [x] (2026-02-22) Milestone 1: Removed general-agent from registry, updated planner/replanner/router fallbacks to use memory-agent, deleted `src/agents/general/`.
- [x] (2026-02-22) Milestone 2: Relocated `src/agents/context.ts` to `src/services/agent-context.ts`, updated all domain agent imports, deleted `src/agents/` directory.
- [x] (2026-02-22) Milestone 3: Verified zero `general-agent` references in `src/`, updated ARCHITECTURE.md, AGENTS.md, architecture-boundaries.json, and generate-agent-catalog.mjs. All tests (688), lint, architecture lint (strict), and build pass.

## Surprises & Discoveries

- The plan specified `src/executor/context.ts` as the relocation target, but the architecture boundary checker forbids domain→executor imports. Relocated to `src/services/agent-context.ts` instead, which is in the domain-allowed import list and architecturally correct.

## Decision Log

- Decision: Do not add a conversational handler or new targetType for greetings/small talk.
  Rationale: The classifier (`src/services/anthropic/classification.ts`) already catches greetings and returns an immediate response before the orchestrator is invoked. For anything that reaches the orchestrator, the plan-execute-compose pipeline handles it with specialized agents. Adding a conversational handler would be unnecessary complexity.
  Date/Author: 2026-02-22 / Claude

- Decision: Relocate `context.ts` to `src/services/agent-context.ts` instead of `src/executor/context.ts`.
  Rationale: The forward-only architecture enforces that domains cannot import from `src/executor/`. The `domainExternalRules.forbidden` rule for `src/executor/` takes precedence over allowed paths. `src/services/` is already in the allowed import list for domains, and the file's dependency on `src/services/anthropic/prompts/context.js` makes the services layer a natural home.
  Date/Author: 2026-02-22 / Claude

## Outcomes & Retrospective

All milestones complete. The general agent has been fully retired:
- Agent registry: 6 specialized agents (calendar, scheduler, email, memory, ui, drive). No catch-all.
- Planner fallback: memory-agent (renamed from `createGeneralFallbackPlan` to `createFallbackPlan`).
- Replanner fallback: memory-agent.
- Router: returns error `{success: false}` for unknown agent names; no silent fallback.
- No agent uses `tools: ['*']`. Every agent has an explicit, bounded tool list.
- `src/agents/` directory fully deleted.
- Shared context utilities live at `src/services/agent-context.ts`.
- All 688 unit tests pass, lint clean, architecture lint (strict) 0 violations, build succeeds.

## Context and Orientation

Hermes is a personal assistant that processes inbound SMS and WhatsApp messages. A message flows through this pipeline:

1. **Classifier** (`src/services/anthropic/classification.ts`): A fast LLM call (<5s) determines whether the message needs async processing or can be answered immediately. For greetings, small talk, and simple conversational messages, the classifier returns `{needsAsyncWork: false, immediateResponse: "..."}` and the response is sent directly as TwiML — the orchestrator is never invoked. This means the orchestrator does not need to handle purely conversational messages.

2. **Planner** (`src/orchestrator/planner.ts`): An LLM call that analyzes the user's request and creates an ordered list of `PlanStep` objects. Each step names a target — either an agent (e.g., `calendar-agent`) or a skill (e.g., `receipt-summarizer`). The planner currently uses `general-agent` as a fallback for greetings, ambiguous requests, and multi-domain tasks.

3. **Executor** (`src/orchestrator/executor.ts`): Dispatches each step to the named agent or skill. For agents, it calls `routeToAgent()` in `src/executor/router.ts`, which looks up the agent's executor function from the agent registry. The executor wraps each call with a 2-minute timeout.

4. **Replanner** (`src/orchestrator/replanner.ts`): If a step fails, the orchestrator can create a revised plan (up to 3 replans). The replanner preserves completed steps and adjusts remaining steps. It currently falls back to `general-agent` when it cannot parse its own LLM output.

5. **Response Composer** (`src/orchestrator/response-composer.ts`): Takes all step results and synthesizes a user-friendly SMS response.

The **agent registry** lives at `src/registry/agents.ts`. It imports 6 specialized agents from `src/domains/*/runtime/agent.ts` and 1 general agent from `src/agents/general/index.ts`. Each agent entry is a `{capability, executor}` tuple. The capability declares the agent's name, description, tool list, and example use cases.

The **general agent** (`src/agents/general/index.ts`) has `tools: ['*']`, meaning it receives every tool in the system. Its prompt (`src/agents/general/prompt.ts`) describes all domains and gives generic guidelines. It is used when:
- The planner emits `"agent": "general-agent"` in a step (for greetings, ambiguity, multi-domain)
- The planner's JSON parsing fails (fallback in `createGeneralFallbackPlan`)
- The replanner's JSON parsing fails (fallback in `parseReplanResponse`)
- The router receives an unknown agent name (fallback in `routeToAgent`)

The **agent context utilities** (`src/agents/context.ts`) provide `buildAgentTimeContext`, `buildAgentUserContext`, and `applyAgentContext`. These are used by specialized agents to fill prompt template placeholders. They are not specific to the general agent and should be relocated to `src/executor/` where they are consumed.

The `src/agents/` directory currently contains only `general/` and `context.ts`. After this change, it will be empty and should be deleted.

## Layer Compliance Strategy

This change touches code at the orchestrator, executor, and agent-registry layers. No new cross-domain dependencies are introduced — in fact, dependencies are removed (the `src/agents/` directory is deleted).

Code changes are confined to:
- `src/orchestrator/planner.ts` — update planner prompt rules to remove general-agent references; update fallback plan
- `src/orchestrator/replanner.ts` — update fallback to use memory-agent (lightest specialized agent) instead of general-agent
- `src/executor/router.ts` — remove general-agent fallback; return an error for unknown agents
- `src/executor/context.ts` — relocated from `src/agents/context.ts` (already consumed here)
- `src/registry/agents.ts` — remove general-agent import and entry
- `src/agents/` — deleted entirely

No new files or domains are created. No new targetTypes are added.

Mechanical verification at each milestone:

    npm run lint:architecture --strict
    npm run test:unit
    npm run build

## Plan of Work

### Milestone 1: Remove General Agent and Update All Fallbacks

At the end of this milestone, the general agent is fully removed from the registry and all code paths. Every fallback that previously routed to `general-agent` has been updated to use a specialized agent instead.

Remove the general agent from the registry by deleting its import and entry in `src/registry/agents.ts`. The registry will contain exactly 6 agents: calendar, scheduler, email, memory, ui, drive.

Update the planner prompt in `src/orchestrator/planner.ts`:
- Rule 2 currently says "For greetings, small talk, gratitude, or ambiguous conversational requests, use 1 step with general-agent." Remove the general-agent reference. Since greetings are already handled by the classifier before the orchestrator runs, this rule should instruct the planner to pick the best-fit specialized agent for any request that reaches it. For ambiguous requests where the domain is unclear, the planner should pick the most likely specialized agent — the replan loop will recover if the first choice was wrong.
- Rule 3 currently says "For single-domain actionable requests, prefer the matching specialized agent instead of general-agent." Remove the "instead of general-agent" clause since general-agent no longer exists.
- Rule 10 currently says "use general-agent only if no specialized agent fits." Remove this fallback clause entirely.

Update `createGeneralFallbackPlan` in `src/orchestrator/planner.ts`: when planner JSON parsing fails, fall back to memory-agent instead of general-agent. Memory-agent is the lightest specialized agent (4 tools) and can at minimum check for relevant stored context. Rename the function to `createFallbackPlan` to reflect that it no longer references the general agent.

Update the replanner's `parseReplanResponse` fallback in `src/orchestrator/replanner.ts`: when replan JSON parsing fails, fall back to memory-agent instead of general-agent. The task should be to summarize what was accomplished so far.

Update the router's unknown-agent fallback in `src/executor/router.ts`: remove the `generalExecutor` variable and its fallback path. When an unknown agent name is encountered, return an error `StepResult` directly (`{success: false, output: null, error: "Unknown agent: <name>"}`). The orchestrator's replan loop will handle recovery.

Delete `src/agents/general/index.ts` and `src/agents/general/prompt.ts`.

### Milestone 2: Relocate Agent Context Utilities and Delete `src/agents/`

At the end of this milestone, `src/agents/context.ts` has been moved to `src/executor/context.ts`, all imports are updated, and the `src/agents/` directory is fully deleted.

Move `src/agents/context.ts` to `src/executor/context.ts`. The file contents remain unchanged — it exports `buildAgentTimeContext`, `buildAgentUserContext`, and `applyAgentContext`.

Update all imports that reference the old path. The domain agent executors in `src/domains/*/runtime/agent.ts` currently import from paths like `../../../agents/context.js`. These must be updated to point to `../../../executor/context.js`. Search for all files importing from `agents/context` and update each one.

Delete the now-empty `src/agents/` directory.

Update any existing tests that reference `general-agent` to reflect the new fallback behavior (memory-agent or error responses). Ensure all tests pass.

### Milestone 3: Verify and Clean Up

At the end of this milestone, all tests pass, the build succeeds, architecture checks pass, and the codebase contains no references to `general-agent` outside of documentation and git history.

Run a grep for `general-agent`, `general_agent`, `generalAgent`, `generalExecutor`, and `GENERAL_AGENT` across the entire `src/` directory to catch any remaining references. Update or remove each one.

Verify that the planner prompt no longer mentions `general-agent` in any rule, example, or output format section.

Run the full test suite, lint, architecture check, and build. Fix any failures.

Update `ARCHITECTURE.md` and any other documentation that references the general agent to reflect the new architecture. The agent count drops from 7 to 6 specialized agents. Note that greetings and small talk are handled by the classifier, and ambiguous actionable requests are routed to the best-fit specialized agent with the replan loop providing recovery.

## Concrete Steps

Work from `/mnt/c/Code/hermes-assistant` in WSL.

1. Implement Milestone 1 and run:

    npm run lint:architecture --strict
    npm run test:unit
    npm run build

2. Implement Milestone 2 and run:

    npm run test:unit
    npm run lint
    npm run build

3. Implement Milestone 3 and run:

    grep -r "general-agent\|general_agent\|generalAgent\|generalExecutor\|GENERAL_AGENT" src/
    npm run test:unit
    npm run lint:architecture --strict
    npm run lint
    npm run build

Expected output at each stage: all tests pass, zero lint errors, build succeeds. The final grep should return zero matches in `src/`.

## Validation and Acceptance

Acceptance is behavior-first:

1. After Milestone 1: The agent registry contains exactly 6 entries (calendar, scheduler, email, memory, ui, drive). The planner fallback creates a memory-agent step, not a general-agent step. The replanner fallback creates a memory-agent step. The router returns an error for unknown agent names instead of silently falling back. All existing tests pass (with updated assertions where they previously expected `general-agent` behavior).

2. After Milestone 2: The `src/agents/` directory no longer exists. All domain agents import context utilities from `src/executor/context.ts`. The build and all tests pass cleanly.

3. After Milestone 3: A project-wide search for `general-agent` in `src/` returns zero results. Documentation reflects the new architecture. The full test, lint, and build pipeline passes cleanly.

Required automated test coverage:
- Planner fallback test: confirm `createFallbackPlan` (renamed from `createGeneralFallbackPlan`) returns a step with `agent: 'memory-agent'`.
- Replanner fallback test: confirm the replan JSON parse failure path returns a memory-agent step.
- Router test: confirm that routing to an unknown agent name returns `{success: false, error: "Unknown agent: ..."}` without falling back to any executor.

## Idempotence and Recovery

All changes in Milestone 1 can be made atomically — the general agent is removed and all references are updated in one pass. If the milestone is interrupted, the build will fail with clear import errors indicating what still needs updating.

The `src/agents/context.ts` relocation in Milestone 2 requires updating imports in multiple domain agent files. If this step is interrupted, the build will fail with import errors that clearly indicate which files still need updating.

No database migrations are needed. No external services are affected. No deployment configuration changes are required.

## Artifacts and Notes

The general agent's current tool list is `['*']`, which resolves to every tool in `src/tools/index.ts` via the `resolveTools` function in `src/executor/tool-executor.ts`:

    function resolveTools(toolNames: string[]): Tool[] {
      if (toolNames.includes('*')) return TOOLS;  // All tools
      return TOOLS.filter(tool => toolNames.includes(tool.name));
    }

After this change, no agent will use `['*']`. Every agent will have an explicit, bounded tool list.

The planner prompt currently has this rule (rule 2):

    For greetings, small talk, gratitude, or ambiguous conversational requests,
    use 1 step with general-agent

This will be changed to instruct the planner to pick the best-fit specialized agent, with the understanding that greetings are already handled by the classifier before the orchestrator is invoked.

## Interfaces and Dependencies

No new types, interfaces, or files are introduced. The existing `PlanStepTargetType` remains `'agent' | 'skill'` — no changes needed.

In `src/executor/context.ts` (relocated from `src/agents/context.ts`), the existing exports are preserved unchanged:

    export function buildAgentTimeContext(userConfig: UserConfig | null): string;
    export function buildAgentUserContext(userConfig: UserConfig | null): string;
    export function applyAgentContext(promptTemplate: string, userConfig: UserConfig | null): string;

Dependencies: no new packages are needed. No existing packages are removed.

## Revision Note

2026-02-22 / Claude: Initial plan created. Removed conversational handler concept after user feedback — the classifier already handles greetings/small talk before the orchestrator is invoked, so no new handler or targetType is needed. The plan is now a pure removal of the general agent with fallback paths updated to use specialized agents.
