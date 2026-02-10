# Architectural Review: Hermes Assistant

**Date:** February 7, 2026
**Commit:** e7b820f
**Review Type:** Static Code Analysis
**Purpose:** Diagnostic assessment with recommended solutions

---

## Executive Summary

This document presents findings from a comprehensive architectural review of the Hermes Assistant codebase, organized by **risk category** with recommended solutions for each issue.

### Overview

**Project Scope:**
- Multi-agent SMS/WhatsApp personal assistant
- 7 specialized agents (calendar, scheduler, email, memory, drive, ui, general)
- Two-phase SMS pattern (sync classifier + async orchestrator)
- Three SQLite databases (credentials, conversation, memory)
- Background processors for scheduling, memory extraction, email watching
- Deployed on Railway with persistent volumes

**Total Issues Identified:** 25 (2 issues removed from implementation scope)

### Issues by Risk Category

| Risk Category | Count | Primary Impact |
|---------------|-------|----------------|
| **Bug/Reliability** | 8 | Runtime failures, data corruption, resource leaks |
| **Security** | 1 | Data exposure (admin auth deferred) |
| **Performance** | 5 | Latency, blocking, resource inefficiency |
| **Maintainability** | 11 | Technical debt, inconsistency, complexity |

**Note:** Issues #9 (Admin Authentication) and #10 (Rate Limiting) identified but removed from implementation plan. These are not priorities for a personal assistant use case.

---

## Table of Contents

