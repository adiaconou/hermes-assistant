# Implementation Plan: Architectural Improvements

**Source:** [30-architectural-review.md](30-architectural-review.md)
**Created:** February 7, 2026
**Status:** Not Started

---

## Overview

This document provides a phased implementation plan for addressing the 27 issues identified in the architectural review. Each issue includes a checklist, effort estimate, and acceptance criteria.

Before starting implementation, run a **baseline reconciliation** against the current codebase. This prevents duplicate work on items that have already been partially or fully completed since the review was written.

**Total Estimated Effort:** 73-107 engineering hours (~4-7 weeks depending on team capacity/allocation)
**Critical Issues:** 2
**High Priority Issues:** 6
**Medium Priority Issues:** 6
**Low Priority Issues:** 11

---

## Quick Reference

| Phase | Focus | Duration | Issues |
|-------|-------|----------|--------|
| Phase 0 | Baseline Reconciliation | 0.5-1 day | 25 issues triage |
| Phase 1 | Critical Reliability | Week 1 | 2 issues |
| Phase 2 | High Priority Reliability | Week 2 | 3 issues |
| Phase 3 | Performance & Observability | Week 3 | 3 issues |
| Phase 4 | Technical Debt | Ongoing | 17 issues |

---

## Phase 0: Baseline Reconciliation (Before Phase 1)

**Priority:** REQUIRED - complete before implementation work begins
**Total Effort:** 4-8 hours (0.5-1 day)

**Checklist:**
- [ ] Review each remaining issue against current `src/` and `tests/` code
- [ ] Mark each issue status as:
  - [ ] `Not Started`
  - [ ] `Partially Implemented`
  - [ ] `Completed`
- [ ] For `Partially Implemented` issues, list the remaining delta work explicitly
- [ ] Update effort estimates based on actual remaining work
- [ ] Reorder work inside each phase based on dependencies discovered during reconciliation
- [ ] Update the Progress Tracking section with baseline status before starting Phase 1

**Acceptance Criteria:**
- ✅ Every issue has an explicit baseline status (Not Started / Partial / Completed)
- ✅ No issue starts implementation without a delta scope
- ✅ Timeline and progress totals reflect current reality

---

## Phase 1: Critical Fixes (Week 1)

**Priority:** IMMEDIATE - Deploy before next production release
**Total Effort:** 4-7 hours (0.5-1 day)

### Issue #1: Fix Database Connection Leaks 🔴 CRITICAL

**Risk:** Resource exhaustion, production crashes
**Files:** `src/admin/email-skills.ts`, `src/admin/memory.ts`
**Effort:** 2-4 hours

**Checklist:**
- [ ] Update `src/admin/email-skills.ts`:
  - [ ] Replace direct `Database` instantiation with singleton store
  - [ ] Import `getEmailSkillStore()` from service
  - [ ] Update all route handlers to use store methods
  - [ ] Remove `new Database()` calls
- [ ] Update `src/admin/memory.ts`:
  - [ ] Replace direct `Database` instantiation with `getMemoryStore()`
  - [ ] Update all route handlers
  - [ ] Remove `new Database()` calls
- [ ] Test all admin endpoints still work
- [ ] Monitor resource usage after deployment
- [ ] Add test to verify no connection leaks

**Acceptance Criteria:**
- ✅ No direct `new Database()` calls in admin routes
- ✅ All admin routes use singleton stores
- ✅ Resource monitoring shows no connection leak
- ✅ All admin endpoints functional

