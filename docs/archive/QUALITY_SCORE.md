# Quality Score

Per-domain quality grades for the Hermes Assistant codebase. Every domain should be above 90. Grades are updated when domains change significantly.

Last graded: 2026-02-21

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

Adheres to [core-beliefs.md](design-docs/core-beliefs.md). The code is simple and focused — no speculative features, no premature abstractions, no clever indirection. Dependencies are boring and well-understood. Changes are additive and incremental. The domain doesn't contain code that exists "just in case."

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
| Orchestrator | 55 | 65 | 80 | 45 | 60 | 75 | 65 | 60 | 63 |
| Calendar agent | 60 | 75 | 85 | 70 | 70 | 85 | 80 | 90 | 77 |
| Scheduler agent | 55 | 70 | 80 | 65 | 65 | 80 | 75 | 90 | 73 |
| Email agent | 55 | 75 | 85 | 65 | 70 | 80 | 80 | 90 | 75 |
| Memory agent | 65 | 75 | 85 | 70 | 70 | 85 | 85 | 90 | 78 |
| Drive agent | 65 | 75 | 80 | 65 | 70 | 80 | 80 | 90 | 76 |
| UI agent | 75 | 80 | 85 | 75 | 75 | 85 | 85 | 90 | 81 |
| General agent | 35 | 65 | 60 | 55 | 65 | 75 | 70 | 50 | 59 |
| Memory system | 80 | 85 | 90 | 80 | 80 | 90 | 90 | 90 | 86 |
| Scheduler system | 65 | 75 | 80 | 70 | 75 | 85 | 80 | 90 | 78 |
| Date resolver | 70 | 65 | 80 | 60 | 55 | 75 | 80 | 80 | 71 |
| Email watcher | 80 | 80 | 85 | 80 | 80 | 85 | 85 | 90 | 83 |
| SMS routing | 60 | 75 | 70 | 75 | 75 | 80 | 80 | 60 | 72 |
| Tools layer | 70 | 70 | 65 | 70 | 70 | 80 | 80 | 85 | 74 |
| Database layer | 75 | 80 | 75 | 80 | 75 | 85 | 85 | 75 | 79 |
| Google integrations | 60 | 75 | 80 | 70 | 70 | 80 | 80 | 90 | 76 |