1. [Bug/Reliability Issues](#i-bugreliability-issues)
2. [Security Issues](#ii-security-issues)
3. [Performance Issues](#iii-performance-issues)
4. [Maintainability Issues](#iv-maintainability-issues)
5. [File Reference Index](#v-file-reference-index)

---

## I. Bug/Reliability Issues

### **Issue #1: Database Connection Leak in Admin Routes** 🔴 CRITICAL

**Risk:** High - Resource exhaustion, production crashes

**Location:** `src/admin/email-skills.ts:19`, `src/admin/memory.ts`

**Problem:**
```typescript
const db = new Database(config.credentials.sqlitePath);
// ... route handler logic ...
// NO db.close() anywhere
```

**Scope:** All 8 admin route handlers

**Impact:**
- Resource leak - each API call creates unclosed connection
- Memory accumulation until process restart
- File handle exhaustion on high traffic
- Production instability

**Recommended Solution:**

**Option 1: Use Existing Singleton Store (Preferred)**
```typescript
// Before (current - BROKEN)
router.get('/admin/email-skills', async (req, res) => {
  const db = new Database(config.credentials.sqlitePath);
  const skills = db.prepare('SELECT * FROM email_skills').all();
  // db never closed
});

// After (fixed)
import { getEmailSkillStore } from '../services/email-watcher/sqlite';

router.get('/admin/email-skills', async (req, res) => {
  const store = getEmailSkillStore();
  const skills = await store.listSkills(phoneNumber);
  // Store manages connection lifecycle
});
```

**Option 2: Add try-finally Block (Less preferred)**
```typescript
router.get('/admin/email-skills', async (req, res) => {
  const db = new Database(config.credentials.sqlitePath);
  try {
    const skills = db.prepare('SELECT * FROM email_skills').all();
    res.json(skills);
  } finally {
    db.close(); // Ensure cleanup
  }
});
```

**Effort:** Low (2-4 hours)
**Priority:** Immediate - fix before next deployment

---

### **Issue #2: Scheduler Database Missing Cleanup**

**Risk:** Medium - Data corruption on shutdown, resource leak

**Location:** `src/services/scheduler/sqlite.ts`, `src/index.ts:56`

**Problem:**
- Scheduler DB connection opened but never closed
- Shutdown handler doesn't close scheduler database
- In-flight jobs during shutdown may corrupt data

**Impact:**
- Long-lived connection ties up resources
- Graceful shutdown not truly graceful
- Risk of data corruption if job execution races shutdown

**Recommended Solution:**

```typescript
// src/services/scheduler/sqlite.ts
export class SchedulerStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
  }

  // ADD THIS METHOD
  close(): void {
    this.db.close();
  }
}

// src/index.ts shutdown handler
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');

  // Stop background pollers FIRST
  await schedulerPoller.stop();
  await memoryProcessor.stop();
  await emailWatcher.stop();

  // THEN close database connections
  conversationStore.close();
  memoryStore.close();
  credentialStore.close();
  schedulerStore.close(); // ADD THIS

  process.exit(0);
});
```

**Additional:** Update background pollers to stop gracefully:
```typescript
// Modify poller to track in-flight operations
export function createIntervalPoller(fn: () => Promise<void>, interval: number) {
  let running = false;
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    running = true;
    await fn();
    running = false;
    if (!stopped) setTimeout(poll, interval);
  };

  return {
    start: () => poll(),
    stop: async () => {
      stopped = true;
      // Wait for current operation to complete
      while (running) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  };
}
```

**Effort:** Low (2-3 hours)
**Priority:** High - prevent data corruption

---

### **Issue #3: Promise Rejection Handling**

**Risk:** Medium - Unhandled rejections, silent failures

**Location:** `src/orchestrator/handler.ts:120`, background processors

**Problem:**
```typescript
// Fire-and-forget async orchestration
orchestrate(context).catch(error => {
  console.error('Orchestration failed:', error);
  // Error logged but user never notified
});
```

**Impact:**
- User sees immediate "working on it" but never gets actual response
- Silent failures - no notification that orchestration failed
- No retry mechanism

**Recommended Solution:**

```typescript
// After fire-and-forget, add SMS notification on error
orchestrate(context).catch(async (error) => {
  console.error('Orchestration failed:', error);

  // Notify user of failure
  try {
    await twilioClient.messages.create({
      to: phoneNumber,
      from: config.twilio.phoneNumber,
      body: "Sorry, I encountered an error processing your request. Please try again."
    });
  } catch (notifyError) {
    console.error('Failed to notify user of error:', notifyError);
  }

  // Optionally: Send to error tracking service (Sentry, etc.)
  // reportError(error, { phoneNumber, userMessage });
});
```

**For Background Processors:**
```typescript
// src/services/memory/processor.ts
export function startMemoryProcessor() {
  const poller = createIntervalPoller(async () => {
    try {
      await processUnprocessedMessages();
    } catch (error) {
      console.error('Memory processor failed:', error);
      // Don't throw - continue on next interval
      // Optionally: reportError(error, { context: 'memory-processor' });
    }
  }, config.memoryProcessor.intervalMs);

  poller.start();
  return poller;
}
```

**Effort:** Low (1-2 hours)
**Priority:** High - improve reliability

---

### **Issue #4: Inconsistent Timeout Enforcement**

**Risk:** Medium - Resource exhaustion, hung operations

**Location:** `orchestrator/types.ts:15`, `orchestrate.ts`, `tool-executor.ts`

**Problem:**
- Orchestrator timeout defined but not enforced everywhere
- Step timeout can be exceeded by tool loops
- Long-running tools can hang indefinitely

**Impact:**
- Hung operations tie up resources
- User waits indefinitely
- Unpredictable timeout behavior

**Recommended Solution:**

```typescript
// Add timeout wrapper utility
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

// Apply in orchestrator
export async function orchestrate(context: OrchestrationContext): Promise<void> {
  try {
    await withTimeout(
      orchestrateInternal(context),
      ORCHESTRATOR_LIMITS.MAX_EXECUTION_TIME_MS,
      'Orchestration timed out after 5 minutes'
    );
  } catch (error) {
    // Handle timeout error
    await notifyUserOfError(context.phoneNumber, 'Request took too long');
  }
}

// Apply in tool executor
async function executeWithTools(...): Promise<StepResult> {
  return withTimeout(
    executeToolsInternal(...),
    ORCHESTRATOR_LIMITS.STEP_TIMEOUT_MS,
    'Step execution timed out after 2 minutes'
  );
}

// Apply to individual tool calls
async function executeTool(tool: Tool, args: any): Promise<any> {
  const TOOL_TIMEOUT_MS = 60000; // 1 minute per tool
  return withTimeout(
    tool.handler(args),
    TOOL_TIMEOUT_MS,
    `Tool ${tool.name} timed out`
  );
}
```

**Effort:** Medium (4-6 hours)
**Priority:** Medium - improve reliability

---

### **Issue #5: Replan Signal Detection Scattered**

**Risk:** Low - Unpredictable replanning behavior

**Location:** `executor.ts`, `orchestrate.ts`, `replanner.ts`

**Problem:**
- Multiple decision points for replanning:
  - `output.needsReplan === true`
  - `output.isEmpty === true`
  - Step failure + remaining steps
  - Timeout (no replan)
- Logic split across 3 files

**Impact:**
- Unclear when replanning actually happens
- Testing difficulty
- Maintenance risk

**Recommended Solution:**

```typescript
// Centralize in orchestrator/types.ts
export interface ReplanDecision {
  shouldReplan: boolean;
  reason: 'explicit' | 'empty_result' | 'step_failure' | 'timeout' | 'none';
}

export function evaluateReplan(
  stepResult: StepResult,
  stepIndex: number,
  totalSteps: number,
  replanCount: number
): ReplanDecision {
  // Check limits first
  if (replanCount >= ORCHESTRATOR_LIMITS.MAX_REPLANS) {
    return { shouldReplan: false, reason: 'none' };
  }

  // Explicit signal from agent
  if (stepResult.output?.needsReplan === true) {
    return { shouldReplan: true, reason: 'explicit' };
  }

  // Empty result with more steps ahead
  if (stepResult.output?.isEmpty === true && stepIndex < totalSteps - 1) {
    return { shouldReplan: true, reason: 'empty_result' };
  }

  // Step failure with remaining steps
  if (!stepResult.success && stepIndex < totalSteps - 1) {
    return { shouldReplan: true, reason: 'step_failure' };
  }

  return { shouldReplan: false, reason: 'none' };
}

// Use consistently in orchestrator
const replanDecision = evaluateReplan(result, currentStep, plan.steps.length, replanCount);
if (replanDecision.shouldReplan) {
  console.log(`Replanning due to: ${replanDecision.reason}`);
  plan = await replanner.replan(context, plan, currentStep);
  replanCount++;
}
```

**Effort:** Low (2-3 hours)
**Priority:** Low - improve maintainability

---

### **Issue #6: Multiple Database Instances to Same File**

**Risk:** Low - Lock contention, inefficiency

**Location:** `src/services/credentials/sqlite.ts`, `src/services/user-config/sqlite.ts`

**Problem:**
- `credentials.db` opened by 2-3 separate `Database` instances
- Each store creates its own connection
- Inefficient, potential lock contention

**Impact:**
- Multiple connections to same file
- Lock overhead
- Unclear which instance owns migrations

**Recommended Solution:**

```typescript
// Create shared database connection manager
// src/services/database/manager.ts
import Database from 'better-sqlite3';

class DatabaseManager {
  private connections: Map<string, Database.Database> = new Map();

  getConnection(path: string): Database.Database {
    if (!this.connections.has(path)) {
      this.connections.set(path, new Database(path));
    }
    return this.connections.get(path)!;
  }

  closeAll(): void {
    for (const db of this.connections.values()) {
      db.close();
    }
    this.connections.clear();
  }
}

export const dbManager = new DatabaseManager();

// Update stores to use shared connection
// src/services/credentials/sqlite.ts
export class SqliteCredentialStore implements CredentialStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = dbManager.getConnection(dbPath); // Shared connection
    this.initialize();
  }

  // Remove close() method - managed centrally
}

// src/index.ts shutdown
process.on('SIGTERM', () => {
  dbManager.closeAll();
});
```

**Effort:** Medium (3-4 hours)
**Priority:** Low - optimization

---

### **Issue #7: Inconsistent Try-Catch Patterns**

**Risk:** Low - Unpredictable error behavior

**Location:** 175 try-catch blocks across 42 files

**Problem:**
- 4 different error handling patterns observed
- Some catch-log-rethrow, some catch-return-null
- Some silent failures

**Impact:**
- Inconsistent error propagation
- Debugging difficulty
- Unclear which errors are recoverable

**Recommended Solution:**

```typescript
// Create standardized error handling utilities
// src/utils/error-handling.ts

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = false,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// For operations that should propagate errors
export async function withErrorPropagation<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`Error in ${context}:`, error);
    throw error; // Propagate
  }
}

// For operations that should return null on error
export async function withNullOnError<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error(`Error in ${context}:`, error);
    return null; // Graceful degradation
  }
}

// For operations that should return result object
export async function withResultObject<T>(
  fn: () => Promise<T>,
  context: string
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    console.error(`Error in ${context}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Usage examples:
// In orchestrator (propagate)
const plan = await withErrorPropagation(
  () => planner.createPlan(context),
  'planner.createPlan'
);

// In admin routes (null on error)
const skills = await withNullOnError(
  () => skillStore.listSkills(phoneNumber),
  'listSkills'
);

// In services (result object)
const result = await withResultObject(
  () => googleCalendar.createEvent(event),
  'calendar.createEvent'
);
```

**Effort:** High (8-12 hours to standardize across codebase)
**Priority:** Medium - improve consistency

---

### **Issue #8: Date Resolution Scattered**

**Risk:** Low - Inconsistent date handling

**Location:** `planner.ts:374-420`, `planner.ts:138-140`

**Problem:**
- Date resolution happens in multiple places
- Fallback plan may not resolve dates consistently
- Same resolution logic runs multiple times during replanning

**Impact:**
- "Friday" may resolve differently in initial vs. replan
- Duplication of date resolution work

**Recommended Solution:**

```typescript
// Centralize date resolution
// src/orchestrator/date-resolution.ts
export async function resolvePlanDates(
  plan: ExecutionPlan,
  context: PlanContext
): Promise<ExecutionPlan> {
  const resolvedSteps = await Promise.all(
    plan.steps.map(async (step) => ({
      ...step,
      task: await resolveTaskDates(step.task, context)
    }))
  );

  return { ...plan, steps: resolvedSteps };
}

// In planner.ts - always resolve after plan creation
export async function createPlan(context: PlanContext): Promise<ExecutionPlan> {
  let plan: ExecutionPlan;

  // Try LLM planning
  plan = await attemptLLMPlanning(context);

  if (!plan) {
    // Fallback to general-agent
    plan = createGeneralFallbackPlan(context);
  }

  // ALWAYS resolve dates as final step
  return resolvePlanDates(plan, context);
}

// In replanner.ts
export async function replan(
  context: ReplanContext,
  previousPlan: ExecutionPlan
): Promise<ExecutionPlan> {
  const newPlan = await createRevisedPlan(context, previousPlan);

  // ALWAYS resolve dates
  return resolvePlanDates(newPlan, context);
}
```

**Effort:** Low (2-3 hours)
**Priority:** Low - consistency improvement

---

## II. Security Issues

### **Issue #9: Admin Routes Lack Authentication** ⚠️ DEFERRED

**Status:** Identified but not in implementation plan

**Reason:** Not a priority for personal assistant use case. Admin interface is for local/trusted use only. Can be addressed later if deployment model changes.

---

### **Issue #10: No Rate Limiting on Webhooks** ⚠️ DEFERRED

**Status:** Identified but not in implementation plan

**Reason:** Not needed for personal assistant use case (single user, low traffic). Twilio already provides webhook validation. Can be added if abuse becomes an issue.

---

## III. Performance Issues

### **Issue #11: Triple Fallback Cascade in Planning**

**Risk:** Medium - Latency, cost

**Location:** `src/orchestrator/planner.ts`

**Problem:**
```
1. Initial LLM call → Parse JSON
2. If parse fails → Repair LLM call
3. If repair fails → Fallback to general-agent
```

**Impact:**
- Up to 2 LLM calls before execution (adds 2-5 seconds)
- Extra cost for every parse failure
- Poor UX when plan generation fails

**Recommended Solution: Option 3 (Structured Output)** ✅

Use Claude's `response_format` parameter to enforce valid JSON at the API level:

```typescript
// Define JSON schema for plan response
const planSchema = {
  type: "object",
  properties: {
    analysis: { type: "string" },
    goal: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          agent: { type: "string" },
          task: { type: "string" }
        },
        required: ["id", "agent", "task"]
      }
    }
  },
  required: ["analysis", "goal", "steps"]
};

// Update API call to use structured output
const response = await anthropic.messages.create({
  model: 'claude-opus-4-5-20251101',
  messages: [...],
  response_format: {
    type: 'json_object',
    schema: planSchema
  }
});

// No parsing errors possible - always valid JSON
const plan = JSON.parse(response.content[0].text);
// Remove all parsing and repair logic (30-40 lines deleted)
```

**Why Option 3:**
- Eliminates parsing errors entirely (enforced by API)
- Removes repair step completely (saves 2-5 seconds)
- Simplifies code (removes 30-40 lines)
- Structured JSON logged to dev log files automatically
- SDK v0.71.2 supports this feature

**Alternative Options (Not Recommended):**
- Option 1: Remove repair step - simpler but still has parse failures
- Option 2: Conditional repair - still adds complexity

**Effort:** Low-Medium (3-5 hours including schema definition and logging)
**Priority:** Medium - reduce latency

---

### **Issue #12: False Async Methods**

**Risk:** Low - Event loop blocking

**Location:** All SQLite stores

**Problem:**
- Methods marked `async` but perform synchronous operations
- Can block event loop when processing large batches

**Impact:**
- Memory processor blocks when processing 100 messages
- No concurrency benefit
- Misleading API contract

**Recommended Solution:**

**Option 1: Remove Async (Breaking Change)**
```typescript
// Change interface to synchronous
export interface CredentialStore {
  get(phone: string, provider: string): Credential | null; // Remove async
  save(credential: Credential): void; // Remove async
  // ...
}

// Update all callers to remove await
const cred = store.get(phone, 'google'); // No await
```

**Option 2: Make Truly Async with Worker Threads**
```typescript
// Use better-sqlite3 worker wrapper
import { Worker } from 'worker_threads';
import { parentPort } from 'worker_threads';

// worker.ts
if (parentPort) {
  const db = new Database(dbPath);

  parentPort.on('message', ({ id, method, args }) => {
    try {
      const result = db[method](...args);
      parentPort.postMessage({ id, result });
    } catch (error) {
      parentPort.postMessage({ id, error: error.message });
    }
  });
}

// Async wrapper
export class AsyncSqliteStore {
  private worker: Worker;

  async get(...args): Promise<any> {
    return this.execute('get', args);
  }

  private execute(method: string, args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = Math.random();
      this.worker.postMessage({ id, method, args });

      const handler = (msg) => {
        if (msg.id === id) {
          this.worker.off('message', handler);
          msg.error ? reject(msg.error) : resolve(msg.result);
        }
      };

      this.worker.on('message', handler);
    });
  }
}
```

**Option 3: Keep As-Is with Documentation (Pragmatic)**
```typescript
// Document the behavior clearly
/**
 * Credential store interface.
 *
 * NOTE: Despite being async, the current SQLite implementation performs
 * synchronous operations. Methods are marked async to allow for future
 * async implementations without breaking API compatibility.
 *
 * @see https://github.com/WiseLibs/better-sqlite3/wiki/Performance
 */
