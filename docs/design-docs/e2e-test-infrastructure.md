# E2E Test Infrastructure

This document describes the design for end-to-end testing infrastructure that verifies the full SMS assistant pipeline with real LLM calls. It covers the test harness, mock strategy, LLM judge module, and multi-turn conversation testing patterns.

## Table of Contents

1. [Problem](#problem)
2. [Design Goals](#design-goals)
3. [Architecture Overview](#architecture-overview)
4. [Vitest Configuration](#vitest-configuration)
5. [Test Setup and Isolation](#test-setup-and-isolation)
6. [Test Harness](#test-harness)
7. [Mock Strategy](#mock-strategy)
8. [LLM Judge Module](#llm-judge-module)
9. [Trace Log Capture](#trace-log-capture)
10. [Test Scenarios](#test-scenarios)
11. [Production Conversation Analysis](#production-conversation-analysis)
12. [Cost and Performance](#cost-and-performance)
13. [Future Work: Media Attachments](#future-work-media-attachments)

---

## Problem

The project's integration tests mock all LLM responses via a queue-based Anthropic SDK mock (`tests/mocks/anthropic.ts`). This verifies wiring and structure but cannot detect regressions in how the system actually interacts with Claude — for example:

- Whether conversation history is formatted correctly
- Whether the planner routes list requests to `ui-agent`
- Whether `generate_ui` is called correctly
- Whether multi-turn context is maintained across turns

The e2e test suite fills this gap by making real Anthropic API calls while mocking only external services that the tests cannot (or should not) reach: Twilio outbound messaging, Google Workspace APIs, and media downloads. The UI generation path is intentionally real and unmocked.

## Design Goals

1. **Real LLM calls** — test the system as it behaves in production, not against canned responses.
2. **Complete isolation** — all ephemeral state (SQLite databases, generated HTML) lives in a unique temp directory; the developer's `./data/` directory is never touched.
3. **Skip gracefully in CI** — tests skip automatically when `ANTHROPIC_API_KEY` is absent, so CI pipelines don't fail or incur costs.
4. **Deterministic assertions** — hard pass/fail is based on concrete checks (HTML item presence, URL extraction, history persistence), not LLM output phrasing.
5. **LLM judge as diagnostic** — an LLM evaluates the conversation qualitatively, but its verdict is logged for insight, not used as a test gate.
6. **Reusable judge** — the same evaluation module can analyze production conversations loaded from the database.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  vitest.e2e.config.ts                                            │
│  (separate config — no @anthropic-ai/sdk alias, 2min timeout)    │
└──────────────────┬───────────────────────────────────────────────┘
                   │
    ┌──────────────┴──────────────┐
    │     tests/e2e/setup.ts      │
    │  • Temp dir for all state   │
    │  • Env vars before config   │
    │  • Import e2e mocks         │
    │  • Wire all domain providers│
    └──────────────┬──────────────┘
                   │
    ┌──────────────┴──────────────┐
    │    tests/e2e/harness.ts     │
    │  • sendMessage(text)        │
    │  • extractShortUrl()        │
    │  • fetchPageHtml()          │
    │  • getConversationHistory() │
    │  • judgeConversation()      │
    │  • getTurnLogs()            │
    └──────────┬──────────────────┘
               │ delegates
    ┌──────────┴──────────────────┐
    │    tests/e2e/judge.ts       │    ┌─────────────────────────┐
    │  • judge(input) → verdict   │────│  Real Anthropic SDK     │
    │  • fromDatabase() adapter   │    │  (Sonnet for judge)     │
    └─────────────────────────────┘    └─────────────────────────┘

    ┌─────────────────────────────┐    ┌─────────────────────────┐
    │  tests/e2e/mocks/twilio.ts  │    │ tests/e2e/mocks/google.ts│
    │  • Captures outbound SMS    │    │ • Fake OAuth credentials │
    │  • Real signature validation│    │ • Stub provider functions│
    └─────────────────────────────┘    └─────────────────────────┘
```

### File Layout

```
vitest.e2e.config.ts           # Separate vitest config for e2e
tests/e2e/
  setup.ts                     # Env vars, temp dirs, mocks, provider wiring
  harness.ts                   # E2EHarness class
  judge.ts                     # LLM judge module (reusable)
  mocks/
    twilio.ts                  # Twilio outbound mock
    google.ts                  # Google API provider mocks
  smoke.test.ts                # Infrastructure smoke test
  multi-turn/
    grocery-list.test.ts       # Multi-turn scenario test
```

## Vitest Configuration

The e2e tests use a **separate Vitest config file** (`vitest.e2e.config.ts`) rather than the main `vitest.config.ts`. This is necessary because the main config applies an alias that replaces `@anthropic-ai/sdk` with a mock module — e2e tests need the real SDK.

```typescript
// vitest.e2e.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/e2e/setup.ts'],
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 120000,   // 2 minutes per test (real LLM calls)
    hookTimeout: 30000,
  },
  // No alias for @anthropic-ai/sdk — uses the real SDK
});
```

The npm script:

```json
"test:e2e": "vitest run --config vitest.e2e.config.ts"
```

## Test Setup and Isolation

### Environment Variables

The setup file (`tests/e2e/setup.ts`) sets environment variables **before any application module is imported**, which is critical because `src/config.ts` reads env vars at import time and caches the result.

Key differences from `tests/setup.ts`:

| Variable | Main test setup | E2E setup |
|----------|----------------|-----------|
| `ANTHROPIC_API_KEY` | Overridden to `test-api-key` | Read from real environment |
| `@anthropic-ai/sdk` | Aliased to mock | Real SDK (no alias in config) |
| Model IDs | Not relevant (mocked) | Inherits production defaults (overridable via env) |
| Database paths | Default `./data/` paths | Unique temp directory per run |
| `NODE_ENV` | `test` | `development` (enables TraceLogger) |
| Background services | Not disabled | Explicitly disabled |

### Temp Directory Strategy

Each test run creates a unique temp directory using `os.tmpdir()` with a random suffix. This ensures:
- Parallel runs don't collide
- The developer's `./data/` directory is never touched
- Cleanup is handled automatically

```typescript
const E2E_TEMP_DIR = path.join(os.tmpdir(), `hermes-e2e-${randomUUID().slice(0, 8)}`);
fs.mkdirSync(E2E_TEMP_DIR, { recursive: true });

process.env.CONVERSATION_DB_PATH = path.join(E2E_TEMP_DIR, 'conversation.db');
process.env.MEMORY_SQLITE_PATH = path.join(E2E_TEMP_DIR, 'memory.db');
process.env.CREDENTIAL_STORE_SQLITE_PATH = path.join(E2E_TEMP_DIR, 'credentials.db');
process.env.UI_LOCAL_STORAGE_PATH = path.join(E2E_TEMP_DIR, 'pages');
process.env.TRACE_LOG_DIR = path.join(E2E_TEMP_DIR, 'logs');
```

Best-effort cleanup is registered on process exit/SIGINT/SIGTERM so interrupted runs don't leave orphans (though OS temp cleanup handles this anyway).

### Provider Wiring

The planner can route to any agent, so **all domain executor providers must be wired**. Missing any one causes a runtime crash if the planner selects that agent. This mirrors `src/index.ts:69-77`:

```typescript
import { executeWithTools } from '../../src/executor/tool-executor.js';
import { setCalendarExecuteWithTools } from '../../src/domains/calendar/providers/executor.js';
import { setMemoryExecuteWithTools } from '../../src/domains/memory/providers/executor.js';
// ... all 7 domain providers

setCalendarExecuteWithTools(executeWithTools);
setMemoryExecuteWithTools(executeWithTools);
// ... etc
```

### Singleton Lifecycle

The codebase has 6 singleton stores that create persistent state. The harness must reset and close all of them:

| Store | Reset | Close | E2E strategy |
|-------|-------|-------|--------------|
| Conversation | `resetConversationStore()` | `closeConversationStore()` | Temp DB; close + reset in teardown |
| Memory | `resetMemoryStore()` | `closeMemoryStore()` | Temp DB; close + reset in teardown |
| Credentials | `resetCredentialStore()` | (none needed) | `memory` provider (in-memory Map) |
| User Config | `resetUserConfigStore()` | runtime-guarded `close()` | Backed by SQLite; close then reset |
| UI Storage | `resetProviders()` | (none needed) | Temp dir; reset in teardown |
| UI Shortener | `resetProviders()` | (none needed) | `memory` provider; reset in teardown |

The harness's `stop()` method executes: close SQLite connections → reset all singletons → delete the temp directory. The `reset()` method (used between tests within a suite) clears conversation history, memory facts, and Twilio sent messages without closing connections.

## Test Harness

The `E2EHarness` class encapsulates the send-message-and-wait-for-response pattern.

### Interface

```typescript
export class E2EHarness {
  constructor(options?: { phoneNumber?: string });
  async start(): Promise<void>;
  async stop(): Promise<void>;
  async sendMessage(text: string, options?: { timeout?: number }): Promise<E2EResponse>;
  async getConversationHistory(): Promise<ConversationMessage[]>;
  async reset(): Promise<void>;
  extractShortUrl(responseText: string): string;
  async fetchPageHtml(shortUrl: string): Promise<string>;
  async judgeConversation(criteria: string[]): Promise<JudgeVerdict>;
  getTurnLogs(): TurnLog[];
}

export interface E2EResponse {
  syncResponse: string;        // The TwiML immediate response
  asyncResponse: string | null; // The Twilio API async response (null if none)
  finalResponse: string;        // async if available, else sync
}

export interface TurnLog {
  turnNumber: number;
  filePath: string;
  content: string;  // Full text of the trace log file
}
```

### Message Flow

The `sendMessage` method:

1. Uses a consistent phone number for all messages in a test (default: `+15551234567`).
2. Builds a Twilio webhook payload using `createSmsPayload` from `tests/fixtures/webhook-payloads.ts`.
3. Computes a valid Twilio signature so the handler's validation passes.
4. Calls `handleSmsWebhook(req, res)` directly with a mock request/response (no HTTP server needed — Express routing is already validated by integration tests).
5. Waits for the async response via polling `getSentMessages()` at 500ms intervals (configurable timeout, default 90s).
6. Returns the response text (async response if available, otherwise sync TwiML response).
7. After each turn, collects the per-turn trace log file.

### Async Failure Early-Exit

If `processAsyncWork` throws and the error-message fallback also fails, no outbound Twilio message is ever enqueued. Without early-exit detection, `waitForAsyncResponse` would hang for 90 seconds before timing out. The method monitors the trace log directory for a completed log file (the TraceLogger writes a `SUCCESS` or `FAILED` footer). If a `FAILED` footer appears but no outbound message exists, the method returns early with a diagnostic error.

### URL Extraction

The LLM may format URLs in several ways: bare, markdown, with trailing punctuation, or protocol-less. The extraction must be tolerant:

```typescript
extractShortUrl(responseText: string): string {
  const match = responseText.match(/(?:https?:\/\/[^\s)\]]+)?\/u\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error(
      `No /u/:id short URL found in response. Full response text:\n${responseText}`
    );
  }
  return `/u/${match[1]}`;
}
```

The error message includes the full response text so the developer can immediately diagnose extraction failures vs. LLM behavior issues.

## Mock Strategy

### What Is Mocked

| Component | Mocked? | Rationale |
|-----------|---------|-----------|
| Anthropic SDK | **No** | Core purpose of e2e tests |
| Twilio outbound | **Yes** | Cannot/should not send real SMS |
| Twilio signature validation | **No** | Uses real validation (signatures computed by harness) |
| Google OAuth + APIs | **Yes** | Cannot reach real Google APIs in tests |
| UI generation / storage | **No** | Verifying real page generation is the test objective |
| URL shortener | **No** | Real in-memory shortener |
| SQLite databases | **No** | Real databases in temp dir |

### Twilio Mock (`tests/e2e/mocks/twilio.ts`)

Structurally identical to `tests/mocks/twilio.ts`. Uses `vi.mock('twilio', ...)` to replace the SDK with a mock that captures outbound messages. `validateRequest` and `getExpectedTwilioSignature` are preserved from the real SDK for inbound webhook simulation.

Exports: `getSentMessages()`, `clearSentMessages()`.

### Google Mock (`tests/e2e/mocks/google.ts`)

Two layers:

**Layer 1 — Credential seeding.** The harness's `start()` seeds fake Google OAuth credentials into the in-memory credential store:

```typescript
const store = getCredentialStore();
await store.set(phoneNumber, 'google', {
  accessToken: 'fake-access-token',
  refreshToken: 'fake-refresh-token',
  expiresAt: Date.now() + 3_600_000,
});
```

**Layer 2 — Provider-level stubs.** Instead of mocking the entire `googleapis` module (large surface area), the mock replaces provider-level functions that tools call:

| Provider module | Stubbed methods |
|----------------|-----------------|
| `google-drive.ts` | `files.create`, `files.list`, `files.get`, `files.update`, `files.delete` |
| `google-sheets.ts` | `spreadsheets.create`, `spreadsheets.values.get/update/append` |
| `google-docs.ts` | `documents.create`, `documents.get`, `documents.batchUpdate` |
| `google-calendar.ts` | (reuse existing `tests/mocks/google-calendar.ts` pattern) |
| `gmail.ts` | Stub Gmail client methods |
| `google-core/auth.ts` | `getAuthenticatedClient` → fake OAuth2Client; `refreshAccessToken` → fresh fake tokens |

Mock responses must be realistic enough for tool handlers to parse without errors (e.g., `files.create` returns `{ data: { id: 'fake-file-id', name: 'Grocery List', webViewLink: '...' } }`).

## LLM Judge Module

The judge lives in a separate module (`tests/e2e/judge.ts`) to enable reuse beyond tests.

### Interface

```typescript
export interface JudgeInput {
  messages: ConversationMessage[];
  generatedPages?: Map<string, string>;  // shortUrl → HTML
  turnLogs?: TurnLog[];
  criteria: string[];
                  // plain-English evaluation criteria
}

export interface JudgeVerdict {
  criteria: Array<{
    criterion: string;
    verdict: 'PASS' | 'FAIL';
    reason: string;
  }>;
  overall: 'PASS' | 'FAIL';
  summary: string;
}

export async function judge(input: JudgeInput): Promise<JudgeVerdict>;
export async function fromDatabase(
  phoneNumber: string,
  options?: { since?: Date; limit?: number },
): Promise<Omit<JudgeInput, 'criteria'>>;
```

### Implementation

The judge sends the full conversation transcript (messages + generated page HTML + trace logs) to Claude Sonnet with evaluation criteria. It returns a structured JSON verdict. The `formatTranscript` helper includes message role, content, and page HTML where applicable.

`safeParseJudgeVerdict` handles both raw JSON and fenced markdown responses. On parse failure, it returns a diagnostic FAIL rather than throwing.

### Why Not a Hard Gate

Deterministic assertions (HTML item presence, history persistence, URL extraction) are the authoritative acceptance criteria — they are stable and reproducible. The LLM judge provides qualitative feedback (was the conversation natural? did the assistant understand intent?) that is valuable for debugging but varies between runs due to model output variability.

## Trace Log Capture

The codebase has a `TraceLogger` (`src/utils/trace-logger.ts`) that writes detailed per-turn log files during development. Each orchestration request creates one file at `{TRACE_LOG_DIR}/{YYYY-MM-DD}/{HH-mm-ss}_{requestId}.log` containing:
- LLM requests/responses
- Tool executions
- Plan events
- Step events
- Errors

The e2e setup points `TRACE_LOG_DIR` at the temp directory and sets `NODE_ENV=development` to enable file logging. After each `sendMessage` call, the harness scans for new log files, reads them, and stores them as `TurnLog` entries:

```typescript
private async collectTurnLog(turnNumber: number): Promise<TurnLog | null> {
  const logDir = process.env.TRACE_LOG_DIR!;
  const dateDir = new Date().toISOString().split('T')[0];
  const fullDir = path.join(logDir, dateDir);
  if (!fs.existsSync(fullDir)) return null;

  const files = fs.readdirSync(fullDir).sort();
  const newFiles = files.filter(f => !this.seenLogFiles.has(f));
  if (newFiles.length === 0) return null;

  const logFile = newFiles[newFiles.length - 1];
  this.seenLogFiles.add(logFile);
  const filePath = path.join(fullDir, logFile);
  const content = fs.readFileSync(filePath, 'utf-8');
  return { turnNumber, filePath, content };
}
```

The full trace log content is passed to the LLM judge. No mechanical log parsing is done by the harness — this keeps it simple and avoids brittle assertions that break when log format changes.

## Test Scenarios

### Smoke Test (`tests/e2e/smoke.test.ts`)

A minimal test that sends "Hello" and expects any non-error response. Validates harness setup, mocking, provider wiring, and the basic classify → orchestrate → respond flow without depending on specific agent routing. If this test fails, the problem is infrastructure, not LLM behavior.

```typescript
it('responds to a simple greeting without errors', async () => {
  const result = await harness.sendMessage('Hello!');
  expect(result.finalResponse).toBeTruthy();
  expect(result.finalResponse.length).toBeGreaterThan(0);
}, 60_000);
```

### Grocery List Multi-Turn Test (`tests/e2e/multi-turn/grocery-list.test.ts`)

This test validates two things together: (1) UI generation creates real web pages, and (2) multi-turn conversation state is preserved across turns.

**Scenario:**
1. User: "Create a grocery list with eggs, milk, bread and butter"
2. Assert: response contains a `/u/:id` URL; fetched HTML contains all four items
3. User: "Add hummus and regenerate the page. Return the new link."
4. Assert: response contains a *different* `/u/:id` URL; fetched HTML contains all five items

**Verification layers:**
- **Deterministic (hard gate):** URL extraction, HTML item presence, different URLs across turns
- **Diagnostic (logged):** LLM judge evaluates correctness, intent inference, completeness, link presence, conversational coherence, and absence of concerning trace log errors

### API Key Guard

Tests skip automatically when `ANTHROPIC_API_KEY` is absent or set to the test placeholder:

```typescript
const hasApiKey = process.env.ANTHROPIC_API_KEY
  && process.env.ANTHROPIC_API_KEY !== 'test-api-key';

const describeE2E = hasApiKey ? describe : describe.skip;
```

## Production Conversation Analysis

The judge module's `fromDatabase()` factory loads a real conversation from the production (or dev) SQLite database and returns a `JudgeInput` that can be passed to `judge()` with custom criteria.

```typescript
import { judge, fromDatabase } from './tests/e2e/judge.js';

const input = await fromDatabase('+15551234567', {
  since: new Date('2026-02-22T10:00:00Z'),
});
const verdict = await judge({
  ...input,
  criteria: [
    'Did the assistant correctly handle the user request?',
    'Was multi-turn context maintained?',
    'Were there any errors that affected response quality?',
  ],
});
console.log(verdict.summary);
```

This is useful for diagnosing production errors spotted in logs — point the judge at a phone number and time window and get a structured evaluation from the conversation's perspective.

**Limitation:** The judge sees conversation messages but not orchestrator-level diagnostics (plan steps, agent selections, tool calls). Those are emitted as structured JSON logs to stdout and are not persisted to a queryable store. Persisting orchestrator events to a `logs` table would be a separate enhancement.

No CLI script is included in this design. The `fromDatabase` + `judge` API is sufficient; a CLI wrapper can be added in ~40 lines when the need arises.

## Cost and Performance

At Opus pricing (~$15/MTok input, $75/MTok output), a two-turn test with ~8 LLM calls costs roughly $0.50–1.00 per run. The judge call (Sonnet) adds a small additional cost.

For rapid iteration, override with cheaper models:

```bash
CLASSIFIER_MODEL_ID=claude-haiku-4-5-20251001 \
PLANNER_MODEL_ID=claude-sonnet-4-5-20250929 \
npm run test:e2e
```

The setup file logs the active model IDs at startup so the developer knows what they're running against.

E2e tests should run on-demand during development, not on every push. The API key guard ensures CI pipelines skip them by default.

## Future Work: Media Attachments

To support media attachments in future tests (e.g., "send a photo of a grocery list, then add items"), `sendMessage` needs an optional `media` parameter:

```typescript
interface MediaOption {
  contentType: string;  // e.g., 'image/jpeg'
  url: string;          // Mock Twilio CDN URL
  mockContent: Buffer;  // Actual file bytes returned on download
}

async sendMessage(text: string, options?: {
  timeout?: number;
  media?: MediaOption[];
})
```

When media is provided, the harness:
1. Adds `NumMedia`, `MediaUrl0`, `MediaContentType0` fields to the webhook payload
2. Registers mock URLs with a mock HTTP fetcher for `processMediaAttachments`
3. Mocks the Gemini pre-analysis call (`src/services/media/pre-analyze.ts`) to return a canned summary

This design is sufficient to guide implementation when media tests are needed.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Separate Vitest config | Main config aliases `@anthropic-ai/sdk` to a mock; e2e needs the real SDK |
| Direct handler invocation (no HTTP server) | Integration tests already validate Express routing; e2e focuses on LLM interaction |
| Inherit production model defaults | Testing a different model would test a different system |
| Mock Google at provider-function layer | Provider-level mocks keep the mock surface small vs. stubbing all of `googleapis` |
| Skip in CI by default | E2e tests incur real API costs and are inherently slower |
| Real UI generation (no mocks) | Primary behavior under test is that real multi-turn requests produce real hosted UI pages |
| LLM judge as non-blocking diagnostic | Model-output variability makes it unsuitable as a strict test gate |
| Async failure early-exit via log monitoring | Prevents 90s timeout hangs when the orchestrator fails silently |
| Reusable judge with `fromDatabase()` | Same evaluation logic useful for diagnosing production errors |
| Infrastructure smoke test | Distinguishes infrastructure failures from LLM behavior regressions |
