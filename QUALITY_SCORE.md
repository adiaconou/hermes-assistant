# Quality Score

Per-domain quality grades for the Hermes Assistant codebase. Every domain should be above 90. Grades are updated when domains change significantly.

Last graded: 2026-02-28

---

## Grading Dimensions

Each domain is scored 0-100 across eight dimensions. The rubric below defines what 90+ looks like and what drags a score down.

**Score meaning:**
- **90-100** — Complete, follows all conventions, no known gaps
- **75-89** — Functional, minor gaps identified
- **50-74** — Works but has known weaknesses that should be addressed
- **Below 50** — Significant gaps, risk of breakage

### Tests

**Unit tests** cover major happy paths and major error/exception cases. They don't need to test every branch — focus on the paths that matter most if they break. **Integration tests** cover the same major happy paths but exercise the real call chain: route handler through service layer, orchestrator through agent execution, background poller through job execution. The difference is unit tests isolate a single function with mocked dependencies, integration tests verify components work together. All external services (Twilio, Anthropic, Google, Gemini) must be mocked in both.

_90+: Happy paths and key error cases covered at both levels. Tests fail when behavior changes._
_Drags score down: No tests, tests that only check trivial cases, unmocked external calls, tests that pass regardless of behavior, tests that assert incorrect behavior (encoding bugs as expected)._

### Error handling

Handle errors that have real user impact. If a Google API call fails mid-orchestration, the user should get a useful message, not a silent failure or a stack trace. If a scheduled job throws, it should log and continue, not crash the poller. Don't over-engineer — catching every possible exception type or adding retry logic to things that rarely fail is unnecessary complexity. Use YAGNI: handle the failures you've seen or can reasonably expect, not hypothetical ones.

_90+: User-facing failures produce helpful messages. Background processes don't crash on errors. No silent swallowing of errors that matter._
_Drags score down: Bare try/catch that swallows errors, unhandled promise rejections, user sees raw error messages or gets no response, over-engineered error hierarchies for simple cases._

### Doc accuracy

A design doc exists in `docs/design-docs/`, is listed in the index, and describes how the subsystem actually works today. The doc doesn't need to be exhaustive — it needs to be correct. If the code has diverged from the doc, the doc is wrong and the score drops.

_90+: Doc exists, is indexed, and a reader following it would correctly understand the subsystem._
_Drags score down: No doc, doc describes behavior that no longer exists, doc omits major subsystem capabilities._

### Boundary validation

Validate data at system boundaries — where external input enters your domain. This means: incoming SMS payloads, API responses from Google/Twilio/Anthropic, user-provided tool arguments, and database reads that might return unexpected shapes. Internal function calls between trusted modules don't need validation. Trust your own types.

_90+: External inputs are validated or safely parsed before use. Malformed data doesn't propagate._
_Drags score down: Raw external data used without checks, type assertions on API responses, no validation on user-provided values in tool arguments._

### Observability

Log enough to diagnose a problem after the fact without having to reproduce it. Every request should be traceable: you should be able to follow an inbound SMS through classification, planning, agent execution, and response composition in the logs. Errors should include context (what was being attempted, relevant IDs). Don't log sensitive data (tokens, full phone numbers, API keys). Don't over-log — routine success paths need minimal logging.

_90+: Errors logged with context. Request flow is traceable. No sensitive data in logs._
_Drags score down: Silent failures, errors logged without context, no way to trace a request, sensitive data in log output, excessive debug logging left in production paths._

### Architecture

Follows the established patterns: two-phase SMS processing (sync classifier + async orchestrator), agent isolation (each agent sees only its own tools), tool registration through the central registry, background loops running independently of the request path. New code should fit into existing patterns, not invent new ones.

_90+: Follows all established patterns. A new contributor reading ARCHITECTURE.md would correctly predict how this domain works._
_Drags score down: Bypasses agent isolation, tools not registered centrally, background work mixed into request path, patterns that contradict ARCHITECTURE.md._

### Core beliefs

Adheres to [core-beliefs.md](docs/archive/design-docs/core-beliefs.md). The code is simple and focused — no speculative features, no premature abstractions, no clever indirection. Dependencies are boring and well-understood. Changes are additive and incremental. The domain doesn't contain code that exists "just in case."

_90+: Code does what it needs to and nothing more. Dependencies are stable and well-known. No dead code or unused abstractions._
_Drags score down: Over-abstracted, speculative features, exotic dependencies, code that exists for hypothetical future requirements._

### Structural compliance

Files respect the forward-layer rule (`types → config → repo → service → runtime → ui`), cross-domain imports go through declared `providers/` re-exports only, and no domain imports from forbidden top-level paths (`src/routes/`, `src/orchestrator/`, `src/executor/`, `src/registry/`). This dimension is mechanically verified — the score is the pass rate of `npm run lint:architecture --strict`.

_90+: Zero boundary violations. All cross-domain imports go through provider re-exports. Layer ordering is clean. No imports from forbidden paths._
_Drags score down: Direct imports from sibling domain internals, upward layer imports (repo importing runtime), imports from forbidden top-level paths, bypassing provider re-export pattern for cross-domain dependencies, `AuthRequiredError` or similar shared types defined in the wrong module._

---

## Domain Grades