export interface CredentialStore {
  get(phone: string, provider: string): Promise<Credential | null>;
  // ...
}
```

**Effort:** Low (Option 3), High (Options 1-2)
**Priority:** Low - document for now, async worker for future

---

### **Issue #13: Add Retry Logic for External APIs**

**Risk:** Medium - Transient API failures cause permanent errors

**Location:** All `src/services/google/*.ts`

**Problem:**
- Direct API calls with no retry logic
- Transient errors (network blips, temporary 5xx) propagate immediately to user
- No backoff for temporary failures

**Impact:**
- Poor UX during temporary API issues (network hiccups, service restarts)
- Failures that could succeed on retry immediately fail

**Recommended Solution: Simple Retry with Exponential Backoff** ✅

For a personal assistant use case, simple retry logic is sufficient (circuit breakers add unnecessary complexity):

```typescript
// src/utils/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, initialDelay = 1000, maxDelay = 10000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Don't retry on permanent errors (4xx, auth failures)
      if (isPermanentError(error)) {
        throw error;
      }

      // Last attempt - throw error
      if (attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff with cap
      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Retrying after error',
        attempt: attempt + 1,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      }));

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Retry logic error'); // Should never reach
}

function isPermanentError(error: any): boolean {
  // Don't retry on auth errors, 4xx errors, etc.
  const statusCode = error?.response?.status || error?.statusCode;
  return statusCode >= 400 && statusCode < 500;
}

// Apply to Google services
// src/services/google/calendar.ts
import { withRetry } from '../../utils/retry.js';

export async function listEvents(auth: any, timeMin: string, timeMax: string) {
  return withRetry(async () => {
    const response = await calendar.events.list({
      auth,
      calendarId: 'primary',
      timeMin,
      timeMax,
    });
    return response.data.items || [];
  });
}
```

**Why Simple Retry (Not Circuit Breakers):**
- Personal assistant = single user, low traffic
- Circuit breakers add complexity (state management, threshold tuning)
- Exponential backoff already prevents hammering failing services
- Retry logic is sufficient for transient failures

**Effort:** Low (2-3 hours)
**Priority:** High - improve resilience

---

### **Issue #14: Overloaded credentials.db**

**Risk:** Low - Single point of failure

**Location:** `credentials.db`

**Problem:**
- 5 tables in single database: credentials, scheduled_jobs, user_config, email_skills, email_watcher_state
- Mixing encrypted tokens with plaintext config
- Single point of failure

**Impact:**
- Can't selectively backup sensitive data
- Unclear responsibility boundaries
- All data requires same encryption key

**Recommended Solution:**

**Phase 1: Extract Scheduler Database**
```typescript
// Create separate scheduler.db
// src/services/scheduler/sqlite.ts
const SCHEDULER_DB_PATH = config.scheduler.sqlitePath || './data/scheduler.db';

// Move scheduled_jobs table to scheduler.db
// Migration: Copy data, then drop from credentials.db
```

**Phase 2: Separate User Config**
```typescript
// Keep user_config in credentials.db (config is user-specific)
// OR move to separate config.db if it grows

// Decision tree:
// - credentials.db: OAuth tokens (encrypted)
// - config.db: User preferences, settings (plaintext)
// - scheduler.db: Scheduled jobs (plaintext)
// - email.db: Email skills and watcher state (plaintext)
```

**Effort:** Medium (6-10 hours with migration)
**Priority:** Low - technical debt

---

### **Issue #15: Logging System Duplication**

**Risk:** Low - Observability gaps

**Location:** Console, trace-logger, orchestrator logging

**Problem:**
- 3 parallel logging systems
- Inconsistent formats
- Hard to correlate operations

**Impact:**
- Debugging difficulty
- No unified observability

**Recommended Solution:**

```typescript
// Standardize on structured logging
// npm install pino

// src/utils/logger.ts
import pino from 'pino';

export const logger = pino({
  level: config.logLevel || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(process.env.NODE_ENV === 'production' && {
    // Production: JSON logs for aggregation
    transport: undefined
  }),
  ...(process.env.NODE_ENV !== 'production' && {
    // Development: Pretty logs
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname'
      }
    }
  })
});

// Create child loggers with context
export function createLogger(context: Record<string, any>) {
  return logger.child(context);
}

// Usage
const log = createLogger({ requestId, phoneNumber, agent: 'calendar' });
log.info({ event: 'plan_created', steps: plan.steps.length }, 'Plan created');
log.error({ error, step: 'execution' }, 'Step execution failed');

// Replace all console.log/error/warn calls
// Before: console.log('Plan created:', plan);
// After: log.info({ plan }, 'Plan created');
```

**Effort:** High (12-16 hours to replace across codebase)
**Priority:** Medium - improve observability

---

### **Issue #16: Data Duplication (User Config)**

**Risk:** Low - Desynchronization

**Location:** `user_config` table vs `email_watcher_state.user_config_json`

**Problem:**
- User config stored in two places
- Potential desynchronization

**Impact:**
- Two sources of truth
- Update burden

**Recommended Solution:**

```typescript
// Remove user_config_json from email_watcher_state
// Always query user_config table when needed

// Before (current)
export class EmailWatcherState {
  user_config_json: string; // Duplicated
}

// After (fixed)
export class EmailWatcherService {
  async processNewEmails(phoneNumber: string) {
    // Fetch user config on-demand
    const userConfig = await getUserConfigStore().get(phoneNumber);

    if (!userConfig?.emailWatcherEnabled) {
      return; // Skip if disabled
    }

    // Use fresh config
    const timezone = userConfig.timezone;
    // ...
  }
}

// Migration
ALTER TABLE email_watcher_state DROP COLUMN user_config_json;
```

**Effort:** Low (2-3 hours)
**Priority:** Low - cleanup

---

## IV. Maintainability Issues

### **Issue #17: Schema Migration Duplication**

**Risk:** Low - Maintenance burden

**Location:** Each store has its own migration logic

**Problem:**
- PRAGMA-based column detection repeated in 3+ files
- No centralized migration system
- No version tracking

**Impact:**
- Error-prone
- Hard to coordinate changes

**Recommended Solution:**

```typescript
// Create centralized migration system
// src/database/migrations.ts
export interface Migration {
  id: number;
  name: string;
  up: (db: Database) => void;
  down?: (db: Database) => void;
}

export class MigrationRunner {
  constructor(private db: Database) {
    this.initMigrationTable();
  }

  private initMigrationTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
  }

  async run(migrations: Migration[]) {
    const applied = new Set(
      this.db.prepare('SELECT id FROM schema_migrations').all()
        .map((row: any) => row.id)
    );

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;

      console.log(`Running migration ${migration.id}: ${migration.name}`);
      migration.up(this.db);

      this.db.prepare(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)'
      ).run(migration.id, migration.name, Date.now());
    }
  }
}

// Define migrations
// src/database/migrations/001_initial_schema.ts
export const migration_001: Migration = {
  id: 1,
  name: 'initial_schema',
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        phone_number TEXT,
        provider TEXT,
        encrypted_data BLOB,
        iv BLOB,
        auth_tag BLOB,
        created_at INTEGER,
        updated_at INTEGER,
        PRIMARY KEY (phone_number, provider)
      )
    `);
  }
};

// src/database/migrations/002_add_memory_fields.ts
export const migration_002: Migration = {
  id: 2,
  name: 'add_memory_reinforcement',
  up: (db) => {
    db.exec(`
      ALTER TABLE user_facts ADD COLUMN last_reinforced_at INTEGER;
      ALTER TABLE user_facts ADD COLUMN reinforcement_count INTEGER DEFAULT 0;
    `);
  },
  down: (db) => {
    // Note: SQLite doesn't support DROP COLUMN easily
    // Would need to recreate table
  }
};

// Use in stores
const migrations = [migration_001, migration_002, migration_003];
const runner = new MigrationRunner(db);
await runner.run(migrations);
```

**Effort:** Medium (8-10 hours)
**Priority:** Low - technical debt

---

### **Issue #18: Inconsistent Agent Context Assembly**

**Risk:** Low - Fragile contract

**Location:** `executor.ts`, `replanner.ts`, `response-composer.ts`

**Problem:**
- Each phase builds agent context differently
- Field names vary
- Memory injection inconsistent

**Impact:**
- Testing complexity
- Maintenance risk

**Recommended Solution:**

```typescript
// Create unified context builder
// src/orchestrator/context-builder.ts
export class ContextBuilder {
  static async buildAgentContext(
    base: BaseContext,
    options: {
      includePreviousSteps?: boolean;
      includeMedia?: boolean;
      includeMemory?: boolean;
    } = {}
  ): Promise<AgentExecutionContext> {
    const context: AgentExecutionContext = {
      phoneNumber: base.phoneNumber,
      channel: base.channel,
      userConfig: base.userConfig,
      conversationHistory: base.conversationHistory,
      currentTime: new Date().toISOString(),
    };

    // Previous steps (consistent naming)
    if (options.includePreviousSteps && base.stepResults) {
      context.previousStepResults = base.stepResults; // Always use this name
    }

    // Media context
    if (options.includeMedia && base.storedMedia) {
      context.mediaContext = await formatMediaContext(base.storedMedia);
    }

    // Memory injection
    if (options.includeMemory) {
      const facts = await memoryStore.getUserFacts(
        base.phoneNumber,
        config.memoryInjectionThreshold
      );
      context.userFacts = facts;
    }

    return context;
  }
}

// Use consistently everywhere
// In executor
const context = await ContextBuilder.buildAgentContext(baseContext, {
  includePreviousSteps: true,
  includeMedia: true,
  includeMemory: true,
});

// In replanner
const context = await ContextBuilder.buildAgentContext(baseContext, {
  includePreviousSteps: true,
  includeMemory: false, // Replanner doesn't need memory
});

// In response composer
const context = await ContextBuilder.buildAgentContext(baseContext, {
  includePreviousSteps: true,
  includeMedia: false,
});
```

**Effort:** Medium (4-6 hours)
**Priority:** Low - consistency improvement

---

### **Issue #19: Step Results Format Inconsistency**

**Risk:** Low - Type confusion

**Location:** `orchestrator/types.ts`

**Problem:**
- Format A: `Record<string, StepResult>`
- Format B: `Array<{id, output}>`

**Impact:**
- Agents must handle both
- Error-prone

**Recommended Solution:**

```typescript
// Standardize on single format
// orchestrator/types.ts
export interface AgentExecutionContext {
  phoneNumber: string;
  channel: 'sms' | 'whatsapp';
  userConfig: UserConfig | null;
  conversationHistory: Message[];

  // ALWAYS use this format
  previousStepResults?: Map<string, StepResult>;

  // Never use:
  // previousStepOutputs?: Record<string, StepResult>; // ❌
  // stepResults?: Array<{id, output}>; // ❌
}

// Helper to convert to map
function toStepResultMap(results: StepResult[]): Map<string, StepResult> {
  return new Map(results.map(r => [r.stepId, r]));
}

// Usage in orchestrator
const context: AgentExecutionContext = {
  // ...
  previousStepResults: toStepResultMap(completedSteps),
};
```

**Effort:** Low (2-3 hours)
**Priority:** Low - type safety

---

### **Issue #20: Tool Filtering Timing**

**Risk:** Low - Misleading prompts

**Location:** `tool-executor.ts:65`

**Problem:**
- Tools filtered after agent prompt built
- Agent may reference tools that were filtered out

**Impact:**
- Confusion during planning

**Recommended Solution:**

```typescript
// Filter tools BEFORE building agent prompt
export async function executeWithTools(
  systemPrompt: string,
  task: string,
  toolNames: string[],
  context: AgentExecutionContext
): Promise<StepResult> {
  // Filter tools FIRST
  const availableTools = resolveTools(toolNames);

  // Then enhance prompt with tool list
  const enhancedPrompt = `${systemPrompt}

## Available Tools

You have access to the following tools:
${availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Use these tools to accomplish the task.`;

  // Now execute with filtered tools
  return executeAgentWithTools(enhancedPrompt, task, availableTools, context);
}
```

**Effort:** Low (1-2 hours)
**Priority:** Low - clarity improvement

---

### **Issue #21: Response Composer Tool Loop Duplication**

**Risk:** Low - Code duplication

**Location:** `response-composer.ts:80-120` vs `tool-executor.ts`

**Problem:**
- Two implementations of tool execution loop
- Bug fixes need to be applied twice

**Impact:**
- Maintenance burden

**Recommended Solution:**

```typescript
// Extract shared tool loop logic
// src/orchestrator/tool-loop.ts
export async function executeToolLoop(
  initialMessages: Message[],
  availableTools: Tool[],
  options: {
    maxIterations?: number;
    model?: string;
  } = {}
): Promise<{ messages: Message[]; finalText: string }> {
  const { maxIterations = 10, model = 'claude-sonnet-4.5-20250929' } = options;
  let messages = [...initialMessages];

  for (let i = 0; i < maxIterations; i++) {
    const response = await anthropic.messages.create({
      model,
      messages,
      tools: availableTools.map(t => t.tool),
      max_tokens: 4096,
    });

    messages.push({
      role: 'assistant',
      content: response.content,
    });

    // Check for tool calls
    const toolCalls = response.content.filter(c => c.type === 'tool_use');
    if (toolCalls.length === 0) {
      // No more tool calls - extract final text
      const finalText = response.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('');
      return { messages, finalText };
    }

    // Execute tools
    const toolResults = await Promise.all(
      toolCalls.map(async (call) => {
        const tool = availableTools.find(t => t.tool.name === call.name);
        const result = await tool.handler(call.input);
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result),
        };
      })
    );

    messages.push({
      role: 'user',
      content: toolResults,
    });
  }

  throw new Error('Tool loop exceeded max iterations');
}

// Use in both places
// In tool-executor.ts
const result = await executeToolLoop(initialMessages, agentTools);

// In response-composer.ts
const result = await executeToolLoop(composerMessages, [formatMapsLinkTool]);
```

**Effort:** Medium (4-5 hours)
**Priority:** Low - DRY principle

---

### **Issue #22: Configuration Scattered**

**Risk:** Low - Discoverability

**Location:** `config.ts` + magic numbers in various files

**Problem:**
- Config in multiple locations
- Hard to understand full system configuration

**Impact:**
- Deployment risk
- Testing complexity

**Recommended Solution:**

```typescript
// Centralize ALL configuration
// src/config.ts
export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  // Orchestrator limits
  orchestrator: {
    maxExecutionTimeMs: 5 * 60 * 1000, // 5 minutes
    stepTimeoutMs: 2 * 60 * 1000, // 2 minutes
    toolTimeoutMs: 60 * 1000, // 1 minute
    maxReplans: 3,
    maxStepsPerPlan: 10,
    maxToolIterations: 10,
  },

  // Conversation window
  conversationWindow: {
    maxAgeHours: 24,
    maxMessages: 20,
    maxTokens: 4000,
    charsPerToken: 3.3,
  },

  // LLM models
  models: {
    classifier: 'claude-sonnet-4.5-20250929',
    planner: 'claude-opus-4.5-20241022',
    agent: 'claude-sonnet-4.5-20250929',
    memoryProcessor: 'claude-opus-4.5-20241022',
    emailWatcher: 'claude-sonnet-4.5-20250929',
  },

  // ... rest of config
};

// Use everywhere
import { config } from './config';

const timeout = config.orchestrator.stepTimeoutMs; // Not magic number
const model = config.models.planner; // Not hardcoded
```

**Effort:** Medium (6-8 hours)
**Priority:** Low - organization

---

### **Issue #23: Hardcoded Model IDs**

**Risk:** Low - Configuration drift

**Location:** 6+ files with hardcoded model IDs

**Problem:**
- Model upgrades require changes in many files
- Risk of inconsistency

**Impact:**
- Maintenance burden

**Recommended Solution:**

See Issue #22 - use centralized config.models

```typescript
// All model IDs from central config
import { config } from '../config';

// In classification.ts
const response = await anthropic.messages.create({
  model: config.models.classifier, // Not hardcoded
  // ...
});

// In planner.ts
const response = await anthropic.messages.create({
  model: config.models.planner,
  // ...
});
```

**Effort:** Low (1-2 hours)
**Priority:** Low - DRY principle

---

### **Issue #24: Prompt Management Inconsistency**

**Risk:** Low - Drift risk

**Location:** Static prompts vs dynamic builders

**Problem:**
- Agent prompts are static strings
- Classification prompt built dynamically
- No shared template system

**Impact:**
- Maintenance burden
- Risk of drift

**Recommended Solution:**

```typescript
// Create unified prompt builder system
// src/prompts/builder.ts
export class PromptBuilder {
  private sections: string[] = [];

  addSection(title: string, content: string): this {
    this.sections.push(`## ${title}\n\n${content}`);
    return this;
  }

  addList(title: string, items: string[]): this {
    const content = items.map(item => `- ${item}`).join('\n');
    this.sections.push(`## ${title}\n\n${content}`);
    return this;
  }

  addUserContext(userConfig: UserConfig | null): this {
    if (userConfig) {
      this.addSection('User Context', `
- Name: ${userConfig.name}
- Timezone: ${userConfig.timezone}
- Current time: ${new Date().toLocaleString('en-US', { timeZone: userConfig.timezone })}
      `.trim());
    }
    return this;
  }

  build(): string {
    return this.sections.join('\n\n');
  }
}

// Use for agent prompts
// src/agents/calendar/prompt.ts
export function buildCalendarPrompt(context: AgentExecutionContext): string {
  return new PromptBuilder()
    .addSection('Role', 'You are a calendar assistant...')
    .addSection('Capabilities', 'You can view, create, update, and delete calendar events.')
    .addList('Available Tools', [
      'get_calendar_events - List events',
      'create_calendar_event - Create new event',
      // ...
    ])
    .addUserContext(context.userConfig)
    .build();
}
```

**Effort:** Medium (6-8 hours)
**Priority:** Low - consistency

---

### **Issue #25: Unclear Required vs Optional Config**

**Risk:** Low - Deployment risk

**Location:** Environment variable handling

**Problem:**
- Unclear which env vars are required
- Some throw, some have defaults

**Impact:**
- Deployment confusion

**Recommended Solution:**

```typescript
// Explicit validation
// src/config.ts
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
};

const optional = (name: string, defaultValue: string): string => {
  return process.env[name] || defaultValue;
};

const optionalInt = (name: string, defaultValue: number): number => {
  const value = process.env[name];
  return value ? parseInt(value) : defaultValue;
};

export const config = {
  // REQUIRED (will throw if missing)
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
  },
  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },
  credentials: {
    encryptionKey: required('CREDENTIAL_ENCRYPTION_KEY'),
  },

  // OPTIONAL (have defaults)
  port: optionalInt('PORT', 3000),
  logLevel: optional('LOG_LEVEL', 'info'),
  memoryProcessor: {
    intervalMs: optionalInt('MEMORY_PROCESSOR_INTERVAL_MS', 300000),
    batchSize: optionalInt('MEMORY_PROCESSOR_BATCH_SIZE', 100),
  },
};

// Add to README.md
## Required Environment Variables

- `ANTHROPIC_API_KEY` - Claude API key
- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `TWILIO_PHONE_NUMBER` - Your Twilio phone number
- `CREDENTIAL_ENCRYPTION_KEY` - 64-char hex string for encrypting OAuth tokens

## Optional Environment Variables

- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)
- ...
```

**Effort:** Low (2-3 hours)
**Priority:** Low - documentation

---

### **Issue #26: Unused Storage Provider Abstraction**

**Risk:** Low - Dead code

**Location:** `src/services/ui/providers/`

**Problem:**
- S3 provider stub exists but incomplete
- Only local-storage implemented
- Unnecessary abstraction

**Impact:**
- Code bloat

**Recommended Solution:**

**Option 1: Remove Abstraction**
```typescript
// Remove provider interface
// Use local storage directly
// Delete s3-storage.ts

// Simplify to single implementation
export class UIPageStorage {
  private baseDir = './data/pages';

  async save(id: string, html: string): Promise<string> {
    const filePath = path.join(this.baseDir, `${id}.html`);
    await fs.writeFile(filePath, html);
    return `/pages/${id}`;
  }
}
```

**Option 2: Implement S3 (if needed)**
```typescript
// Only if S3 is actually needed
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export class S3PageStorage implements PageStorageProvider {
  private s3: S3Client;

  async save(id: string, html: string): Promise<string> {
    await this.s3.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: `pages/${id}.html`,
      Body: html,
      ContentType: 'text/html',
    }));

    return `${config.s3.cdnUrl}/pages/${id}.html`;
  }
}
```

**Effort:** Low (1-2 hours to remove)
**Priority:** Low - cleanup

---

### **Issue #27: Phone Number Normalization Duplication**

**Risk:** Low - Inconsistency

**Location:** 5+ files

**Problem:**
- Phone cleaning logic duplicated
- Different implementations

**Impact:**
- Bug risk

**Recommended Solution:**

```typescript
// Create canonical phone utils
// src/utils/phone.ts
export class PhoneUtils {
  /**
   * Normalize phone number to E.164 format
   * @example normalizePhone("whatsapp:+14155551234") => "+14155551234"
   * @example normalizePhone("+1 (415) 555-1234") => "+14155551234"
   */
  static normalize(phone: string): string {
    // Remove whatsapp: prefix
    let normalized = phone.replace(/^whatsapp:/, '');

    // Remove all non-digit characters except leading +
    normalized = normalized.replace(/[^\d+]/g, '');

    // Ensure leading +
    if (!normalized.startsWith('+')) {
      normalized = `+${normalized}`;
    }

    return normalized;
  }

  /**
   * Get channel from phone number
   */
  static getChannel(phone: string): 'sms' | 'whatsapp' {
    return phone.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
  }
}

