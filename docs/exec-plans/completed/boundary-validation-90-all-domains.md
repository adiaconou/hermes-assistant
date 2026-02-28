# Raise Boundary Validation Scores Above 90 Across All Domains

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` is checked into this repository at the root and is the governing standard for this document. This file must be maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

Hermes has boundary validation scores below 90 in 13 of 15 active domains (the retired General agent should be removed from the scoreboard). The practical impact is that malformed data from external sources — LLM tool arguments, Google API responses, Twilio webhook payloads, Anthropic JSON parsing, and SQLite row reads — can propagate through the system unchecked, surfacing as confusing crashes deep in the call chain instead of clear, diagnosable errors at the point where the bad data entered.

After this plan is complete, every domain in `QUALITY_SCORE.md` will have a boundary validation score of 90 or above with evidence. A developer will be able to verify that: tool handlers reject malformed LLM inputs with clear error messages instead of crashing; Google API responses are defensively checked instead of non-null-asserted; Twilio webhook payloads are validated before use; Anthropic LLM responses are shape-checked after JSON parsing; and database row conversions handle NULL values explicitly.

The user-visible proof: run `npm run test:unit` and see new boundary-focused test suites passing that exercise malformed inputs, wrong types, missing fields, and unexpected nulls across every domain. Run `npm run lint:architecture --strict` to verify no structural regressions. Inspect the updated `QUALITY_SCORE.md` with evidence links tying each domain's boundary score to specific test files and code changes.

## Progress

- [x] Create this ExecPlan.
- [x] Milestone 1: Shared validation utility and boundary test helpers.
- [x] Milestone 2: Tool handler boundaries for agent domains (Scheduler, Email, Drive, Memory, UI).
- [x] Milestone 3: External API boundaries (Twilio webhook, Anthropic JSON parsing, Google API responses).
- [x] Milestone 4: Data layer boundaries (DB row conversions, conversation store, config stores).
- [x] Milestone 5: Date resolver boundary hardening and remaining domain fixes.
- [x] Milestone 6: Housekeeping — quality score update, evidence links, General agent row removal.

## Surprises & Discoveries

- SQLite NOT NULL constraints prevent inserting NULL values for testing row-level boundary checks. Data-layer boundary tests use empty strings (which pass NOT NULL but are logically invalid) instead of NULLs to exercise the application-level validation. The database schema provides the first layer of defense; the application code provides defense-in-depth.
- The boundary lint script initially found 24 violations across the codebase. All were resolved by Milestone 3.
- The maps tool was the only tool that threw on invalid input instead of returning `{ success: false, error }`. Aligned it with the standard pattern in Milestone 5.
- Post-completion review found the boundary lint script's tool-handler check was implemented but not executed, and two tool handlers (`delete_user_data`, `toggle_email_watcher`) still lacked runtime input validation. Added script wiring and validation/tests the same day.

## Decision Log

- Decision: Use a lightweight validation utility rather than a schema framework (e.g., Zod).
  Rationale: Core beliefs say "prefer boring technology" and "keep the dependency tree shallow." The validation needed is simple type-and-presence checking, not complex schema composition. A small utility in `src/tools/utils.ts` avoids a new dependency and matches the existing pattern where `requirePhoneNumber`, `handleAuthError`, and `errorResult` already live. The calendar domain tools in `src/domains/calendar/runtime/tools.ts` already demonstrate the target pattern — `as` type assertion followed by manual `typeof` checks. The utility standardizes this into a reusable helper so every handler follows the same convention.
  Date/Author: 2026-02-28 / Claude

- Decision: Add a mechanical boundary-validation gate (`npm run lint:boundaries`) in addition to tests.
  Rationale: The boundary work spans many files and is easy to regress. A mechanical guard catches unsafe patterns early and keeps reviews focused.
  Date/Author: 2026-02-28 / Claude (updated 2026-02-28 per user direction)

- Decision: Do not create "adapter" or "decoder" abstraction layers for external boundaries.
  Rationale: Core beliefs say "three similar lines of code beat one wrong abstraction." The fixes for Google API non-null assertions, Anthropic JSON parsing, and Twilio webhook validation are each a few lines of inline defensive checks at the specific boundary points. Wrapping them in named adapter classes adds indirection and a new architectural concept that no one needs to learn.
  Date/Author: 2026-02-28 / Claude

- Decision: Structure milestones to match boundary categories (tool inputs, external APIs, data layer, date resolver) rather than by domain.
  Rationale: The same type of fix applies across many domains. Fixing all tool handler boundaries in one milestone ensures consistent patterns and allows shared test helpers to be written once and reused. This mirrors the observability exec plan (`docs/exec-plans/completed/observability-90-all-domains.md`) which organized by concern (shared contract, request path, background systems, domain runtime) rather than by individual domain.
  Date/Author: 2026-02-28 / Claude

- Decision: Keep this ExecPlan strictly scoped to boundary validation only.
  Rationale: Reliability/performance concerns should be tracked separately so this plan stays focused on lifting boundary scores above 90 across all active domains.
  Date/Author: 2026-02-28 / Claude (updated 2026-02-28 per user direction)

- Decision: Malformed Twilio webhook payloads should be rejected with HTTP 400.
  Rationale: Webhook ingress is the outermost external boundary and should fail fast when required boundary fields are malformed.
  Date/Author: 2026-02-28 / Claude (updated 2026-02-28 per user direction)

- Decision: Data-layer boundary violations should fail fast with explicit errors.
  Rationale: Silent skips/coercions hide corruption and make root-cause analysis harder; fail-fast behavior keeps boundary failures diagnosable.
  Date/Author: 2026-02-28 / Claude (updated 2026-02-28 per user direction)

## Outcomes & Retrospective

**Completed 2026-02-28.**

All 15 active domains now have boundary validation scores of 90 in `QUALITY_SCORE.md`. The retired General agent row was removed.

Final verification results:
- `npm run test:unit` — 884 tests passed (66 test files)
- `npm run test:integration` — 42 tests passed (5 test files)
- `npm run lint` — clean
- `npm run lint:boundaries` — 0 violations
- `npm run lint:architecture --strict` — 0 violations
- `npm run build` — clean

Key deliverables:
1. `validateInput` utility in `src/tools/utils.ts` — standardized tool input validation across all domains
2. `scripts/check-boundary-validations.mjs` — mechanical boundary lint to prevent regressions (including active tool-handler checks)
3. Tool handlers across Scheduler, Email, Drive, Memory, UI, plus shared `user-config` and `email-watcher` tools now validate LLM inputs before `as` casts
4. All Google API non-null assertions replaced with explicit field checks
5. Twilio webhook rejects malformed payloads with HTTP 400
6. Anthropic JSON responses shape-checked after parsing
7. SQLite row-to-object conversions fail fast on corrupt required fields
8. Conversation store media attachment JSON safely parsed with shape validation
9. Date resolver boundary tests for DST, leap year, year boundary, weekday same-day
10. Email watcher classifier text capped at 10,000 chars

## Context and Orientation

Boundary validation in the `QUALITY_SCORE.md` rubric means: validate data at system boundaries where external input enters your domain. External input includes incoming SMS payloads from Twilio, API responses from Google and Anthropic, LLM-provided tool arguments, and database reads that might return unexpected shapes. Internal function calls between trusted modules do not need validation.

A score of 90+ means: external inputs are validated or safely parsed before use, and malformed data does not propagate into domain logic. Scores drop when: raw external data is used without checks, type assertions are used on API responses, or user/LLM-provided values in tool arguments go unvalidated.

The current boundary validation scores by domain (from `QUALITY_SCORE.md`):

    Orchestrator: 90     (already at target)
    Calendar:     90     (already at target — this is the reference pattern)
    Scheduler:    65
    Email:        65
    Drive:        65
    Memory:       70
    UI:           75
    SMS routing:  75
    Memory sys:   80
    Email watcher:80
    Database:     80
    Scheduler sys:70
    Date resolver:60
    Tools layer:  70
    Google integ: 70
    General agent:55     (retired — remove from scoreboard)

There are four categories of boundary where validation is missing or incomplete.

Category 1 — Tool handler inputs. Every tool handler in `src/domains/*/runtime/tools.ts` and `src/tools/*.ts` receives an `input: Record<string, unknown>` parameter from the LLM. The handler currently casts this with `input as { field: type }` and starts using properties without checking that they exist or have the right type. If the LLM sends `max_results: "ten"` instead of `10`, or omits a required field, the handler will not catch it until something crashes deeper in the call chain. The calendar tools in `src/domains/calendar/runtime/tools.ts` are the exception — they already do `typeof` checks after the `as` assertion and return clear error messages. This is the gold standard pattern.

Category 2 — External API responses. Google API client responses are accessed with TypeScript non-null assertions (`!`) in `src/domains/email/providers/gmail.ts`, `src/domains/drive/providers/google-drive.ts`, and `src/domains/drive/providers/google-sheets.ts`. Anthropic LLM responses are `JSON.parse`-ed and cast with `as` to typed objects in `src/services/anthropic/classification.ts`, `src/orchestrator/planner.ts`, and `src/orchestrator/replanner.ts`. The Twilio webhook body in `src/routes/sms.ts` is cast with `as TwilioWebhookBody` without field-level validation.

Category 3 — Database row conversions. SQLite row-to-object conversions in `src/domains/scheduler/repo/sqlite.ts` and `src/services/conversation/sqlite.ts` trust column shapes without null checks. For example, `row.enabled === 1` silently becomes `false` when `enabled` is NULL instead of surfacing a data corruption error.

Category 4 — Date resolver edge cases. The date resolver in `src/services/date/resolver.ts` has limited boundary coverage for DST transitions, leap years, year boundaries, and ambiguous weekday references that produce silently wrong results.

Key files and their roles:

- `src/tools/utils.ts` — Shared utilities for tool handlers. Currently contains `requirePhoneNumber`, `handleAuthError`, `errorResult`, and `isValidTimezone`. The new validation utility will be added here.
- `src/tools/types.ts` — Defines `ToolHandler` type signature: `(input: Record<string, unknown>, context: ToolContext) => Promise<Record<string, unknown>>`. The `input` parameter is `Record<string, unknown>`, meaning handlers receive untyped data from the LLM.
- `src/tools/index.ts` — Central tool registry. The `executeTool` function dispatches to handlers. This is where centralized pre-validation could optionally be added.
- `src/domains/calendar/runtime/tools.ts` — Reference implementation showing correct boundary validation pattern: cast with `as`, then check each field with `typeof` and return `{ success: false, error: '...' }` for invalid inputs.
- `config/architecture-boundaries.json` — Defines the forward-layer rule and cross-domain import restrictions that structural compliance checks enforce.

## Layer Compliance Strategy

All new validation code lives in `src/tools/utils.ts`, which is in the tools layer. Every domain runtime file can already import from `src/tools/` per the architecture boundaries in `config/architecture-boundaries.json` (the `domainExternalRules.allowed` list includes `src/tools/`). No new cross-domain imports are needed.

Boundary-focused tests live alongside existing test files in `tests/unit/tools/`, `tests/unit/routes/`, `tests/unit/orchestrator/`, `tests/unit/scheduler/`, `tests/unit/date/`, and `tests/unit/services/`. No new test directories are needed.

External API boundary fixes are inline changes in provider and service files within their existing domain directories. No layer or cross-domain boundaries are affected.

Compliance will be verified mechanically with:

    cd /home/adiaconou/Code/hermes-assistant
    npm run lint:boundaries
    npm run lint:architecture --strict

This command must pass at every milestone before proceeding to the next.

## Plan of Work

### Milestone 1: Shared Validation Utility and Boundary Test Helpers

At the end of this milestone, `src/tools/utils.ts` contains a `validateInput` helper function that tool handlers can call to replace the `input as {...}` pattern with runtime-checked parsing. A boundary test helper exists for writing concise malformed-input tests. Both are proven by unit tests.

The validation utility does not need to be a full schema system. It needs to do four things: check that required fields exist, check expected base types, enforce non-empty strings where needed, and support field-level custom validators for complex nested values. The calendar tools in `src/domains/calendar/runtime/tools.ts` demonstrate the desired behavior — the utility standardizes those checks into a reusable function.

Add to `src/tools/utils.ts`:

A function called `validateInput` that accepts raw `input: Record<string, unknown>` and a field specification object. The field specification maps field names to expected base type (`string`, `number`, `boolean`, `array`, `object`), required flag, optional non-empty enforcement, and optional field-level `validate(value)` callback for complex shapes. For required fields, the function checks presence and type. For optional fields, it checks type only when present. If validation fails, return `{ success: false, error: string }`. If validation passes, return `null`.

This pattern keeps the tool handler as the owner of its logic — the handler calls `validateInput`, checks the result, and returns early if validation failed. The handler still uses `as` for TypeScript type narrowing after validation passes, but now it is safe because the runtime check happened first.

Add to `tests/unit/tools/validation.test.ts`:

Tests that verify `validateInput` catches: missing required fields, wrong types (string where number expected, number where string expected), null values, undefined values, empty required strings, and custom-validator failures for complex fields. Also verify that valid inputs pass through without error.

Add mechanical guard setup in Milestone 1:

- Create `scripts/check-boundary-validations.mjs` to flag high-risk boundary anti-patterns in source files.
- Add `lint:boundaries` script to `package.json`.
- Include `npm run lint:boundaries` in milestone verification commands.

### Milestone 2: Tool Handler Boundaries for Agent Domains

At the end of this milestone, the five agent domains with boundary scores below 90 (Scheduler at 65, Email at 65, Drive at 65, Memory at 70, UI at 75) have tool handlers that validate all LLM-provided inputs using the `validateInput` utility from Milestone 1. Each domain has boundary-focused tests that exercise malformed inputs.

For each domain, the work follows the same pattern:

1. Open the `runtime/tools.ts` file for the domain.
2. At the top of each tool handler, add a `validateInput` call with the field specification matching the tool's `input_schema`.
3. If `validateInput` returns an error, return it immediately.
4. Keep the existing `as` type assertion for TypeScript narrowing (it is now safe).
5. Add any domain-specific validation that goes beyond type checking (e.g., scheduler's `isValidCron` call, email's non-empty ID check, drive's MIME type format check).
6. Add boundary tests in the corresponding `tests/unit/tools/` file.

Specific files and fixes per domain:

Scheduler agent (`src/domains/scheduler/runtime/tools.ts`): add `validateInput` at the top of handlers that consume LLM input (`create_scheduled_job`, `update_scheduled_job`, `delete_scheduled_job`). Validate required/optional field types before narrowing and keep existing domain checks (prompt length, schedule parsing). For recurring schedules, validate generated cron with `isValidCron()` before persistence. Add boundary tests in `tests/unit/tools/scheduler.test.ts` for: missing prompt, prompt as number, schedule as number, job_id as number, empty required strings.

Email agent (`src/domains/email/runtime/tools.ts`): add validation for `query` (optional string), `max_results` (optional number), `include_spam` (optional boolean), plus required non-empty `id`/`thread_id` in read/thread handlers. Add boundary tests for wrong-type and missing/empty required fields (extend existing tests or add `tests/unit/tools/email.test.ts`).

Drive agent (`src/domains/drive/runtime/tools.ts`): The `upload_to_drive` handler at line 55 uses `input as { name: string; content: string; mime_type: string; ... }` — add validation for `name` (required non-empty string), `content` (required string), `mime_type` (required string matching a basic format check), `is_base64` (optional boolean). Other drive tools (list, search, create folder, read file) need similar treatment. Extend `tests/unit/tools/drive.test.ts` with boundary tests for: empty name, missing content, `is_base64` as string instead of boolean, missing mime_type.

Memory agent (`src/domains/memory/runtime/tools.ts`): standardize with `validateInput` across `extract_memory`, `list_memories`, `update_memory`, and `remove_memory`. Keep existing domain checks and add tests for: fact as number, limit as string, empty fact string, and wrong-type IDs.

UI agent: Extend existing tests to cover HTML/CSS/JS at exact size limits (100KB HTML, 50KB CSS, 100KB JS). Test that data URI patterns in CSP enforcement are properly blocked.

### Milestone 3: External API Boundaries

At the end of this milestone, the three categories of external API boundary — Twilio webhooks, Anthropic LLM JSON responses, and Google API responses — are defensively validated instead of trusted via type assertions and non-null operators.

Twilio webhook (`src/routes/sms.ts`): replace direct ingress cast with explicit boundary checks. Require `From` as string; malformed payloads should return HTTP 400 with structured log context. Allow missing `Body` for media-only flows by defaulting to empty string, but reject wrong non-string body types. This is the outermost system boundary. Add/update tests in `tests/integration/webhook.test.ts` and route-level unit tests for malformed payloads (missing `From`, wrong field types).

Anthropic response parsing (`src/services/anthropic/classification.ts`, `src/orchestrator/planner.ts`, `src/orchestrator/replanner.ts`): after `JSON.parse`, add shape checks before use. Expected minimum shapes:
- classifier: `needsAsyncWork` boolean + `immediateResponse` string.
- planner/replanner: object with `steps` array and required step fields consumed downstream.
If shape validation fails, treat it as parse failure and use existing fallback logic. Add tests for valid JSON with invalid structure.

Google API responses (`src/domains/email/providers/gmail.ts`, `src/domains/drive/providers/google-drive.ts`, `src/domains/drive/providers/google-sheets.ts`): replace non-null assertions with explicit required-field checks at mapping boundaries. Where IDs/keys are required downstream, fail fast with explicit errors rather than propagating empty sentinel values. Add tests for missing required fields.

Drive search query (`src/domains/google-core/service/drive-folders.ts` lines 53-61): The Drive API query is built by string concatenation with user-provided folder names. Escape single quotes in folder names to prevent malformed queries. Add a test for folder names containing `'` characters.

### Milestone 4: Data Layer Boundaries

At the end of this milestone, database row-to-object conversions handle NULL values explicitly, and data-layer stores validate shapes at read boundaries.

Scheduler repo (`src/domains/scheduler/repo/sqlite.ts`): harden row-to-domain conversion with explicit required-field checks (`id`, `phone_number`, `prompt`, `cron_expression`, `enabled`, `timezone`). On invalid/null required fields, fail fast with explicit error (do not silently coerce or skip). Validate timezone shape at read boundary. Add tests in `tests/unit/scheduler/sqlite.test.ts` for NULL/malformed required fields.

Conversation store (`src/services/conversation/sqlite.ts`): At line 189 (and similar locations), JSON columns are parsed and cast. Add shape checks after JSON parsing to verify expected fields exist. Add tests for malformed JSON in conversation metadata columns.

Memory repo (`src/domains/memory/repo/sqlite.ts`): add read-boundary checks for required row fields and source-type shape, plus confidence clamping to [0.0-1.0] on read to contain bad persisted values from older code paths. Add tests for out-of-range confidence and malformed/null fields.

### Milestone 5: Date Resolver Boundary Hardening

At the end of this milestone, the date resolver has boundary tests for the edge cases most likely to produce silently wrong results, and the remaining low-scoring domains (SMS routing at 75, Tools layer at 70, Google integrations at 70) have their boundary-specific fixes verified.

Date resolver (`src/services/date/resolver.ts`): Add tests in `tests/unit/date/resolver.test.ts` for:

- DST spring-forward: "9am" on the day clocks spring forward in America/New_York. Verify the result is valid and not shifted by an hour.
- DST fall-back: "1:30am" on the day clocks fall back. Verify the result is unambiguous or picks the forward interpretation.
- Leap year: "February 29" when the current year is a leap year and when it is not.
- Year boundary: "next Monday" when today is Sunday December 31. Verify the result is in January of the next year.
- Weekday same-day: "next Sunday" when today is Sunday. Verify the result is 7 days in the future, not today. This exercises the weekday mapping at line 110 where Luxon uses 1=Monday through 7=Sunday.

Validate that the weekday mapping in `parseNextWeekday` at line 99 correctly handles the 1-indexed (Luxon) vs 0-indexed (JavaScript Date) discrepancy. If there is a bug, fix it. If there is not, the test documents the correct behavior.

SMS routing boundary fixes: Verify that the Twilio webhook validation from Milestone 3 is in place. The remaining SMS routing boundary issue is the structural violation at line 24 (`import { getMemoryStore } from '../domains/memory/runtime/index.js'`). This is a structural compliance issue (scored separately) rather than a boundary validation issue, so it does not need to be fixed in this plan. However, note it for the structural compliance dimension.

Tools layer: Verify that `validateInput` from Milestone 1 is used consistently. The maps tool in `src/tools/maps.ts` currently throws on invalid address input; align it with standard boundary behavior (`{ success: false, error }`) so malformed tool input does not propagate as thrown exceptions.

Email watcher (`src/domains/email-watcher/`): Cap the classifier text length for emails with extremely long attachment name lists in `src/domains/email-watcher/service/classifier.ts`. Add a test for an email with many attachments to verify the text does not exceed a reasonable limit.

Scheduler system: Verify that the cron validation and timezone validation from Milestone 2 (tool handlers) and Milestone 4 (DB layer) together cover the scheduler system boundary. No additional work needed beyond what those milestones deliver.

### Milestone 6: Housekeeping and Re-Grading

At the end of this milestone, `QUALITY_SCORE.md` is updated with boundary validation scores above 90 for every active domain, with evidence links in the same style as the observability re-grade notes at lines 98-112.

Verify mechanical enforcement added earlier in Milestone 1 remains green across the full suite:

- `scripts/check-boundary-validations.mjs`
- `npm run lint:boundaries`

Remove the General Agent row from `QUALITY_SCORE.md` line 88. The agent was fully retired in commit `02d6b54` and no code exists for it. Keeping a scored row for retired code distorts the "all domains above 90" target.

Update each domain's boundary score based on the work completed in Milestones 1-5. For each domain, add a brief evidence note referencing the specific test files and code changes that justify the new score. The format should match the existing observability re-grade notes section.

Re-run full verification:

    npm run test:unit
    npm run test:integration
    npm run lint
    npm run lint:boundaries
    npm run lint:architecture --strict
    npm run build

All commands must pass. Update this plan's `Outcomes & Retrospective` section with the final results.

## Concrete Steps

All commands run from WSL in `/home/adiaconou/Code/hermes-assistant`.

1. Implement Milestone 1 (validation utility), then run:

        npx vitest run tests/unit/tools/validation.test.ts
        npm run lint
        npm run lint:boundaries
        npm run lint:architecture --strict

    Expected: new test file passes with all validation scenarios covered. Lint and architecture checks pass.

2. Implement Milestone 2 (tool handler boundaries), then run:

        npx vitest run tests/unit/tools/
        npm run lint
        npm run lint:boundaries
        npm run lint:architecture --strict

    Expected: all tool tests pass, including new boundary tests for scheduler, email, drive, memory, and UI tools. No architecture violations.

3. Implement Milestone 3 (external API boundaries), then run:

        npx vitest run tests/integration/webhook.test.ts tests/unit/orchestrator/ tests/unit/gmail-service.test.ts
        npm run lint
        npm run lint:boundaries

    Expected: webhook validation tests pass, Anthropic response shape tests pass, Google API defensive check tests pass.

4. Implement Milestone 4 (data layer boundaries), then run:

        npx vitest run tests/unit/scheduler/sqlite.test.ts tests/unit/memory-sqlite.test.ts
        npm run test:unit
        npm run lint
        npm run lint:boundaries

    Expected: NULL handling tests pass, full unit suite still passes.

5. Implement Milestone 5 (date resolver + remaining), then run:

        npx vitest run tests/unit/date/resolver.test.ts
        npm run test:unit
        npm run test:integration
        npm run lint
        npm run lint:boundaries
        npm run lint:architecture --strict
        npm run build

    Expected: date resolver boundary tests pass (DST, leap year, year boundary, weekday same-day). Full suite passes. Build succeeds.

6. Implement Milestone 6 (housekeeping), then run:

        npm run test:unit
        npm run test:integration
        npm run lint
        npm run lint:boundaries
        npm run lint:architecture --strict
        npm run build

    Expected: all commands pass. `QUALITY_SCORE.md` updated with boundary scores above 90 and evidence links for every domain.

## Validation and Acceptance

Acceptance is behavior-first and must be demonstrated with tests, not only code inspection.

For tool handler boundaries: run boundary-focused tests that send malformed inputs (wrong types, missing fields, empty strings, null values) to each tool handler and verify the handler returns `{ success: false, error: '...' }` with a clear message instead of crashing. Every domain's boundary test file must include at least: one test for a missing required field, one test for a wrong-type field, and one test for an empty/null value where non-empty is expected.

For external API boundaries: run tests that exercise malformed webhook payloads (missing `From`, wrong types), malformed Anthropic JSON responses (valid JSON but missing required shape fields), and Google API responses with missing IDs. Verify that each boundary returns a clear error or falls back gracefully instead of crashing with a TypeError.

For data layer boundaries: run tests that exercise SQLite rows with NULL values in required fields. Verify that the code fails fast with a clear explicit error rather than silently converting NULL to defaults.

For date resolver: run tests for DST transitions, leap year, year boundary, and weekday same-day scenarios. Verify that results are correct (the right date and time) rather than shifted by timezone offsets or off by a week.

Because this plan targets boundary hardening, architecture updates are not expected. If implementation changes externally visible behavior (for example malformed webhook handling), reassess whether `ARCHITECTURE.md` needs a targeted update note.

## Idempotence and Recovery

All changes in this plan are additive. Validation checks are added before existing logic — they cannot break correct inputs because valid data passes through unchanged. The `as` type assertions remain for TypeScript type narrowing after runtime checks pass, so TypeScript compilation is unaffected.

Each milestone must leave tests and lint green before moving to the next. If a milestone step fails midway, recovery is to complete the file set in that milestone and rerun the milestone commands. No destructive operations or data migrations are involved.

The validation utility in Milestone 1 is the only dependency between milestones. Milestones 2-5 depend on it but are otherwise independent of each other and could be executed in any order if needed.

Mechanical guardrails from Milestone 1 are part of steady-state recovery: if boundary regressions are introduced later, `npm run lint:boundaries` should fail before merge.

## Artifacts and Notes

Target validation pattern (from calendar tools, the gold standard):

    // In handler function:
    const validationError = validateInput(input, {
      prompt: { type: 'string', required: true },
      schedule: { type: 'string', required: true },
      skill_name: { type: 'string', required: false },
    });
    if (validationError) return validationError;

    // Safe to narrow now — runtime check passed
    const { prompt, schedule, skill_name } = input as {
      prompt: string;
      schedule: string;
      skill_name?: string;
    };

Target error response for boundary validation failure:

    {
      "success": false,
      "error": "prompt must be a non-empty string."
    }

Target boundary test pattern:

    it('rejects missing required field', async () => {
      const result = await handler({}, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('prompt');
    });

    it('rejects wrong type for numeric field', async () => {
      const result = await handler({ prompt: 'test', schedule: 'daily', max_results: 'ten' }, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('max_results');
    });

## Interfaces and Dependencies

No new external npm dependencies are required.

The shared validation API should expose these functions in `src/tools/utils.ts`:

    /**
     * Validate tool input fields against a specification.
     * Returns an error result object if validation fails, or null if input is valid.
     */
    export function validateInput(
      input: Record<string, unknown>,
      spec: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'array' | 'object';
        required: boolean;
        nonEmpty?: boolean;
        validate?: (value: unknown) => string | null;
      }>
    ): Record<string, unknown> | null;

The function returns `{ success: false, error: string }` on validation failure or `null` on success. The `nonEmpty` flag (defaulting to `true` for required strings) rejects empty/whitespace-only strings. Optional field-level `validate` callbacks handle complex nested shapes without introducing a full schema framework. Each tool handler calls this function and returns early on failure.

Existing utilities in `src/tools/utils.ts` remain unchanged: `requirePhoneNumber`, `handleAuthError`, `errorResult`, `endOfDay`, `isValidTimezone`. The `validateInput` function is added alongside them.