| Domain | Tests | Errors | Docs | Boundaries | Observability | Architecture | Core Beliefs | Structure | Overall |
|--------|-------|--------|------|------------|---------------|-------------|-------------|-----------|---------|
| Orchestrator | 90 | 90 | 90 | 90 | 92 | 90 | 90 | 90 | 90 |
| Calendar agent | 90 | 90 | 90 | 90 | 91 | 90 | 90 | 90 | 90 |
| Scheduler agent | 55 | 70 | 80 | 90 | 91 | 80 | 75 | 90 | 79 |
| Email agent | 55 | 75 | 85 | 90 | 91 | 80 | 80 | 90 | 81 |
| Memory agent | 65 | 75 | 85 | 90 | 91 | 85 | 85 | 90 | 83 |
| Drive agent | 65 | 75 | 80 | 90 | 91 | 80 | 80 | 90 | 81 |
| UI agent | 75 | 80 | 85 | 90 | 91 | 85 | 85 | 90 | 85 |
| Memory system | 80 | 85 | 90 | 90 | 92 | 90 | 90 | 90 | 88 |
| Scheduler system | 65 | 75 | 80 | 90 | 92 | 85 | 80 | 90 | 82 |
| Date resolver | 70 | 65 | 80 | 90 | 91 | 75 | 80 | 80 | 79 |
| Email watcher | 80 | 80 | 85 | 90 | 92 | 85 | 85 | 90 | 86 |
| SMS routing | 60 | 75 | 70 | 90 | 92 | 80 | 80 | 60 | 76 |
| Tools layer | 70 | 70 | 65 | 90 | 91 | 80 | 80 | 85 | 79 |
| Database layer | 75 | 80 | 75 | 90 | 91 | 85 | 85 | 75 | 82 |
| Google integrations | 60 | 75 | 80 | 90 | 91 | 80 | 80 | 90 | 81 |

### 2026-02-28 Observability Re-grade Notes

- Shared structured logging + request/run context propagation implemented in `src/utils/observability/*`, `src/routes/sms.ts`, and `src/orchestrator/handler.ts`.
- Legacy `console.*` output is now adapted centrally into structured, redacted records (with context attachment) across environments, so existing domain/provider logs participate in the same observability contract.
- Background systems now emit cycle-level run context via `runId` in scheduler, memory processor, and email watcher runtimes.
- Date resolver now emits structured parse success/failure events with timezone/strategy metadata.
- Verified with:
  - `tests/unit/observability/redaction.test.ts`
  - `tests/unit/observability/logger.test.ts`
  - `tests/unit/observability/trace-logger.test.ts`
  - `tests/integration/webhook.test.ts` (including requestId continuity assertion)
  - `tests/unit/date/resolver.test.ts`
  - `tests/unit/memory-processor.test.ts`
  - `tests/unit/services/email-watcher/*.test.ts`

### 2026-02-28 Boundary Validation Re-grade Notes

- Removed General agent row (fully retired in commit `02d6b54`, no code exists).
- Shared `validateInput` utility added to `src/tools/utils.ts` for standardized LLM tool input validation.
- Mechanical boundary lint added (`npm run lint:boundaries`) — 0 violations.
- All tool handlers across Scheduler, Email, Drive, Memory, and UI agents now call `validateInput` before `as` casts.
- Twilio webhook (`src/routes/sms.ts`) validates `From` field and rejects malformed payloads with HTTP 400.
- Anthropic JSON responses (`src/services/anthropic/classification.ts`, `src/orchestrator/planner.ts`) are shape-checked after `JSON.parse`.
- Google API responses (`gmail.ts`, `google-drive.ts`, `google-sheets.ts`, `google-docs.ts`, `drive-folders.ts`) replaced all non-null assertions with explicit field checks.
- Drive API query escaping added for user-provided folder names.
- Scheduler repo (`src/domains/scheduler/repo/sqlite.ts`) and memory repo (`src/domains/memory/repo/sqlite.ts`) fail fast on corrupt rows.
- Conversation store (`src/services/conversation/sqlite.ts`) safely parses media attachment JSON with shape validation.
- Date resolver boundary tests added: DST spring-forward 9am, fall-back 1:30am, leap year Feb 29, year boundary, weekday same-day.
- Maps tool aligned with standard `{ success: false, error }` pattern instead of throwing.
- Email watcher classifier text capped at 10,000 chars for long attachment lists.
- Verified with:
  - `tests/unit/tools/validation.test.ts` (23 tests)
  - `tests/unit/tools/scheduler.test.ts`, `tests/unit/tools/email.test.ts`, `tests/unit/tools/memory.test.ts`, `tests/unit/tools/drive-handler.test.ts`, `tests/unit/tools/ui.test.ts` (boundary sections)
  - `tests/unit/tools/maps.test.ts` (boundary tests)
  - `tests/unit/scheduler/sqlite.test.ts` (row corruption tests)
  - `tests/unit/memory-sqlite.test.ts` (confidence clamping, corrupt row tests)
  - `tests/unit/conversation-sqlite.test.ts` (media attachment parsing boundary tests)
  - `tests/unit/date/resolver.test.ts` (DST, leap year, year boundary, weekday same-day)
  - `tests/unit/services/email-watcher/classifier.test.ts` (text cap test)
  - `tests/integration/webhook.test.ts` (From field rejection)
  - `npm run lint:boundaries` — 0 violations
  - `npm run lint:architecture --strict` — 0 violations