// Use everywhere
import { PhoneUtils } from '../utils/phone';

const normalized = PhoneUtils.normalize(req.body.From);
const channel = PhoneUtils.getChannel(req.body.From);
```

**Effort:** Low (2-3 hours)
**Priority:** Low - standardization

---

## V. File Reference Index

### Critical Files (Fix Immediately)

1. **`src/admin/email-skills.ts`** - Issue #1 (connection leak)
2. **`src/admin/memory.ts`** - Issue #1 (connection leak)
3. **All `/admin/*` routes** - Issue #9 (no auth)

### High Priority Files

4. **`src/services/scheduler/sqlite.ts`** - Issue #2 (cleanup)
5. **`src/orchestrator/handler.ts`** - Issue #3 (promise rejection)
6. **`src/orchestrator/planner.ts`** - Issue #11 (triple fallback)
7. **`src/services/google/*.ts`** - Issue #13 (circuit breaker)
8. **`src/routes/sms.ts`** - Issue #10 (rate limiting)

### Medium Priority Files

9. **`orchestrator/types.ts`** - Issue #4 (timeout enforcement)
10. **All `sqlite.ts` files** - Issue #12 (false async)
11. **Multiple files** - Issue #7 (error handling)
12. **Multiple files** - Issue #15 (logging)

### Low Priority Files

13. **`src/config.ts`** - Issues #22, #23 (configuration)
14. **`orchestrator/executor.ts`** - Issue #18 (context building)
15. **`orchestrator/response-composer.ts`** - Issue #21 (duplication)
16. **Various** - Issues #24-27 (code quality)

---

## Summary & Recommended Action Plan

### Phase 1: Critical Fixes (Week 1)

**Priority: Immediate**
1. ✅ Add authentication to admin routes (Issue #9)
2. ✅ Fix database connection leaks (Issue #1)
3. ✅ Add scheduler DB cleanup (Issue #2)

**Effort:** 1-2 days
**Impact:** Prevents production incidents

### Phase 2: Reliability (Week 2-3)

**Priority: High**
4. ✅ Add promise rejection handling (Issue #3)
5. ✅ Implement circuit breakers (Issue #13)
6. ✅ Add rate limiting (Issue #10)
7. ✅ Fix timeout enforcement (Issue #4)

**Effort:** 3-5 days
**Impact:** Improves reliability and resilience

### Phase 3: Performance (Week 4)

**Priority: Medium**
8. ✅ Simplify planning fallback (Issue #11)
9. ✅ Standardize error handling (Issue #7)
10. ✅ Consolidate logging (Issue #15)

**Effort:** 3-4 days
**Impact:** Reduces latency, improves observability

### Phase 4: Technical Debt (Ongoing)

**Priority: Low**
11. ✅ Centralize configuration (Issues #22, #23)
12. ✅ Unified context builder (Issue #18)
13. ✅ Migration system (Issue #17)
14. ✅ Code cleanup (Issues #24-27)

**Effort:** 2-3 weeks
**Impact:** Long-term maintainability

---

## Overall Assessment

**Strengths:**
- ✅ Solid architectural patterns (agent isolation, tool handling)
- ✅ Good separation of concerns
- ✅ Comprehensive test coverage for core paths

**Critical Issues:**
- 🔴 Security: Admin routes lack authentication
- 🔴 Reliability: Database connection leaks
- 🔴 Resilience: No circuit breakers for external services

**Recommendation:**
Address Phase 1 (critical fixes) immediately before next deployment. Plan Phase 2-3 for next sprint. Phase 4 can be addressed incrementally as technical debt.

---

**End of Report**
