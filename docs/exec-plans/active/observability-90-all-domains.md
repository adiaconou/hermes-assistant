# Raise Observability Scores Above 90 Across All Domains

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` is checked into this repository and is the governing standard for this document. This file must be maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

Hermes currently has observability scores below 90 in most graded domains. The practical impact is that production failures are slower to diagnose because logs are not consistently correlated, not consistently redacted, and not emitted from every critical step in the request and background pipelines.

After this plan is complete, every domain in `QUALITY_SCORE.md` will have an observability score above 90 with evidence. A developer will be able to trace one inbound request (or one background poll cycle) from start to finish using a correlation identifier, understand failures from structured context, and verify no sensitive data is leaked in logs.

The user-visible proof is straightforward: send a message, then inspect logs and follow the same `requestId` across webhook receipt, classification, planning, step execution, and response sending; trigger one failure path and confirm the error log includes contextual fields; run log-redaction tests and confirm sensitive values are not present.

## Progress

- [x] (2026-02-28 00:00Z) Created this ExecPlan with milestones, owners, and file-by-file tasks.
- [x] (2026-02-28 00:35Z) Added explicit sink policy requirements: dev dual-sink (stdout + local NDJSON), prod stdout/stderr only, and development trace-file preservation.
- [x] (2026-02-28 01:25Z) Milestone 1 complete: shared observability contract implemented; development dual-sink logging and console mirroring enabled; request entry-point adoption in SMS/orchestrator done; trace logger requestId alignment added; baseline redaction/logger tests passing.
- [x] (2026-02-28 05:12Z) Post-M1 hardening complete: buffered file sink replaced sync appends, explicit requestId threading added across webhook -> async worker -> orchestrator -> trace logger boundaries, high-risk payload field allowlist enforced for `sms-routing`/`orchestrator-handler`, and requestId continuity integration assertion added.
- [ ] Milestone 2 complete: orchestrator and executor flows emit correlated structured logs for success and failure paths.
- [ ] Milestone 3 complete: scheduler, memory processor, and email watcher emit correlated run-level logs with per-cycle summaries.
- [ ] Milestone 4 complete: domain agents, tools, date resolver, database layer, and Google integrations migrated to contract-compliant logging.
- [ ] Milestone 5 complete: enforcement, tests, docs, and quality re-grading done; all observability scores updated to >90 with evidence.

## Surprises & Discoveries

- Observation: the current trace logger is development-only, so request-level traces are not available in production by default.
  Evidence: `src/utils/trace-logger.ts` enables logging only when `config.nodeEnv === 'development'`.

- Observation: logging is fragmented across three patterns (raw `console.*`, trace logger files, and ad-hoc debug logs), which matches open debt item T-16.
  Evidence: widespread `console.*` usage across request paths and background services; `tech-debt-tracker.md` marks T-16 as open.

- Observation: some logs still include sensitive payload data (for example raw message text in request logs), conflicting with current logging policy.
  Evidence: `src/orchestrator/handler.ts` logs `Message: userMessage`; `SECURITY.md` says full phone numbers and email content must never be logged.

- Observation: e2e workflows call `handleSmsWebhook` directly rather than starting the full server, so observability initialization must occur in the route/module path, not only in `src/index.ts`.
  Evidence: `tests/e2e/harness.ts` imports `handleSmsWebhook` and invokes it directly.

- Observation: `npm run test:unit -- <file>` still executes the entire `tests/unit/` suite because the npm script already hardcodes that directory, then appends provided args.
  Evidence: running targeted unit command executed all unit files; switched to direct `npx vitest run <file...>` for true targeted validation.

- Observation: continuity assertions should not key on human-readable `message` fields because redaction policy intentionally treats `message` content as sensitive text.
  Evidence: webhook `route_log` entries redact `message` as `[REDACTED_TEXT ...]`; integration test now keys on structural fields (`event`, `domain`, `operation`, `numMedia`) instead.

## Decision Log

- Decision: build on the existing codebase using a small in-repo logging utility, not a new external logging framework.
  Rationale: this follows core-beliefs simplicity and avoids introducing unnecessary dependencies during a cross-cutting migration.
  Date/Author: 2026-02-28 / Codex

- Decision: use role-based owners in this ExecPlan (`Platform`, `Messaging`, `Background`, and so on) rather than personal names.
  Rationale: assignee names are not encoded in the repository; role owners keep execution unblocked and can be mapped to people when scheduled.
  Date/Author: 2026-02-28 / Codex

- Decision: measure completion with explicit evidence (tests, lint guardrails, and trace walkthroughs), then update `QUALITY_SCORE.md` in the same change.
  Rationale: observability grading is behavior-based; we need proof attached to scoring updates.
  Date/Author: 2026-02-28 / Codex

- Decision: enforce one logging API with environment-driven sinks instead of branching code paths.
  Rationale: developers and agents should use the same instrumentation in all environments. In development, logs must be dual-sink (stdout and local file) for troubleshooting; in production, logs must go to stdout/stderr only. Existing trace files remain enabled in development for deep per-request debugging.
  Date/Author: 2026-02-28 / Codex

- Decision: enforce a stricter allowlist for payload fields on high-risk request domains while preserving correlation fields in context.
  Rationale: this reduces accidental leakage in the highest-risk paths (`sms-routing`, `orchestrator-handler`) without breaking traceability (`requestId`, domain, operation, ids).
  Date/Author: 2026-02-28 / Codex

## Outcomes & Retrospective

Milestone 1 outcome: completed.

What was achieved:

- Added a shared observability module under `src/utils/observability/` with context propagation, redaction helpers, and a structured logger API.
- Implemented development dual-sink behavior (stdout + local NDJSON file) and production stdout/stderr behavior in the same API.
- Added development console mirroring to local NDJSON so legacy `console.*` logs remain reviewable without branching logging paths.
- Wired `requestId` propagation into SMS webhook handling and orchestrator handler logs.
- Updated trace logger to reuse context `requestId` when available and mask phone numbers.
- Added baseline unit tests for redaction and logger sink behavior.
- Added buffered NDJSON file writes via stream sink with shutdown hooks to avoid synchronous append overhead.
- Added explicit `requestId` pass-through and tests for webhook-to-orchestrator continuity.
- Added high-risk payload field allowlist for request-path domains.

What remains:

- Milestones 2-5: correlated orchestration internals, background system standardization, broad domain/provider migration, and quality-score re-grading to >90 in every domain.

## Context and Orientation

The observability rubric in `QUALITY_SCORE.md` defines 90+ as three concrete properties: errors are logged with context, request flow is traceable, and logs do not contain sensitive data. The current grade table shows most domains below 90 in observability.

Hermes has two major execution surfaces that require observability parity. The first is request-time handling, which starts in `src/routes/sms.ts` and continues through classifier/orchestrator/executor/tool execution. The second is background processing, which is driven by polling loops in scheduler, memory processing, and email watcher runtime files under `src/domains/*/runtime`.

A correlation identifier is a stable ID attached to every log event emitted during one logical operation. For inbound messages we will use `requestId`; for poller cycles we will use `runId`; for nested operations we will include secondary IDs such as `stepId`, `jobId`, and `toolName`.

In this repository, sensitive data includes full phone numbers, OAuth credentials, API keys, and full user-generated message/email body content. Redaction means replacing sensitive values with safe forms (for example last-4 phone digits) before writing logs.

Owner roles used in this plan:

- `Platform Observability Owner`: shared logging contract, redaction, enforcement.
- `Messaging and Orchestrator Owner`: webhook, classifier, orchestrator, executor request-path instrumentation.
- `Background Systems Owner`: scheduler/memory/email-watcher poll loops and summaries.
- `Domain Runtime Owner`: domain tools/agents and date resolver observability consistency.
- `Data and Integrations Owner`: database layer and Google provider instrumentation.
- `Quality and Docs Owner`: tests, quality score update, architecture/security documentation.

If one engineer executes the full plan, that engineer can act in all roles.

## Layer Compliance Strategy

All new shared logging code will live in `src/utils/observability/` so every layer can import it without violating forward-only rules. This directory is runtime code, not generated content.

Request handlers and orchestrator code will import from `src/utils/observability` directly. Domain runtime, service, repo, and provider files will also import from `src/utils/observability` and must not create upward dependencies on `src/routes`, `src/orchestrator`, `src/executor`, or `src/registry`.

No cross-domain imports are needed for this work because logging is cross-cutting and centralized in `src/utils`. Redaction rules and context propagation are shared helpers; domain modules remain domain-local.

Compliance will be verified mechanically with:

    cd /home/adiaconou/Code/hermes-assistant
    npm run lint:architecture --strict

Lint and test verification will run at every milestone, with strict architecture lint required before final merge.

## Plan of Work

### Milestone 1: Shared Logging Contract and Redaction Baseline

At the end of this milestone, Hermes has one shared logger contract with required fields, centralized redaction, and request/run context helpers. Request entry points start using it.

Non-negotiable sink behavior implemented in this milestone:

- Development (`NODE_ENV=development`): every structured app log event is written to stdout and to a local NDJSON file under the logs directory.
- Production (`NODE_ENV=production`): structured app logs are written to stdout/stderr only (no local file sink by default).
- Trace logger request files remain active in development for per-request deep traces and e2e harness compatibility.

`Platform Observability Owner` will add the shared package in these files:

- `src/utils/observability/types.ts`: define the core logging types (`LogLevel`, `LogContext`, `AppLogRecord`, `AppLogger`).
- `src/utils/observability/redaction.ts`: define helpers for phone masking, token redaction, and bounded text snippets for logs.
- `src/utils/observability/logger.ts`: define logger factory and methods (`debug`, `info`, `warn`, `error`) that emit structured JSON.
- `src/utils/observability/context.ts`: define helper APIs to attach and pass `requestId` and `runId`.
- `src/utils/observability/index.ts`: re-export stable API for consumers.

`Messaging and Orchestrator Owner` will adopt the contract in request entry points:

- `src/routes/sms.ts`: create a `requestId` at webhook entry, include it in all logs, replace direct raw logs with shared logger calls, and ensure sender/message fields use redaction helpers.
- `src/orchestrator/handler.ts`: consume `requestId` from caller context, remove raw message body logging, and emit stage logs that include `requestId`, channel, and safe identifiers.

`Quality and Docs Owner` will add baseline tests:

- `tests/unit/observability/redaction.test.ts`: verify masking and secret filtering.
- `tests/unit/observability/logger.test.ts`: verify required fields are present, stdout emission occurs, and sink behavior is environment-correct.

### Milestone 2: Correlated Request Traces Across Classifier, Planner, Executor, and Composer

At the end of this milestone, one inbound message can be traced end-to-end in production logs with one `requestId`, and failure logs include operation context.

`Messaging and Orchestrator Owner` will instrument these files:

- `src/services/anthropic/classification.ts`: log classifier start/complete/failure with latency and `requestId`.
- `src/orchestrator/orchestrate.ts`: log plan lifecycle (`plan_created`, `step_started`, `step_completed`, `step_failed`, `replan_started`, `replan_completed`, `plan_completed`) with `requestId` and `stepId`.
- `src/orchestrator/planner.ts`: include planning request metadata, parse failures, and fallback reason logs.
- `src/orchestrator/replanner.ts`: include replan attempt number, failure reason, and result shape metadata.
- `src/orchestrator/executor.ts`: log dispatch start/finish with target agent/skill, timeout data, and result status.
- `src/orchestrator/response-composer.ts`: log composition start/finish, tool-loop iterations, and error context.
- `src/executor/tool-executor.ts`: log tool call start/result/failure with `toolName`, `durationMs`, and bounded output metadata.
- `src/executor/router.ts`: log unknown target errors with context rather than silent fallbacks.

`Platform Observability Owner` will align trace logger behavior:

- `src/utils/trace-logger.ts`: preserve e2e compatibility but ensure request IDs come from shared context when available and sensitive fields are redacted consistently.

### Milestone 3: Background Poller Observability Standardization

At the end of this milestone, each poll cycle has a `runId`, per-cycle summary log, and contextual failure logs that identify the impacted user/job safely.

`Background Systems Owner` will instrument scheduler:

- `src/domains/scheduler/runtime/index.ts`: emit cycle start/end and no-work summary logs with `runId`.
- `src/domains/scheduler/service/executor.ts`: include job execution logs with `jobId`, schedule metadata, duration, and error context.
- `src/domains/scheduler/runtime/tools.ts`: ensure tool-level failures and retries are logged with consistent schema.

`Background Systems Owner` will instrument memory processor:

- `src/domains/memory/service/processor.ts`: replace ad-hoc debug/system logs with shared logger events keyed by `runId`, include per-user/batch counters, and preserve optional verbose mode behind config.
- `src/domains/memory/runtime/index.ts`: log service start/stop and cycle outcomes.

`Background Systems Owner` will instrument email watcher:

- `src/domains/email-watcher/runtime/index.ts`: apply `runId` and per-user cycle logs with masked phone identifiers.
- `src/domains/email-watcher/providers/gmail-sync.ts`: log sync boundaries and Gmail API failure context without message body content.
- `src/domains/email-watcher/service/actions.ts`: log action execution outcomes with skill/action identifiers and safe metadata.

`Platform Observability Owner` will update poller helper:

- `src/utils/poller.ts`: expose optional hook points for standardized cycle logging and error propagation context.

### Milestone 4: Domain Runtime, Tools, Date Resolver, Database, and Google Integration Coverage

At the end of this milestone, the remaining low-scoring domains have contextual error logs and traceable operation logs, all using the same schema and redaction policy.

`Domain Runtime Owner` will migrate agent/tool runtime logging:

- `src/domains/email/runtime/tools.ts`
- `src/domains/drive/runtime/tools.ts`
- `src/domains/ui/runtime/tools.ts`
- `src/domains/memory/runtime/tools.ts`
- `src/domains/scheduler/runtime/tools.ts`
- `src/tools/index.ts`
- `src/tools/date.ts`
- `src/tools/maps.ts`
- `src/tools/user-config.ts`

For each file, replace direct console logging with shared logger calls and include `requestId` (or `runId`) and domain operation fields.

`Domain Runtime Owner` will improve date resolver observability:

- `src/services/date/resolver.ts`: emit parse attempt/result/error logs with parser strategy and normalized timezone context, without logging full user text.

`Data and Integrations Owner` will migrate database-layer logs:

- `src/services/conversation/sqlite.ts`
- `src/services/user-config/sqlite.ts`
- `src/services/credentials/sqlite.ts`
- `src/domains/memory/repo/sqlite.ts`
- `src/domains/scheduler/repo/sqlite.ts`

For each file, log database operation name, timing, and high-level record identifiers; never log raw secret payloads.

`Data and Integrations Owner` will migrate Google integration logs:

- `src/domains/google-core/providers/auth.ts`
- `src/domains/google-core/service/drive-folders.ts`
- `src/domains/calendar/providers/google-calendar.ts`
- `src/domains/drive/providers/google-drive.ts`
- `src/domains/drive/providers/google-sheets.ts`
- `src/domains/drive/providers/google-docs.ts`
- `src/domains/drive/providers/gemini-vision.ts`
- `src/domains/email/providers/gmail.ts`
- `src/domains/email-watcher/providers/google-core.ts`

For each file, include API operation name, latency, retry/failure details, and safe user identifiers.

### Milestone 5: Guardrails, Re-Grading, and Documentation

At the end of this milestone, guardrails prevent regression, observability scores are updated to above 90 with evidence, and docs match implementation.

`Platform Observability Owner` will add enforcement:

- `eslint.config.js`: add a rule that blocks raw `console.*` in production source files except in approved shim files.
- `scripts/` (new file such as `scripts/check-observability-logs.mjs`): optional static guard that scans for known sensitive-field keys in logging calls.

`Quality and Docs Owner` will add integration evidence tests:

- `tests/integration/routes/sms.integration.test.ts`: verify request logs contain `requestId` across major stages.
- `tests/integration/orchestrator/orchestrate.integration.test.ts`: verify step/plan logs include correlated IDs and contextual fields.
- `tests/unit/services/date/resolver.test.ts`: add expectations around logging on invalid date/time inputs.
- `tests/unit/domains/*` targeted updates for logging behavior in tools and background flows.

`Quality and Docs Owner` will update documentation and grades:

- `QUALITY_SCORE.md`: update observability scores to >90 per domain with a short evidence note in commit/PR description.
- `SECURITY.md`: refresh logging policy language to match redaction helpers and required fields.
- `ARCHITECTURE.md`: add a short observability subsection describing request and poll-cycle correlation IDs.
- `RELIABILITY.md`: document how log events expose retry and fallback behavior.

## Concrete Steps

Work from WSL in `/home/adiaconou/Code/hermes-assistant`.

1. Implement Milestone 1, then run:

    npm run test:unit -- tests/unit/utils/observability/redaction.test.ts tests/unit/utils/observability/logger.test.ts
    npm run lint
    npm run lint:architecture --strict

2. Implement Milestone 2, then run:

    npm run test:unit -- tests/unit/orchestrator
    npm run test:integration -- tests/integration/orchestrator/orchestrate.integration.test.ts
    npm run lint

3. Implement Milestone 3, then run:

    npm run test:unit -- tests/unit/memory-processor.test.ts
    npm run test:integration -- tests/integration
    npm run lint:architecture --strict

4. Implement Milestone 4, then run:

    npm run test:unit
    npm run test:integration
    npm run lint
    npm run build

5. Implement Milestone 5, then run full verification:

    npm run lint:architecture --strict
    npm run lint
    npm run test:unit
    npm run test:integration
    npm run build

If `ANTHROPIC_API_KEY` is present, run optional end-to-end evidence:

    npm run test:e2e

Expected result for final verification is all commands passing with no architecture violations and no redaction test failures.

## Validation and Acceptance

Acceptance is behavior-first and must be demonstrated with logs and tests, not only code inspection.

For request flows, send one SMS and one WhatsApp message through the existing test harness or integration tests, then verify logs contain the same `requestId` through webhook receipt, classification, plan creation, step execution, and response send events.

For sink behavior, verify:

- In development mode, structured logs appear in terminal output and in local NDJSON log files.
- In production mode, structured logs appear in stdout/stderr and local NDJSON file output is disabled.
- Development trace files in `TRACE_LOG_DIR` still exist and are readable by troubleshooting workflows.

For failure observability, force one controlled failure (for example a mocked provider throw) and verify the emitted error event includes operation, domain, `requestId` or `runId`, and a non-sensitive error message.

For redaction, run unit tests that assert full phone numbers, OAuth tokens, API keys, and full message/email bodies do not appear in output logs.

For background systems, run one cycle each for scheduler, memory processor, and email watcher and verify each cycle logs `run_started`, `run_completed` (or `run_failed`) and a compact per-cycle summary with safe counters.

For grading, re-evaluate every row in `QUALITY_SCORE.md` and set observability to values above 90 only when each domain has contextual error logs, traceability coverage, and redaction compliance.

Because this change modifies cross-cutting runtime behavior, updating `ARCHITECTURE.md` and `SECURITY.md` is an explicit deliverable in this plan.

## Idempotence and Recovery

All changes in this plan are additive and can be rolled out incrementally. During migration, existing logging can coexist temporarily with the shared logger. Each milestone must leave tests and lint green before moving to the next milestone.

If a migration step fails midway, recovery is to complete the file set in that milestone and rerun the milestone commands. Avoid partial merges where only half of a flow has correlation IDs.

No destructive database migrations are required. No production data transformation is required. The rollback strategy is straightforward: revert the milestone commit(s) and rerun verification commands.

## Artifacts and Notes

Target log event shape (example):

    {
      "timestamp":"2026-02-28T10:15:22.114Z",
      "level":"info",
      "event":"step_completed",
      "requestId":"req_8fd9b2c1",
      "domain":"orchestrator",
      "operation":"execute_step",
      "stepId":"2",
      "agent":"calendar-agent",
      "durationMs":842,
      "result":"success"
    }

Target error event shape (example):

    {
      "timestamp":"2026-02-28T10:15:24.001Z",
      "level":"error",
      "event":"provider_error",
      "requestId":"req_8fd9b2c1",
      "domain":"google-core",
      "operation":"calendar.events.insert",
      "user":"***1234",
      "error":"Google API 503: backendError",
      "retryAttempt":1
    }

All examples above intentionally avoid full message bodies, full phone numbers, tokens, and credentials.

## Interfaces and Dependencies

No new external npm dependency is required.

The shared logging API should expose stable interfaces similar to:

    createLogger(baseContext?: LogContext): AppLogger
    withRequestContext<T>(context: { requestId: string }, fn: () => Promise<T>): Promise<T>
    getRequestContext(): { requestId?: string; runId?: string }
    redactPhone(value: string): string
    redactSecrets(value: unknown): unknown

Each log method should support:

    logger.info(event: string, data?: Record<string, unknown>): void
    logger.warn(event: string, data?: Record<string, unknown>): void
    logger.error(event: string, data?: Record<string, unknown>): void

The logger must be synchronous-safe for failure paths (logging failures must not crash request processing) and should default to JSON lines on stdout.

## Revision Note

2026-02-28 / Codex: Initial ExecPlan created to raise observability scores above 90 across all graded domains. The plan includes role-based owners, file-by-file task scope, architecture compliance strategy, validation criteria, and documentation updates.
2026-02-28 / Codex: Updated plan with explicit sink policy and acceptance criteria for development dual-sink logging while preserving trace files; added in-progress implementation status for Milestone 1.
2026-02-28 / Codex: Updated progress/discoveries after implementing Milestone 1 foundations (shared observability module, dev dual-sink + console mirroring, request correlation plumbing, and baseline tests).
2026-02-28 / Codex: Marked Milestone 1 complete and added milestone-level retrospective details after passing lint, architecture lint, build, full unit suite, and integration suite.
2026-02-28 / Codex: Corrected Milestone 1 artifact paths and type-language to match actual implementation (`tests/unit/observability/*` and current shared type exports).