**Reference:** See [Issue #1](30-architectural-review.md#issue-1-database-connection-leak-in-admin-routes--critical)

---

### Issue #2: Add Scheduler Database Cleanup

**Risk:** Data corruption on shutdown
**Files:** `src/services/scheduler/sqlite.ts`, `src/index.ts`
**Effort:** 2-3 hours

**Checklist:**
- [ ] Add `close()` method to `SchedulerStore` class
- [ ] Update `src/index.ts` SIGTERM handler:
  - [ ] Call `schedulerPoller.stop()` first
  - [ ] Then call `schedulerStore.close()`
- [ ] Update `createIntervalPoller()` to support graceful stop:
  - [ ] Add `running` flag
  - [ ] Add `stopped` flag
  - [ ] Implement `stop()` method that waits for in-flight operations
- [ ] Update all background pollers to use new poller API
- [ ] Test graceful shutdown (SIGTERM)
- [ ] Verify no data corruption after restart

**Acceptance Criteria:**
- ✅ Scheduler database closed on shutdown
- ✅ In-flight jobs complete before shutdown
- ✅ No data corruption after forced restart
- ✅ All pollers stop gracefully

**Reference:** See [Issue #2](30-architectural-review.md#issue-2-scheduler-database-missing-cleanup)

---

## Phase 2: Reliability Improvements (Week 2-3)

**Priority:** HIGH - Next sprint
**Total Effort:** 11-17 hours (1.5-2.5 days)

### Issue #3: Add Promise Rejection Handling

**Risk:** Silent failures, unhandled rejections
**Files:** `src/orchestrator/handler.ts`, `src/services/*/processor.ts`
**Effort:** 1-2 hours

**Checklist:**
- [ ] Update `src/orchestrator/handler.ts`:
  - [ ] Add SMS notification in catch block
  - [ ] Send error to user when orchestration fails
- [ ] Update `src/services/memory/processor.ts`:
  - [ ] Wrap process function in try-catch
  - [ ] Log errors but continue processing
- [ ] Update `src/services/email-watcher/sync.ts`:
  - [ ] Add error handling to sync loop
  - [ ] Continue on errors
- [ ] Update `src/services/scheduler/poller.ts`:
  - [ ] Add error handling to job execution
  - [ ] Continue polling on errors
- [ ] Test error notification reaches user
- [ ] Monitor error rates after deployment

**Acceptance Criteria:**
- ✅ Users notified when orchestration fails
- ✅ Background processors continue on errors
- ✅ All errors logged
- ✅ No unhandled promise rejections

**Reference:** See [Issue #3](30-architectural-review.md#issue-3-promise-rejection-handling)

---

### Issue #13: Add Retry Logic for External APIs

**Risk:** Transient API failures cause permanent errors
**Files:** `src/utils/retry.ts` (new), `src/services/google/*.ts`
**Effort:** 2-3 hours

**Checklist:**
- [ ] Create `src/utils/retry.ts`:
  - [ ] Implement `withRetry()` function with exponential backoff
  - [ ] Configure max retries: 3 attempts
  - [ ] Configure initial delay: 1 second
  - [ ] Configure max delay: 10 seconds (caps exponential growth)
  - [ ] Only retry on transient errors (network, timeout, 5xx)
  - [ ] Don't retry on permanent errors (4xx, auth failures)
- [ ] Update Google services to use retry wrapper:
  - [ ] `src/services/google/calendar.ts` - wrap API calls
  - [ ] `src/services/google/gmail.ts` - wrap API calls
  - [ ] `src/services/google/drive.ts` - wrap API calls
  - [ ] `src/services/google/sheets.ts` - wrap API calls
  - [ ] `src/services/google/docs.ts` - wrap API calls
- [ ] Add retry attempt logging
- [ ] Test retry succeeds after transient failure
- [ ] Test retry stops on permanent error (4xx)
- [ ] Test exponential backoff timing (1s, 2s, 4s)

**Acceptance Criteria:**
- ✅ All external API calls wrapped with retry logic
- ✅ Transient failures automatically retried (up to 3 times)
- ✅ Exponential backoff prevents hammering failing services
- ✅ Permanent errors (4xx) not retried
- ✅ Retry attempts logged for debugging

**Reference:** See [Issue #13](30-architectural-review.md#issue-13-no-circuit-breaker-for-external-services)

---

### Issue #4: Fix Timeout Enforcement

**Risk:** Hung operations, resource exhaustion
**Files:** `src/utils/timeout.ts` (new), `src/orchestrator/orchestrate.ts`, `src/executor/tool-executor.ts`
**Effort:** 4-6 hours

**Checklist:**
- [ ] Create `src/utils/timeout.ts`:
  - [ ] Implement `withTimeout()` wrapper using Promise.race
  - [ ] Accept timeout duration and error message
- [ ] Update orchestrator timeouts:
  - [ ] Wrap `orchestrateInternal()` with 5-minute timeout
  - [ ] Handle timeout errors gracefully
  - [ ] Notify user on timeout
- [ ] Update step execution timeouts:
  - [ ] Wrap `executeWithTools()` with 2-minute timeout
  - [ ] Return error result on timeout
- [ ] Add tool-level timeouts:
  - [ ] Wrap individual tool execution with 1-minute timeout
  - [ ] Handle timeout per tool
- [ ] Update `src/config.ts` with timeout constants
- [ ] Test orchestrator timeout at 5 minutes
- [ ] Test step timeout at 2 minutes
- [ ] Test tool timeout at 1 minute

**Acceptance Criteria:**
- ✅ Orchestrator times out after 5 minutes
- ✅ Steps time out after 2 minutes
- ✅ Individual tools time out after 1 minute
- ✅ Timeout errors handled gracefully
- ✅ Users notified of timeouts

**Reference:** See [Issue #4](30-architectural-review.md#issue-4-inconsistent-timeout-enforcement)

---

## Phase 3: Performance & Observability (Week 4)

**Priority:** MEDIUM
**Total Effort:** 18-24 hours (3-4 days)

### Issue #11: Simplify Planning Fallback

**Risk:** Extra latency (2-5s), increased cost
**Files:** `src/orchestrator/planner.ts`
**Effort:** 3-5 hours
**Recommended Approach:** Option 3 - Use Claude Structured Output

**Checklist:**
- [ ] Define JSON schema for plan response:
  - [ ] Create TypeScript interface matching current `ParsedPlanResponse`
  - [ ] Convert to JSON schema format for Anthropic API
  - [ ] Include fields: `analysis`, `goal`, `steps[]` with `id`, `agent`, `task`
- [ ] Update `createPlan()` function:
  - [ ] Add `response_format` parameter to `anthropic.messages.create()` call
  - [ ] Pass JSON schema to enforce structure
  - [ ] Remove `parsePlanResponse()` call (no longer needed)
  - [ ] Remove `repairPlanResponse()` function entirely
  - [ ] Keep `createGeneralFallbackPlan()` for API errors only
  - [ ] Log structured JSON output to dev log files via `logger?.llmResponse()`
- [ ] Update logging:
  - [ ] Log the raw structured JSON response to trace logs
  - [ ] Log response validation status (valid/invalid schema)
  - [ ] Include schema version in logs for debugging
- [ ] Remove dead code:
  - [ ] Delete `parsePlanResponse()` function
  - [ ] Delete `repairPlanResponse()` function
  - [ ] Delete `PLAN_REPAIR_PROMPT` constant
  - [ ] Remove 30-40 lines of unused parsing logic
- [ ] Update tests:
  - [ ] Remove repair step tests
  - [ ] Add structured output tests
  - [ ] Test fallback on API errors (not parse errors)
- [ ] Monitor after deployment:
  - [ ] Measure latency improvement (should eliminate 2-5s repair calls)
  - [ ] Track API error rates (should be near zero parse failures)
  - [ ] Verify dev logs capture structured output

**Acceptance Criteria:**
- ✅ Planning uses structured output (no parsing needed)
- ✅ Repair step completely removed (saves 2-5s latency)
- ✅ Structured JSON logged to dev log files
- ✅ General-agent fallback works for API errors
- ✅ No parse failures possible (enforced by API)
- ✅ Tests updated and passing
- ✅ 30-40 lines of dead code removed

**Reference:** See [Issue #11](30-architectural-review.md#issue-11-triple-fallback-cascade-in-planning)

---

### Issue #7: Standardize Error Handling

**Risk:** Inconsistent behavior, debugging difficulty
**Files:** `src/utils/error-handling.ts` (new), multiple files
**Effort:** 8-12 hours

**Checklist:**
- [ ] Create `src/utils/error-handling.ts`:
  - [ ] Define `AppError` class
  - [ ] Implement `withErrorPropagation()`
  - [ ] Implement `withNullOnError()`
  - [ ] Implement `withResultObject()`
- [ ] Update orchestrator error handling:
  - [ ] Use `withErrorPropagation()` for critical paths
  - [ ] Standardize error format
- [ ] Update admin routes:
  - [ ] Use `withNullOnError()` for queries
  - [ ] Return consistent error responses
- [ ] Update service layer:
  - [ ] Use `withResultObject()` for external APIs
  - [ ] Standardize result format
- [ ] Replace inconsistent try-catch patterns (prioritize high-traffic paths)
- [ ] Update error logging to use new patterns
- [ ] Add tests for error handling utilities

**Acceptance Criteria:**
- ✅ Error handling utilities implemented
- ✅ Critical paths use standardized error handling
- ✅ Consistent error response format
- ✅ Error handling utilities tested

**Reference:** See [Issue #7](30-architectural-review.md#issue-7-inconsistent-try-catch-patterns)

---

### Issue #15: Consolidate Logging

**Risk:** Debugging difficulty, observability gaps
**Files:** `src/utils/logger.ts` (new), multiple files
**Effort:** 12-16 hours

**Checklist:**
- [ ] Install Pino: `npm install pino pino-pretty`
- [ ] Create `src/utils/logger.ts`:
  - [ ] Configure Pino logger
  - [ ] Production: JSON output
  - [ ] Development: Pretty output
  - [ ] Implement `createLogger()` for child loggers
- [ ] Replace console logging (high-priority files):
  - [ ] `src/orchestrator/*.ts` - structured logging
  - [ ] `src/executor/*.ts` - structured logging
  - [ ] `src/routes/*.ts` - request logging
  - [ ] `src/services/anthropic/*.ts` - LLM call logging
- [ ] Remove `src/utils/trace-logger.ts` (consolidate into Pino)
- [ ] Update orchestrator logging to use structured format
- [ ] Add request ID tracking
- [ ] Update tests to handle new logging
- [ ] Document logging standards

**Acceptance Criteria:**
- ✅ Pino logger configured for production and dev
- ✅ Structured JSON logging in production
- ✅ Pretty logging in development
- ✅ Request ID tracking implemented
- ✅ High-traffic paths using new logger
- ✅ Old trace-logger removed

**Reference:** See [Issue #15](30-architectural-review.md#issue-15-logging-system-duplication)

---

## Phase 4: Technical Debt (Ongoing)

**Priority:** LOW - Address incrementally
**Total Effort:** 40-60 hours (2-3 weeks)

### Configuration & Code Organization

#### Issue #22 & #23: Centralize Configuration

**Files:** `src/config.ts`, multiple files
**Effort:** 6-8 hours

**Checklist:**
- [ ] Update `src/config.ts`:
  - [ ] Add `orchestrator` section with all limits/timeouts
  - [ ] Add `conversationWindow` section with window settings
  - [ ] Add `models` section with all Claude model IDs
  - [ ] Move magic numbers from files to config
- [ ] Replace hardcoded values:
  - [ ] `src/orchestrator/planner.ts` - use `config.orchestrator.maxReplans`
  - [ ] `src/orchestrator/executor.ts` - use `config.orchestrator.maxToolIterations`
  - [ ] `src/orchestrator/conversation-window.ts` - use `config.conversationWindow.*`
  - [ ] `src/services/anthropic/classification.ts` - use `config.models.classifier`
  - [ ] All other model ID references
- [ ] Update tests to use config values
- [ ] Document all configuration options

**Acceptance Criteria:**
- ✅ All magic numbers in `src/config.ts`
- ✅ All model IDs centralized
- ✅ No hardcoded timeouts/limits in code
- ✅ Configuration documented

**Reference:** See [Issue #22](30-architectural-review.md#issue-22-configuration-scattered) and [Issue #23](30-architectural-review.md#issue-23-hardcoded-model-ids)

---

#### Issue #25: Document Required Environment Variables

**Files:** `src/config.ts`, `README.md`
**Effort:** 2-3 hours

**Checklist:**
- [ ] Update `src/config.ts`:
  - [ ] Create `required()` helper function
  - [ ] Create `optional()` helper function
  - [ ] Create `optionalInt()` helper function
  - [ ] Clearly mark required vs optional variables
- [ ] Update `README.md`:
  - [ ] Add "Required Environment Variables" section
  - [ ] Add "Optional Environment Variables" section
  - [ ] Document defaults for optional vars
- [ ] Update `.env.example` with all variables
- [ ] Test that missing required vars throw clear errors

**Acceptance Criteria:**
- ✅ Config validation functions implemented
- ✅ Clear error messages for missing required vars
- ✅ README documents all environment variables
- ✅ `.env.example` complete

**Reference:** See [Issue #25](30-architectural-review.md#issue-25-unclear-required-vs-optional-config)

---

### Orchestrator Improvements

#### Issue #18: Unified Context Builder

**Files:** `src/orchestrator/context-builder.ts` (new), `executor.ts`, `replanner.ts`, `response-composer.ts`
**Effort:** 4-6 hours

**Checklist:**
- [ ] Create `src/orchestrator/context-builder.ts`:
  - [ ] Implement `ContextBuilder.buildAgentContext()`
  - [ ] Support `includePreviousSteps` option
  - [ ] Support `includeMedia` option
  - [ ] Support `includeMemory` option
  - [ ] Standardize field naming
- [ ] Update `src/orchestrator/executor.ts`:
  - [ ] Use `ContextBuilder.buildAgentContext()`
  - [ ] Remove custom context building
- [ ] Update `src/orchestrator/replanner.ts`:
  - [ ] Use `ContextBuilder.buildAgentContext()`
  - [ ] Remove custom context building
- [ ] Update `src/orchestrator/response-composer.ts`:
  - [ ] Use `ContextBuilder.buildAgentContext()`
  - [ ] Remove custom context building
- [ ] Update tests for new context builder
- [ ] Verify all context fields consistent

**Acceptance Criteria:**
- ✅ Single context builder implementation
- ✅ Consistent field names across all phases
- ✅ All orchestrator phases use context builder
- ✅ Tests updated and passing

**Reference:** See [Issue #18](30-architectural-review.md#issue-18-inconsistent-agent-context-assembly)

---

#### Issue #19: Standardize Step Results Format

**Files:** `src/orchestrator/types.ts`, `executor.ts`, `replanner.ts`
**Effort:** 2-3 hours

**Checklist:**
- [ ] Update `src/orchestrator/types.ts`:
  - [ ] Standardize on `Map<string, StepResult>` format
  - [ ] Remove alternate formats from types
  - [ ] Create helper function `toStepResultMap()`
- [ ] Update `src/orchestrator/executor.ts`:
  - [ ] Convert to standardized format
  - [ ] Use consistent field name
- [ ] Update `src/orchestrator/replanner.ts`:
  - [ ] Convert to standardized format
  - [ ] Use consistent field name
- [ ] Update agent prompts if they reference step results
- [ ] Update tests for new format

**Acceptance Criteria:**
- ✅ Single step result format across codebase
- ✅ Type safety enforced
- ✅ Helper function for conversion
- ✅ Tests updated

**Reference:** See [Issue #19](30-architectural-review.md#issue-19-step-results-format-inconsistency)

---

#### Issue #5: Centralize Replan Logic

**Files:** `src/orchestrator/types.ts`, `orchestrate.ts`
**Effort:** 2-3 hours

**Checklist:**
- [ ] Create `evaluateReplan()` function in `types.ts`:
  - [ ] Check replan count limit
  - [ ] Handle explicit replan signal
  - [ ] Handle empty result signal
  - [ ] Handle step failure signal
  - [ ] Return decision with reason
- [ ] Update `src/orchestrator/orchestrate.ts`:
  - [ ] Replace scattered replan logic
  - [ ] Use `evaluateReplan()` function
  - [ ] Log replan reason
- [ ] Remove duplicate logic from other files
- [ ] Update tests for centralized logic
- [ ] Document replan decision rules

**Acceptance Criteria:**
- ✅ Single replan decision function
- ✅ All replan triggers handled consistently
- ✅ Replan reasons logged
- ✅ Tests cover all replan scenarios

**Reference:** See [Issue #5](30-architectural-review.md#issue-5-replan-signal-detection-scattered)

---

#### Issue #8: Centralize Date Resolution

**Files:** `src/orchestrator/date-resolution.ts` (new), `planner.ts`, `replanner.ts`
**Effort:** 2-3 hours

**Checklist:**
- [ ] Create `src/orchestrator/date-resolution.ts`:
  - [ ] Implement `resolvePlanDates()` function
  - [ ] Apply to all plan steps
- [ ] Update `src/orchestrator/planner.ts`:
  - [ ] Call `resolvePlanDates()` after plan creation
  - [ ] Remove scattered date resolution
  - [ ] Always resolve dates as final step
- [ ] Update `src/orchestrator/replanner.ts`:
  - [ ] Call `resolvePlanDates()` after replan
  - [ ] Ensure consistent date handling
- [ ] Update tests for centralized date resolution
- [ ] Verify dates resolved consistently

**Acceptance Criteria:**
- ✅ Single date resolution function
- ✅ Always applied after plan creation
- ✅ Consistent date handling in replans
- ✅ Tests updated

**Reference:** See [Issue #8](30-architectural-review.md#issue-8-date-resolution-scattered)

---

#### Issue #21: Deduplicate Tool Loop

**Files:** `src/orchestrator/tool-loop.ts` (new), `tool-executor.ts`, `response-composer.ts`
**Effort:** 4-5 hours

**Checklist:**
- [ ] Create `src/orchestrator/tool-loop.ts`:
  - [ ] Implement `executeToolLoop()` function
  - [ ] Handle tool execution
  - [ ] Handle result injection
  - [ ] Support max iterations
  - [ ] Support custom model
- [ ] Update `src/executor/tool-executor.ts`:
  - [ ] Use `executeToolLoop()`
  - [ ] Remove duplicated loop logic
- [ ] Update `src/orchestrator/response-composer.ts`:
  - [ ] Use `executeToolLoop()`
  - [ ] Remove duplicated loop logic
- [ ] Update tests for shared tool loop
- [ ] Verify both usages work correctly

**Acceptance Criteria:**
- ✅ Single tool loop implementation
- ✅ Used by both tool executor and composer
- ✅ All functionality preserved
- ✅ Tests updated

**Reference:** See [Issue #21](30-architectural-review.md#issue-21-response-composer-tool-loop-duplication)

---

#### Issue #20: Fix Tool Filtering Timing

**Files:** `src/executor/tool-executor.ts`
**Effort:** 1-2 hours

**Checklist:**
- [ ] Update `executeWithTools()` function:
  - [ ] Filter tools BEFORE building prompt
  - [ ] Add available tools list to prompt
  - [ ] Update prompt template
- [ ] Test agents see correct tool list
- [ ] Verify tool calls only use available tools

**Acceptance Criteria:**
- ✅ Tools filtered before prompt built
- ✅ Prompt includes available tools list
- ✅ No references to unavailable tools

**Reference:** See [Issue #20](30-architectural-review.md#issue-20-tool-filtering-timing)

---

### Database Improvements

#### Issue #6: Consolidate Database Connections

**Files:** `src/services/database/manager.ts` (new), all `sqlite.ts` files
**Effort:** 3-4 hours

**Checklist:**
- [ ] Create `src/services/database/manager.ts`:
  - [ ] Implement `DatabaseManager` class
  - [ ] Maintain connection map
  - [ ] Implement `getConnection()` method
  - [ ] Implement `closeAll()` method
- [ ] Update all stores to use `dbManager.getConnection()`:
  - [ ] `src/services/credentials/sqlite.ts`
  - [ ] `src/services/user-config/sqlite.ts`
  - [ ] `src/services/scheduler/sqlite.ts`
- [ ] Update `src/index.ts` shutdown:
  - [ ] Call `dbManager.closeAll()`
- [ ] Remove individual `close()` methods from stores
- [ ] Test single connection per database file
- [ ] Monitor connection counts

**Acceptance Criteria:**
- ✅ Single connection per database file
- ✅ All stores use shared connection
- ✅ Centralized connection management
- ✅ All connections closed on shutdown

**Reference:** See [Issue #6](30-architectural-review.md#issue-6-multiple-database-instances-to-same-file)

---

#### Issue #17: Centralized Migration System

**Files:** `src/database/migrations.ts` (new), `src/database/migrations/*.ts`
**Effort:** 8-10 hours

**Checklist:**
- [ ] Create `src/database/migrations.ts`:
  - [ ] Define `Migration` interface
  - [ ] Implement `MigrationRunner` class
  - [ ] Create schema_migrations table
  - [ ] Track applied migrations
- [ ] Create migration files:
  - [ ] `001_initial_schema.ts` - All initial tables
  - [ ] `002_add_memory_fields.ts` - Memory enhancements
  - [ ] Extract existing migrations from stores
- [ ] Update all stores to use migration runner:
  - [ ] Remove PRAGMA-based migrations
  - [ ] Use centralized runner
- [ ] Create migration documentation
- [ ] Ensure each migration is idempotent (safe on repeated startup)
- [ ] Add startup behavior for failed migration state (fail fast and loud)
- [ ] Dry-run migrations in staging before production rollout
- [ ] Test migrations on fresh database
- [ ] Test migrations on existing database

**Acceptance Criteria:**
- ✅ Central migration system implemented
- ✅ All migrations tracked in schema_migrations
- ✅ Stores use migration runner
- ✅ Migrations are idempotent and fail-fast on error
- ✅ Migrations tested on fresh and existing databases

**Reference:** See [Issue #17](30-architectural-review.md#issue-17-schema-migration-duplication)

---

#### Issue #12: Document False Async Pattern

**Files:** All `sqlite.ts` files, interface definitions
**Effort:** 1 hour (document only)

**Checklist:**
- [ ] Add JSDoc comments to all store interfaces:
  - [ ] Document that methods are synchronous despite async signature
  - [ ] Explain reasoning (future-proofing)
  - [ ] Link to better-sqlite3 performance docs
- [ ] Update store implementations with same documentation
- [ ] Add note to ARCHITECTURE.md

**Acceptance Criteria:**
- ✅ All store interfaces documented
- ✅ Async pattern explained
- ✅ Future path documented

**Reference:** See [Issue #12](30-architectural-review.md#issue-12-false-async-methods)

---

### Database Reorganization (Optional)

#### Issue #14: Split credentials.db

**Files:** Multiple database files, migration scripts
**Effort:** 6-10 hours (with migration)

**Checklist:**
- [ ] Phase 1: Create `scheduler.db`:
  - [ ] Create new database file
  - [ ] Create `scheduled_jobs` table in scheduler.db
  - [ ] Migrate data from credentials.db
  - [ ] Update scheduler service to use new database
  - [ ] Drop table from credentials.db
- [ ] Phase 2 (optional): Create `email.db`:
  - [ ] Create new database file
  - [ ] Create email_skills and email_watcher_state tables
  - [ ] Migrate data
  - [ ] Update email watcher service
  - [ ] Drop tables from credentials.db
- [ ] Validate migration behavior in staging with realistic data volume
- [ ] Update deployment documentation
- [ ] Test data migration

**Acceptance Criteria:**
- ✅ Scheduler data in separate database
- ✅ Optional: Email data in separate database
- ✅ credentials.db only contains auth tokens and user config
- ✅ Data migration successful
- ✅ All services functional

**Reference:** See [Issue #14](30-architectural-review.md#issue-14-overloaded-credentialsdb)

---

#### Issue #16: Remove User Config Duplication

**Files:** `src/services/email-watcher/sqlite.ts`, migration script
**Effort:** 2-3 hours

**Checklist:**
- [ ] Update email watcher service:
  - [ ] Remove `user_config_json` field from state
  - [ ] Query `getUserConfigStore()` when needed
  - [ ] Remove JSON serialization/deserialization
- [ ] Create migration to drop column:
  - [ ] Create migration file
  - [ ] Drop `user_config_json` column (requires table recreation in SQLite)
- [ ] Validate migration behavior in staging before production rollout
- [ ] Test email watcher still functions
- [ ] Verify no performance degradation

**Acceptance Criteria:**
- ✅ No duplicated user config in email_watcher_state
- ✅ Email watcher queries user_config table
- ✅ Migration successful
- ✅ Email watcher functional

**Reference:** See [Issue #16](30-architectural-review.md#issue-16-data-duplication-user-config)

---

### Code Quality

#### Issue #27: Standardize Phone Number Normalization

**Files:** `src/utils/phone.ts` (new), multiple files
**Effort:** 2-3 hours

**Checklist:**
- [ ] Create `src/utils/phone.ts`:
  - [ ] Implement `PhoneUtils.normalize()`
  - [ ] Implement `PhoneUtils.getChannel()`
  - [ ] Add unit tests
- [ ] Replace all phone normalization logic:
  - [ ] `src/routes/sms.ts`
  - [ ] `src/services/conversation/*`
  - [ ] `src/services/credentials/*`
  - [ ] Find and replace other instances
- [ ] Update tests to use PhoneUtils
- [ ] Verify consistent normalization

**Acceptance Criteria:**
- ✅ Single phone normalization utility
- ✅ All code uses PhoneUtils
- ✅ Consistent E.164 format
- ✅ Tests passing

**Reference:** See [Issue #27](30-architectural-review.md#issue-27-phone-number-normalization-duplication)

---

#### Issue #24: Prompt Management System

**Files:** `src/prompts/builder.ts` (new), `src/agents/*/prompt.ts`
**Effort:** 6-8 hours

**Checklist:**
- [ ] Create `src/prompts/builder.ts`:
  - [ ] Implement `PromptBuilder` class
  - [ ] Add `addSection()` method
  - [ ] Add `addList()` method
  - [ ] Add `addUserContext()` method
  - [ ] Add `build()` method
- [ ] Update agent prompts:
  - [ ] Convert calendar-agent prompt to builder
  - [ ] Convert scheduler-agent prompt to builder
  - [ ] Convert other agent prompts
- [ ] Update classification prompt to use builder
- [ ] Standardize prompt structure across agents
- [ ] Update tests for new prompt format

**Acceptance Criteria:**
- ✅ Unified prompt builder implemented
- ✅ All agent prompts use builder
- ✅ Consistent prompt structure
- ✅ Tests updated

**Reference:** See [Issue #24](30-architectural-review.md#issue-24-prompt-management-inconsistency)

---

#### Issue #26: Remove Unused Code

**Files:** `src/services/ui/providers/`
**Effort:** 1-2 hours

**Checklist:**
- [ ] Decide on approach:
  - [ ] Option 1: Remove S3 provider and abstraction
  - [ ] Option 2: Implement S3 provider (if needed)
- [ ] If removing:
  - [ ] Delete `s3-storage.ts`
  - [ ] Delete `memory-shortener.ts` (test-only)
  - [ ] Simplify to single implementation
  - [ ] Remove provider interface
  - [ ] Update UI service to use direct implementation
- [ ] Update tests
- [ ] Remove unused dependencies

**Acceptance Criteria:**
- ✅ No dead code in UI providers
- ✅ Single storage implementation
- ✅ Tests updated
- ✅ Dependencies cleaned up

**Reference:** See [Issue #26](30-architectural-review.md#issue-26-unused-storage-provider-abstraction)

---

## Progress Tracking

### Phase 0: Baseline Reconciliation
- [ ] Audit all 25 issues against current codebase
- [ ] Mark each issue as Not Started / Partial / Completed
- [ ] Re-estimate remaining effort and update phase ordering
- **Phase 0 Total:** 0/1 complete (0%)

### Phase 1: Critical Fixes
- [ ] Issue #1: Connection leaks (2-4 hours) 🔴
- [ ] Issue #2: Scheduler cleanup (2-3 hours)
- **Phase 1 Total:** 0/2 complete (0%)

### Phase 2: Reliability
- [ ] Issue #3: Promise rejection (1-2 hours)
- [ ] Issue #13: Retry logic (2-3 hours)
- [ ] Issue #4: Timeout enforcement (4-6 hours)
- **Phase 2 Total:** 0/3 complete (0%)

### Phase 3: Performance & Observability
- [ ] Issue #11: Simplify planning (2-4 hours)
- [ ] Issue #7: Error handling (8-12 hours)
- [ ] Issue #15: Logging (12-16 hours)
- **Phase 3 Total:** 0/3 complete (0%)

### Phase 4: Technical Debt
- [ ] Issue #22/#23: Configuration (6-8 hours)
- [ ] Issue #25: Env var docs (2-3 hours)
- [ ] Issue #18: Context builder (4-6 hours)
- [ ] Issue #19: Step results format (2-3 hours)
- [ ] Issue #5: Replan logic (2-3 hours)
- [ ] Issue #8: Date resolution (2-3 hours)
- [ ] Issue #21: Tool loop (4-5 hours)
- [ ] Issue #20: Tool filtering (1-2 hours)
- [ ] Issue #6: DB connections (3-4 hours)
- [ ] Issue #17: Migrations (8-10 hours)
- [ ] Issue #12: Document async (1 hour)
- [ ] Issue #14: Split databases (6-10 hours) - Optional
- [ ] Issue #16: Remove duplication (2-3 hours)
- [ ] Issue #27: Phone utils (2-3 hours)
- [ ] Issue #24: Prompt builder (6-8 hours)
- [ ] Issue #26: Remove unused code (1-2 hours)
- **Phase 4 Total:** 0/16 complete (0%)

---

## Overall Progress

**Total Completion:** TBD after Phase 0 baseline reconciliation

- ⬜ Phase 0: Not started
- ⬜ Phase 1: Not started
- ⬜ Phase 2: Not started
- ⬜ Phase 3: Not started
- ⬜ Phase 4: Not started

---

## Testing Strategy

### Definition of Done (Every Issue)
Before marking any issue complete:
1. ✅ `npm run test:unit`
2. ✅ `npm run test:integration`
3. ✅ `npm run lint`
4. ✅ `npm run build`
5. ✅ Manual testing for changed behavior
6. ✅ Acceptance criteria checklist fully met
7. ✅ Check whether `ARCHITECTURE.md` needs updating and update if needed

### Per-Issue Testing
Each issue includes specific acceptance criteria. Before marking complete:
1. ✅ Unit tests pass
2. ✅ Integration tests pass
3. ✅ Manual testing completed
4. ✅ Acceptance criteria met

### Phase Testing
After completing each phase:
1. Run quality gates: `npm run test:unit && npm run test:integration && npm run lint && npm run build`
2. Manual smoke testing of critical paths
3. Deploy to staging environment
4. Monitor for errors/regressions
5. Get sign-off before next phase

### Production Deployment
After Phase 1 (Critical Fixes):
1. Fix connection leaks immediately
2. Add scheduler database cleanup
3. Monitor resource usage
4. Verify no new errors

After Phase 2 (Reliability):
1. Monitor API retry attempts and failures
2. Verify error notifications working
3. Check timeout enforcement is working correctly

---

## Notes

- **Flexibility:** Issues within Phase 4 can be reordered based on priorities
- **Incremental:** Phase 4 items can be tackled alongside feature work
- **Documentation:** Update ARCHITECTURE.md as major changes are implemented
- **Review:** Code review required for all critical and high-priority issues
- **Monitoring:** Set up alerts for new error patterns after each phase

---

**End of Implementation Plan**
