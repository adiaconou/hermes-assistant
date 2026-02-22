# End-to-End Test Suite for Multi-Turn Conversations

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. This plan must be maintained in accordance with PLANS.md at the repository root.


## Purpose / Big Picture

After this change, developers can run `npm run test:e2e` to execute end-to-end tests that verify the full SMS assistant pipeline with real LLM calls. The first test validates two things together: (1) the UI generation path creates real grocery-list web pages, and (2) multi-turn conversation state is preserved and reused (history is stored, reloaded, and applied on later turns). The scenario is: the user asks to "Create a grocery list with eggs, milk, bread and butter", then sends a follow-up with only "add hummus", and the assistant generates a new grocery-list web page that includes both the original items and hummus.

Today, the project's integration tests mock all LLM responses via a queue-based Anthropic SDK mock. This verifies wiring and structure but cannot detect regressions in how the system actually interacts with Claude — for example, whether conversation history is formatted correctly, whether the planner routes list requests to `ui-agent`, whether `generate_ui` is called correctly, or whether multi-turn context is maintained. The e2e test suite fills this gap by making real Anthropic API calls while mocking only external services that the tests cannot (or should not) reach: Twilio outbound messaging, Google Workspace APIs, and media downloads from Twilio CDN. The UI path is intentionally real and unmocked.

To observe the change working: set the `ANTHROPIC_API_KEY` environment variable to a valid key and run `npm run test:e2e` from WSL. The test sends two simulated SMS messages, extracts a `/u/:id` short URL from each assistant response, resolves each URL to stored HTML, and asserts: turn 1 page contains the initial grocery items; turn 2 page is a new URL that contains all original items plus hummus. The LLM judge receives the full conversation transcript and per-turn trace logs and provides a qualitative diagnostic verdict.


## Progress

- [x] (2026-02-22 21:26Z) Milestone 1: E2E test infrastructure (vitest config, setup, harness, judge module)
- [x] (2026-02-22 21:28Z) Milestone 2: Mock layer for external services
- [x] (2026-02-22 21:40Z) Milestone 3: Smoke test and grocery list multi-turn test
- [x] (2026-02-22 21:40Z) All validation passing: 688 unit tests, 29 integration tests, 2 e2e tests, build clean


## Surprises & Discoveries

- Observation: ESM static imports in setup.ts are hoisted above process.env assignments, causing config.ts to load from .env/real env before test values are set. This caused Invalid URL errors in Twilio signature validation.
  Evidence: `TypeError: Invalid URL` in `Twilio.validateRequest` — config.baseUrl was read from .env before setup.ts could override it.
  Fix: Changed all `src/` imports in setup.ts and google mock to dynamic `await import()` so they execute after env vars are set.

- Observation: enforceSmsLength() truncates SMS responses > 160 chars to a canned ack ("Working on your request..."), destroying URLs in async responses. The Twilio mock captures the truncated message, not the full response.
  Evidence: `No /u/:id short URL found in response. Full response text: Working on your request. I'll send the full response shortly.`
  Fix: Changed harness to read finalResponse from conversation history (un-truncated) instead of the Twilio sent message.

- Observation: Sync-only messages ("Hello!") produce no trace log file and no Twilio API message. The original waitForAsyncResponse would poll for 90s and timeout.
  Evidence: Smoke test timed out at 60s waiting for an async response that never came.
  Fix: Replaced waitForAsyncResponse with waitForAsyncCompletion that detects sync-only messages (no trace log within 5s) and returns early.

- Observation: "Hello!" is classified as needsAsyncWork: false, so no trace log is produced (TraceLogger is only created inside handleWithOrchestrator). The smoke test's assertion on getTurnLogs().length === 1 was incorrect.
  Fix: Removed the trace log assertion from the smoke test.


## Decision Log

- Decision: Use a separate Vitest config file rather than a workspace or project-level filter.
  Rationale: The existing `vitest.config.ts` applies an alias that replaces `@anthropic-ai/sdk` with a mock module. E2e tests need the real SDK. A separate config (`vitest.e2e.config.ts`) is the cleanest way to opt out of that alias without conditionalising the main config. The `test:e2e` npm script points at the e2e config explicitly.
  Date/Author: 2026-02-22 / plan author

- Decision: Call `handleSmsWebhook` directly rather than starting an HTTP server with supertest.
  Rationale: The existing integration tests already validate Express routing and URL-encoded body parsing. The purpose of e2e tests is to verify LLM interaction and conversation continuity, not HTTP mechanics. Direct handler invocation avoids the complexity of server lifecycle management, port allocation, and startup/shutdown sequencing. The harness can be extended to use supertest later if HTTP-level testing becomes valuable.
  Date/Author: 2026-02-22 / plan author

- Decision: Inherit production model defaults (currently `claude-opus-4-5-20251101` for all roles) but document cost and override path.
  Rationale: The point of e2e tests is to verify the system behaves the same way it does in production. Using a different model would test a different system. The e2e setup does not override model env vars — it inherits whatever `config.models.*` resolves to. However, at Opus pricing (~$15/MTok input, $75/MTok output), a two-turn test with ~8 LLM calls costs roughly $0.50–1.00 per run. For rapid iteration, developers should override with cheaper models: `CLASSIFIER_MODEL_ID=claude-haiku-4-5-20251001 PLANNER_MODEL_ID=claude-sonnet-4-5-20250929 npm run test:e2e`. The setup file logs the active model IDs at startup so the developer knows what they're running against.
  Date/Author: 2026-02-22 / plan author

- Decision: Mock Google APIs at the provider-function layer rather than mocking the entire `googleapis` package.
  Rationale: Mocking `googleapis` directly requires stubbing a very large nested surface. Provider-level mocks (such as Drive/Sheets/Docs/Calendar/Gmail providers) keep the mock surface small and align with how tools already consume these dependencies.
  Date/Author: 2026-02-22 / plan author

- Decision: Skip e2e tests in CI by default (guard with `ANTHROPIC_API_KEY` presence check).
  Rationale: E2e tests incur real API costs and are inherently slower (10-60 seconds per test). They should run on-demand during development, not on every push. The setup file checks for a valid API key and calls `describe.skip` if it is missing or set to the test placeholder value.
  Date/Author: 2026-02-22 / plan author

- Decision: Do not mock `ui-agent`, `generate_ui`, UI storage, or URL shortener in e2e tests.
  Rationale: The primary behavior under test is that a real multi-turn request produces real hosted UI pages with correct contents. Mocking UI generation would invalidate the test objective.
  Date/Author: 2026-02-22 / plan author

- Decision: Use an LLM judge as a non-blocking diagnostic, not a hard pass/fail gate.
  Rationale: Deterministic assertions (HTML item presence, URL behavior) are the authoritative acceptance criteria because they are stable and reproducible. The LLM judge is still useful for qualitative feedback, but model-output variability makes it unsuitable as a strict test gate.
  Date/Author: 2026-02-22 / plan author

- Decision: Extract the `extractShortUrl` method with a well-defined regex and clear failure diagnostics.
  Rationale: LLM output format varies — the URL might appear bare, in markdown link syntax, or with trailing punctuation. A fragile regex causes false test failures unrelated to actual functionality. The extraction must be tolerant and the error message must include the full response text so the developer can diagnose promptly.
  Date/Author: 2026-02-22 / review

- Decision: Detect async orchestrator failures early instead of polling until timeout.
  Rationale: If `processAsyncWork` throws and the error-message fallback also fails, no outbound Twilio message is ever enqueued. The default `waitForAsyncResponse` would hang for 90 seconds before timing out. Monitoring the TraceLogger output file for a `SUCCESS` or `FAILED` footer allows the harness to return early with a diagnostic error.
  Date/Author: 2026-02-22 / review

- Decision: Design the judge module so it can also analyze production conversations loaded from the database.
  Rationale: The same evaluation logic (transcript + criteria → structured verdict) is useful for diagnosing production errors spotted in logs. By accepting a `ConversationTranscript` input (buildable from either the test harness or a DB query), the judge is reusable without duplication. The production adapter is a thin layer over `getConversationStore().getHistory()`.
  Date/Author: 2026-02-22 / review

- Decision: Use WhatsApp payloads instead of SMS payloads in the e2e harness.
  Rationale: `enforceSmsLength()` truncates SMS messages >160 chars to a canned ack, destroying URLs in async responses. WhatsApp messages bypass this truncation entirely. Since the webhook handler (`/webhook/sms`) is the same for both channels (it detects channel from the `whatsapp:` prefix on the From field), using WhatsApp payloads tests the same code path without SMS-specific length constraints interfering with assertions.
  Date/Author: 2026-02-22 / implementation

- Decision: Include a minimal smoke test alongside the grocery-list scenario test.
  Rationale: A trivial "hello" test that expects any non-error response validates harness setup, mocking, provider wiring, and the basic classify → orchestrate → respond flow without depending on specific agent routing or UI generation. If this test fails, the problem is infrastructure, not LLM behavior.
  Date/Author: 2026-02-22 / review

- Decision: Use per-turn TraceLogger log files instead of console interception for log capture.
  Rationale: The codebase already has `TraceLogger` (`src/utils/trace-logger.ts`) that writes detailed per-turn log files in development mode. Using these files avoids patching `console.log`/`console.error` (which can interfere with Vitest's reporter) and provides richer data (full LLM requests/responses, tool executions, plan events). All log analysis is done by the LLM judge, not mechanically.
  Date/Author: 2026-02-22 / review


## Outcomes & Retrospective

Implementation complete. All 8 files created, all 3 milestones delivered.

Validation results:
- `npm run test:e2e` (with API key): 2 tests pass (smoke + grocery list multi-turn) in ~55s
- `npm run test:unit`: 688 tests pass
- `npm run test:integration`: 29 tests pass
- `npm run build`: clean

The grocery list multi-turn test successfully verifies: (1) UI generation produces real pages with correct items, (2) multi-turn context is preserved across turns, (3) the LLM judge provides structured diagnostic evaluations. The LLM judge passed all 6 criteria on both test runs.

Key implementation differences from original plan: (a) setup.ts uses dynamic `await import()` instead of static imports to avoid ESM hoisting issues with config.ts; (b) harness reads finalResponse from conversation history instead of Twilio messages to avoid SMS truncation; (c) waitForAsyncCompletion detects sync-only messages via trace log absence and returns early instead of polling to timeout; (d) smoke test does not assert trace log presence since sync-only messages skip the orchestrator.


## Context and Orientation

This section describes the current state of the system relevant to this plan. Every file path is relative to the repository root.

**Inbound message flow.** When Twilio receives an SMS or WhatsApp message, it POSTs a webhook to `/webhook/sms`. The handler in `src/routes/sms.ts` exports a function `handleSmsWebhook(req, res)` that does the following:

1. Validates the Twilio signature using the shared auth token.
2. Applies per-phone-number rate limiting (20 messages per minute).
3. Extracts media attachments from the webhook body fields `MediaUrl0..9` and `MediaContentType0..9`.
4. Builds the message text, appending a media description if attachments are present.
5. Loads conversation history, user config, and memory facts in parallel.
6. Calls `classifyMessage()` — a fast LLM call that returns `{ needsAsyncWork: boolean, immediateResponse: string }`.
7. Stores the user message and the immediate response in the conversation database.
8. Returns TwiML XML with the immediate response (this is the synchronous response Twilio relays to the user).
9. If `needsAsyncWork` is true (or media is present), spawns `processAsyncWork()` in the background. This function runs the orchestrator, stores the result in conversation history, and sends it via the Twilio API.

**Orchestration pipeline.** `processAsyncWork` calls `handleWithOrchestrator()` in `src/orchestrator/handler.ts`, which loads conversation history and memory facts, then calls `orchestrate()` in `src/orchestrator/orchestrate.ts`. The orchestrator creates an execution plan (via an LLM call to `createPlan`), executes each plan step by routing to a domain agent, handles failures via replanning, and synthesizes a final response (via another LLM call to `synthesizeResponse`). There are typically 4 LLM calls per orchestration: classification, planning, agent execution, and response composition.

**Domain agents.** There are 6 specialized agents: `calendar-agent`, `scheduler-agent`, `email-agent`, `memory-agent`, `ui-agent`, and `drive-agent`. Each agent is defined in `src/domains/<name>/runtime/agent.ts` with a system prompt in `prompt.ts` and tools in `tools.ts`. Agents are registered in `src/registry/agents.ts`. Each agent has its own set of tools; the executor only provides the tools listed in the agent's capability definition.

**Conversation persistence.** The `SqliteConversationStore` (in `src/services/conversation/sqlite.ts`) stores messages in a `conversation_messages` table keyed by phone number. The store is a singleton created by `getConversationStore()` in `src/services/conversation/index.ts` using the path from `config.conversation.sqlitePath`. The store has a `resetConversationStore()` function for tests.

**Memory persistence.** The memory store (in `src/domains/memory/service/store.ts`) stores user facts in a `memory.db` SQLite database. It has `getMemoryStore()`, `resetMemoryStore()`, and `closeMemoryStore()` functions following the same singleton pattern.

**Credential store.** Google OAuth tokens are stored via `getCredentialStore()` (in `src/services/credentials/index.ts`). The `memory` provider (used in tests) stores credentials in a plain JavaScript Map. The `sqlite` provider encrypts credentials with AES-256-GCM.

**Google API access.** All Google API calls go through `getAuthenticatedClient(phoneNumber, serviceName)` in `src/domains/google-core/providers/auth.ts`. This fetches credentials from the credential store, creates a `google.auth.OAuth2` client, and returns it. If no credentials exist, it throws `AuthRequiredError`. API-specific clients (Drive, Sheets, Docs, Calendar, Gmail) are created by provider functions like `getDriveClient(phoneNumber)` in `src/domains/drive/providers/google-drive.ts`.

**UI generation.** The `generate_ui` tool writes HTML to the local filesystem (`data/pages/`) and returns a short URL. It does not call any external services.

**Memory tools.** The `extract_memory`, `list_memories`, `update_memory`, and `remove_memory` tools operate on the local SQLite memory database. No external services.

**Existing test infrastructure.** Tests use Vitest 2.0 with a global setup file at `tests/setup.ts`. The file sets test environment variables, imports mocks for Anthropic, Twilio, and Google Calendar, and clears mocks between tests. The vitest config at `vitest.config.ts` applies an alias `'@anthropic-ai/sdk': './tests/mocks/anthropic.ts'` that replaces the real SDK with a queue-based mock. Integration tests call `handleSmsWebhook` directly with mock request/response objects built by `createMockReqRes()` in `tests/helpers/mock-http.ts`.

**Provider wiring.** In production, `src/index.ts` wires domain executor providers by calling functions like `setMemoryExecuteWithTools(executeWithTools)`. In tests, suites that exercise orchestrator paths wire providers explicitly (for example, `tests/integration/webhook.test.ts` wires memory provider injection). The e2e setup must wire the required providers for all agents that may be selected in the scenario.

**Config loading.** `src/config.ts` reads environment variables at import time. Database paths default to `./data/*.db` in development. The conversation, memory, and credential databases are created lazily when first accessed.

**TraceLogger.** `src/utils/trace-logger.ts` provides per-turn file logging in development mode. Each orchestration request creates one log file at `{TRACE_LOG_DIR}/{YYYY-MM-DD}/{HH-mm-ss}_{requestId}.log` containing the full trace: LLM requests/responses (with full prompts and completions), tool executions, plan events (`plan_created`, `plan_completed`, `plan_failed`), step events (`step_started`, `step_completed`, `step_failed`), and errors. The logger is created in `handleWithOrchestrator()` and passed through the entire orchestration stack. Files are written synchronously via `appendFileSync`. The logger writes a footer with `SUCCESS` or `FAILED` when orchestration completes.


## Layer Compliance Strategy

All new files live in the `tests/` directory tree, which is outside the production source boundary. No production code in `src/` is modified. The new files are:

- `vitest.e2e.config.ts` — root-level config file (peer to existing `vitest.config.ts`)
- `tests/e2e/setup.ts` — e2e test setup
- `tests/e2e/harness.ts` — test harness utility
- `tests/e2e/judge.ts` — conversation judge / analyzer (reusable for production diagnosis)
- `tests/e2e/mocks/twilio.ts` — Twilio outbound mock for e2e
- `tests/e2e/mocks/google.ts` — Google API mocks for e2e
- `tests/e2e/smoke.test.ts` — infrastructure smoke test
- `tests/e2e/multi-turn/grocery-list.test.ts` — multi-turn scenario test

One modification to `package.json`: adding a `test:e2e` script.

No architectural boundaries are crossed. The e2e tests import production modules (`src/routes/sms.ts`, `src/executor/tool-executor.ts`, `src/services/ui/index.ts`, etc.) as consumers, the same way existing integration tests do. Twilio and Google integrations are mocked; the UI generation path remains real. All ephemeral state (SQLite databases, generated HTML pages, trace logs) is created in `os.tmpdir()` and deleted after each test run — nothing is written to the working tree's `data/` directory.

Compliance verification command set for this plan: `npm run lint:architecture`, `npm run test:e2e`, `npm run test:unit && npm run test:integration`.


## Plan of Work

The work is divided into three milestones. Each produces working, testable artifacts.


### Milestone 1: E2E Test Infrastructure

This milestone creates the scaffolding: a separate Vitest config, an e2e-specific setup file, a test harness class, and a reusable judge module. At the end, a skeleton test file exists that can be run (it will skip if no API key is set).

**vitest.e2e.config.ts** (new file, repository root). This Vitest config is specifically for e2e tests. It differs from the main config in three ways: (a) it does NOT alias `@anthropic-ai/sdk`, so the real Anthropic SDK is used; (b) it uses a different setup file (`tests/e2e/setup.ts`); (c) it only includes test files under `tests/e2e/`. The test timeout is set to 120000ms (2 minutes) to accommodate real LLM calls.

    // vitest.e2e.config.ts
    import { defineConfig } from 'vitest/config';

    export default defineConfig({
      test: {
        setupFiles: ['./tests/e2e/setup.ts'],
        include: ['tests/e2e/**/*.test.ts'],
        environment: 'node',
        globals: true,
        testTimeout: 120000,
        hookTimeout: 30000,
        // No alias for @anthropic-ai/sdk — uses the real SDK
      },
    });

**tests/e2e/setup.ts** (new file). Sets environment variables for the e2e test environment. This file runs before any application module is imported, which is critical because `src/config.ts` reads env vars at import time and caches the result.

Critical differences from the main `tests/setup.ts`:

- `ANTHROPIC_API_KEY` is read from the real environment (not overridden to a test value).
- Model IDs are not overridden; defaults come from `src/config.ts` (overridable via env).
- `CREDENTIAL_STORE_PROVIDER` is set to `memory` (in-memory Map, no file).
- All SQLite database paths, UI storage paths, and trace log paths point to a unique temp directory created per test run. This ensures complete isolation from the developer's `./data/` directory.
- Twilio and Google mocks are imported (but NOT the Anthropic mock).
- Background services (memory processor, email watcher) are disabled via env vars.

The temp directory strategy uses `os.tmpdir()` with a random suffix so parallel runs do not collide and the OS's temp directory is used rather than anything in the working tree:

    // tests/e2e/setup.ts — ephemeral database isolation
    import os from 'os';
    import path from 'path';
    import fs from 'fs';
    import { randomUUID } from 'crypto';

    // Create a unique temp directory for this test run
    const E2E_TEMP_DIR = path.join(os.tmpdir(), `hermes-e2e-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(E2E_TEMP_DIR, { recursive: true });

    // Point ALL persistent stores at the temp directory
    // NODE_ENV=development enables TraceLogger file writing (per-turn log files)
    process.env.NODE_ENV = 'development';
    process.env.CONVERSATION_DB_PATH = path.join(E2E_TEMP_DIR, 'conversation.db');
    process.env.MEMORY_SQLITE_PATH = path.join(E2E_TEMP_DIR, 'memory.db');
    process.env.CREDENTIAL_STORE_PROVIDER = 'memory'; // in-memory, no file
    process.env.CREDENTIAL_STORE_SQLITE_PATH = path.join(E2E_TEMP_DIR, 'credentials.db');
    process.env.UI_LOCAL_STORAGE_PATH = path.join(E2E_TEMP_DIR, 'pages');
    process.env.UI_SHORTENER_PROVIDER = 'memory'; // in-memory, no file
    process.env.TRACE_LOG_DIR = path.join(E2E_TEMP_DIR, 'logs');
    process.env.MEMORY_PROCESSOR_ENABLED = 'false';
    process.env.EMAIL_WATCHER_ENABLED = 'false';
    // ANTHROPIC_API_KEY: intentionally NOT set — comes from real env
    // Model IDs: NOT overridden — inherits production defaults from config.ts

    // Twilio test values (same as tests/setup.ts)
    process.env.TWILIO_ACCOUNT_SID = 'test-account-sid';
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_PHONE_NUMBER = '+15555550000';
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.CREDENTIAL_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

    // Export for harness teardown
    export const E2E_TEMP_ROOT = E2E_TEMP_DIR;

    // Best-effort cleanup even if tests are skipped or aborted before harness.stop()
    function cleanupTempRoot(): void {
      try {
        fs.rmSync(E2E_TEMP_ROOT, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors during process shutdown
      }
    }
    process.once('exit', cleanupTempRoot);
    process.once('SIGINT', cleanupTempRoot);
    process.once('SIGTERM', cleanupTempRoot);

The setup file also imports mocks (`./mocks/twilio.ts`, `./mocks/google.ts`) and wires domain executor providers following the same injection pattern used in `src/index.ts`. Because the planner can route to any agent, ALL 7 providers must be wired — missing any one causes a runtime crash if the planner selects that agent:

    import { executeWithTools } from '../../src/executor/tool-executor.js';
    import { setCalendarExecuteWithTools } from '../../src/domains/calendar/providers/executor.js';
    import { setMemoryExecuteWithTools } from '../../src/domains/memory/providers/executor.js';
    import { setEmailExecuteWithTools } from '../../src/domains/email/providers/executor.js';
    import { setDriveExecuteWithTools } from '../../src/domains/drive/providers/executor.js';
    import { setUiExecuteWithTools } from '../../src/domains/ui/providers/executor.js';
    import { setSkillsExecuteWithTools } from '../../src/domains/skills/providers/executor.js';
    import { setEmailWatcherExecuteWithTools } from '../../src/domains/email-watcher/providers/executor.js';

    setCalendarExecuteWithTools(executeWithTools);
    setMemoryExecuteWithTools(executeWithTools);
    setEmailExecuteWithTools(executeWithTools);
    setDriveExecuteWithTools(executeWithTools);
    setUiExecuteWithTools(executeWithTools);
    setSkillsExecuteWithTools(executeWithTools);
    setEmailWatcherExecuteWithTools(executeWithTools);

The existing integration tests only wire `setMemoryExecuteWithTools` because they mock the LLM and control routing. E2E tests use real LLM calls, so any agent could be selected.

The setup file also logs the active model IDs at startup so the developer knows which models are being used:

    console.log(JSON.stringify({
      event: 'e2e_setup',
      models: {
        classifier: process.env.CLASSIFIER_MODEL_ID || '(default from config)',
        planner: process.env.PLANNER_MODEL_ID || '(default from config)',
        agent: process.env.AGENT_MODEL_ID || '(default from config)',
        composer: process.env.COMPOSER_MODEL_ID || '(default from config)',
      },
    }));

**Singleton lifecycle.** The codebase has 6 singleton stores that create or use persistent state. The e2e harness must reset and close all of them to guarantee isolation. Here is the complete inventory and how each is handled:

| Store | Singleton getter | Reset function | Close function | E2E strategy |
|-------|-----------------|----------------|----------------|--------------|
| Conversation | `getConversationStore()` | `resetConversationStore()` | `closeConversationStore()` | Points at temp DB; close + reset in teardown |
| Memory | `getMemoryStore()` | `resetMemoryStore()` | `closeMemoryStore()` | Points at temp DB; close + reset in teardown |
| Credentials | `getCredentialStore()` | `resetCredentialStore()` | (none needed) | Uses `memory` provider (no file); reset in teardown |
| User Config | `getUserConfigStore()` | `resetUserConfigStore()` | runtime-guarded `close()` call | Backed by SQLite; close if present, then reset |
| UI Storage | `getStorage()` | `resetProviders()` | (none needed) | Points at temp dir; reset in teardown; temp dir deleted |
| UI Shortener | `getShortener()` | `resetProviders()` | (none needed) | Uses `memory` provider; reset in teardown |

The harness's `stop()` method executes this sequence:

    async stop(): Promise<void> {
      // 1. Close SQLite connections (must happen before file deletion)
      closeConversationStore();
      closeMemoryStore();
      const userConfigStore = getUserConfigStore() as unknown as { close?: () => void };
      if (typeof userConfigStore.close === 'function') {
        userConfigStore.close();
      }

      // 2. Reset all singletons so the next test run gets fresh instances
      resetConversationStore();
      resetMemoryStore();
      resetCredentialStore();
      resetUserConfigStore();
      resetProviders(); // UI storage + shortener

      // 3. Delete the entire temp directory
      fs.rmSync(E2E_TEMP_ROOT, { recursive: true, force: true });
    }

This guarantees that after `stop()`: no database files remain, no singletons hold stale references, and a subsequent test run starts completely fresh. The `data/` directory in the working tree is never touched.

**tests/e2e/harness.ts** (new file). A class that encapsulates the send-message-and-wait-for-response pattern. The harness:

1. Uses a consistent phone number for all messages in a test (default: `+15551234567`).
2. Builds a Twilio webhook payload for each message (using existing `createSmsPayload` from `tests/fixtures/webhook-payloads.ts`).
3. Computes a valid Twilio signature so the handler's validation passes.
4. Calls `handleSmsWebhook(req, res)` directly with a mock request/response.
5. Waits for the async response to appear in the Twilio outbound mock's sent messages array. Uses polling with a configurable timeout (default: 90 seconds).
6. Returns the response text (async response if available, otherwise sync TwiML response).
7. After each turn completes, reads the per-turn trace log file for that turn.

**Log capture via TraceLogger files.** The codebase already has a `TraceLogger` (`src/utils/trace-logger.ts`) that writes a detailed per-turn log file during development. Each orchestration request creates one file at `{TRACE_LOG_DIR}/{YYYY-MM-DD}/{HH-mm-ss}_{requestId}.log` containing the full trace: LLM requests/responses, tool executions, plan events, step events, and errors.

The e2e setup points `TRACE_LOG_DIR` at the temp directory (alongside the databases and UI pages):

    process.env.TRACE_LOG_DIR = path.join(E2E_TEMP_DIR, 'logs');

Since `NODE_ENV` is set to `development`, the TraceLogger is active and writes log files for each orchestration request.

After each `sendMessage` call, the harness scans the trace log directory for new files that appeared since the previous scan. It reads each new file in full and stores it as the log for that turn:

    interface TurnLog {
      turnNumber: number;
      filePath: string;
      content: string;  // Full text of the trace log file
    }

    // After waitForAsyncResponse completes:
    private async collectTurnLog(turnNumber: number): Promise<TurnLog | null> {
      const logDir = process.env.TRACE_LOG_DIR!;
      const dateDir = new Date().toISOString().split('T')[0];
      const fullDir = path.join(logDir, dateDir);
      if (!fs.existsSync(fullDir)) return null;

      const files = fs.readdirSync(fullDir).sort();
      const newFiles = files.filter(f => !this.seenLogFiles.has(f));
      if (newFiles.length === 0) return null;

      // Take the most recent new file (there should be exactly one per turn)
      const logFile = newFiles[newFiles.length - 1];
      this.seenLogFiles.add(logFile);
      const filePath = path.join(fullDir, logFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      return { turnNumber, filePath, content };
    }

The harness exposes a single log accessor:
- `getTurnLogs()`: returns all collected `TurnLog` entries (one per turn).

No mechanical log parsing (event scanning, error checking, regex matching) is done by the harness. The full trace log content for each turn is passed to the LLM judge, which analyzes it qualitatively. This keeps the harness simple and avoids brittle assertions that break when log format changes.

The harness also exposes:
- `getConversationHistory()`: returns all messages stored in the conversation database for the test phone number.
- `reset()`: clears conversation history, memory facts, and Twilio sent messages between tests. Does NOT close SQLite connections or reset singletons — that is `stop()`'s job. `reset()` is for between-test cleanup within a single suite run.
- `extractShortUrl(responseText)`: extracts the generated `/u/:id` link from assistant response text (see extraction logic below).
- `fetchPageHtml(shortUrl)`: resolves short URL through the real shortener and fetches the stored HTML via the real UI storage provider.
- `judgeConversation(criteria)`: sends the full conversation transcript (all user messages, assistant responses, generated page HTML, and per-turn trace logs) to the judge module, asking it to evaluate the conversation against the provided criteria. Returns a structured verdict.

**`extractShortUrl` implementation.** The LLM may format URLs in several ways: bare (`http://localhost:3000/u/abc`), markdown (`[link](http://localhost:3000/u/abc)`), with trailing punctuation (`http://localhost:3000/u/abc.`), or protocol-less. The extraction regex must handle all of these:

    extractShortUrl(responseText: string): string {
      // Match /u/<shortId> in any URL-like context, tolerating markdown and punctuation
      const match = responseText.match(/(?:https?:\/\/[^\s)\]]+)?\/u\/([a-zA-Z0-9_-]+)/);
      if (!match) {
        throw new Error(
          `No /u/:id short URL found in response. Full response text:\n${responseText}`
        );
      }
      return `/u/${match[1]}`;
    }

The error message includes the full response text so the developer can immediately see what the LLM returned and adjust the test prompt or extraction logic.

The `sendMessage` method is the core of the harness. Its implementation:

    async sendMessage(text: string, options?: { timeout?: number }): Promise<E2EResponse> {
      const timeout = options?.timeout ?? 90_000;
      const payload = createSmsPayload(text, this.phoneNumber);
      const signature = getExpectedTwilioSignature(authToken, webhookUrl, payload);

      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/webhook/sms',
        headers: { 'x-twilio-signature': signature },
        body: payload,
      });

      const sentBefore = getSentMessages().length;
      await handleSmsWebhook(req, res);

      // Extract sync response from TwiML
      const syncResponse = extractTwimlMessage(res.text ?? '');

      // Wait for async response (if any)
      const asyncResponse = await this.waitForAsyncResponse(sentBefore, timeout);

      // Collect the trace log file for this turn
      await this.collectTurnLog(this.turnCount++);

      return {
        syncResponse,
        asyncResponse: asyncResponse?.body ?? null,
        finalResponse: asyncResponse?.body ?? syncResponse,
      };
    }

The `waitForAsyncResponse` method polls `getSentMessages()` at 500ms intervals until a new message appears or the timeout expires. On each poll iteration, it also checks the trace log directory for a completed log file (the TraceLogger writes a footer with `SUCCESS` or `FAILED` when orchestration finishes). If a log file with a `FAILED` footer appears but no outbound message has been enqueued (indicating the error-message fallback also failed), the method returns early with a diagnostic error instead of hanging until timeout. If no new message appears and no completed log file is detected, it returns null (meaning the sync response was the final response).

The `E2EResponse` type:

    interface E2EResponse {
      syncResponse: string;        // The TwiML immediate response
      asyncResponse: string | null; // The Twilio API async response (null if none)
      finalResponse: string;        // The most complete response (async if available, else sync)
    }

**LLM judge implementation.** The judge logic lives in a separate module (`tests/e2e/judge.ts`) rather than inline in the harness class. This separation enables reuse: the same judge can evaluate conversations from the test harness or from a production database query (see "Production Conversation Analysis" section below).

The harness's `judgeConversation` method delegates to the judge module:

    // In harness.ts
    async judgeConversation(criteria: JudgeCriteria): Promise<JudgeVerdict> {
      const history = await this.getConversationHistory();
      return judge({
        messages: history,
        generatedPages: this.generatedPages,
        turnLogs: this.turnLogs,
        criteria,
      });
    }

The judge module (`tests/e2e/judge.ts`) accepts a `JudgeInput` and returns a `JudgeVerdict`:

    // tests/e2e/judge.ts
    import Anthropic from '@anthropic-ai/sdk';

    export interface JudgeInput {
      messages: ConversationMessage[];
      generatedPages?: Map<string, string>;  // shortUrl → HTML
      turnLogs?: TurnLog[];
      criteria: string[];
    }

    export async function judge(input: JudgeInput): Promise<JudgeVerdict> {
      try {
        const transcript = formatTranscript(input.messages, input.generatedPages);
        const logSection = input.turnLogs?.length
          ? `\n\nTRACE LOGS (${input.turnLogs.length} turns):\n${input.turnLogs.map(t => `--- Turn ${t.turnNumber} ---\n${t.content}`).join('\n\n')}`
          : '\n\nTRACE LOGS: None';

        const client = new Anthropic();
        const response = await client.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `You are evaluating a multi-turn conversation between a user and an SMS assistant.

    CONVERSATION TRANSCRIPT:
    ${transcript}
    ${logSection}

    EVALUATION CRITERIA:
    ${input.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

    For each criterion, respond with PASS or FAIL and a one-sentence explanation.
    Then give an overall verdict: PASS (all criteria met) or FAIL (any criterion failed).
    If trace logs are provided, factor them into your evaluation — errors during orchestration that did not prevent a correct final result are acceptable, but errors that indicate data loss, corruption, or silent failures should result in a FAIL.

    Respond in JSON:
    {
      "criteria": [
        { "criterion": "...", "verdict": "PASS|FAIL", "reason": "..." }
      ],
      "overall": "PASS|FAIL",
      "summary": "One-sentence overall assessment"
    }`,
          }],
        });

        return safeParseJudgeVerdict(response.content[0].text);
      } catch (error) {
        return {
          criteria: [],
          overall: 'FAIL',
          summary: `Judge call failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    /**
     * Build a JudgeInput from a production conversation database query.
     * This enables reusing the judge for diagnosing production errors.
     */
    export async function fromDatabase(
      phoneNumber: string,
      options?: { since?: Date; limit?: number },
    ): Promise<Omit<JudgeInput, 'criteria'>> {
      const { getConversationStore } = await import(
        '../../src/services/conversation/index.js'
      );
      const store = getConversationStore();
      const messages = await store.getHistory(phoneNumber, {
        since: options?.since?.getTime(),
        limit: options?.limit ?? 50,
      });
      return { messages, generatedPages: undefined, turnLogs: undefined };
    }

The `JudgeCriteria` type is simply `string[]` — an array of plain-English evaluation criteria. The `JudgeVerdict` type:

    type JudgeCriteria = string[];

    interface JudgeVerdict {
      criteria: Array<{
        criterion: string;
        verdict: 'PASS' | 'FAIL';
        reason: string;
      }>;
      overall: 'PASS' | 'FAIL';
      summary: string;
    }

The `formatTranscript` helper builds a readable transcript that includes message role, content, and (for assistant messages that generated a page) the HTML content of that page. This gives the judge full visibility into what was produced.

`safeParseJudgeVerdict` should:
- Attempt `JSON.parse(rawText)` first.
- If that fails, extract a JSON object from fenced markdown and parse it.
- If parsing still fails, return:

    {
      criteria: [],
      overall: 'FAIL',
      summary: 'Judge output was not valid JSON; verdict recorded as diagnostic failure.',
    }

**package.json modification.** Add a `test:e2e` script:

    "test:e2e": "vitest run --config vitest.e2e.config.ts"

Verification for Milestone 1: run `npm run test:e2e`. With no `ANTHROPIC_API_KEY` set, all tests should be skipped with a message indicating the key is required. With a valid key, the skeleton test should pass (it will be a trivial assertion just to verify the harness initializes).


### Milestone 2: Mock Layer for External Services

This milestone creates the mock modules that the e2e setup imports. The goal is to intercept outbound calls to Twilio and Google APIs so the tests run without real external service accounts. The UI path is intentionally not mocked.

**tests/e2e/mocks/twilio.ts** (new file). This is structurally identical to the existing `tests/mocks/twilio.ts`. It uses `vi.mock('twilio', ...)` to replace the Twilio SDK with a mock that captures outbound messages in an array. The `validateRequest` and `getExpectedTwilioSignature` functions are preserved from the real SDK (they are used to compute valid signatures for inbound webhook simulation). The mock exports `getSentMessages()` and `clearSentMessages()` for the harness to use. This can likely re-export or directly reuse `tests/mocks/twilio.ts`.

**tests/e2e/mocks/google.ts** (new file). This mock needs to handle two layers:

Layer 1 — Credential store seeding. The harness's `start()` method seeds fake Google OAuth credentials into the in-memory credential store for the test phone number. This ensures `getAuthenticatedClient()` finds credentials and does not throw `AuthRequiredError`.

    const store = getCredentialStore();
    await store.set(phoneNumber, 'google', {
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
      expiresAt: Date.now() + 3_600_000, // 1 hour from now
    });

Layer 2 — Google API method stubs. The mock intercepts the provider functions that create Google API clients. Instead of mocking the entire `googleapis` module (which has a large surface area), the mock replaces the provider-level functions that tools call. Specifically, it mocks these modules:

- `src/domains/drive/providers/google-drive.ts` — the module that exports functions used by Drive tools. The mock returns a fake Drive client whose methods (`files.create`, `files.list`, `files.get`, `files.update`, `files.delete`) return plausible response objects.
- `src/domains/drive/providers/google-sheets.ts` — returns a fake Sheets client whose methods (`spreadsheets.create`, `spreadsheets.values.get`, `spreadsheets.values.update`, `spreadsheets.values.append`) return plausible responses.
- `src/domains/drive/providers/google-docs.ts` — returns a fake Docs client whose methods (`documents.create`, `documents.get`, `documents.batchUpdate`) return plausible responses.
- `src/domains/calendar/providers/google-calendar.ts` — returns a fake Calendar client (can reuse the existing `tests/mocks/google-calendar.ts` pattern).
- `src/domains/email/providers/gmail.ts` — returns a fake Gmail client.
- `src/domains/google-core/providers/auth.ts` — mock `getAuthenticatedClient` to return a fake OAuth2Client, and mock `refreshAccessToken` to return fresh fake tokens. This prevents any real HTTP calls to Google's token endpoint.

The mock responses should be realistic enough that the LLM tools can parse them without errors. For example, `files.create` should return `{ data: { id: 'fake-file-id', name: 'Grocery List', webViewLink: 'https://docs.google.com/fake/123' } }`.

A practical implementation approach: use `vi.mock()` with factory functions for each provider module. The factories return objects with the same exported function signatures but backed by `vi.fn()` stubs.

**No UI mocks in e2e.** Do not mock:
- `src/domains/ui/runtime/agent.ts`
- `src/domains/ui/runtime/tools.ts`
- `src/services/ui/index.ts`
- `src/services/ui/provider-factory.ts`

The e2e test must exercise real page generation, real short URL resolution, and real HTML retrieval from local test storage.

Verification for Milestone 2: the mocks should be importable without errors. A small test that calls `getAuthenticatedClient` should return a fake client. A test that calls a tool handler (e.g., `create_document`) should return a plausible response without making network calls.


### Milestone 3: Smoke Test and Grocery List Multi-Turn Test

This milestone implements two end-to-end tests: a minimal smoke test that validates infrastructure, and the grocery list multi-turn scenario.

**tests/e2e/smoke.test.ts** (new file). A minimal test that sends "Hello" and expects any non-error response. This validates harness setup, mocking, provider wiring, and the basic classify → orchestrate → respond flow without depending on specific agent routing or UI generation. If this test fails, the problem is infrastructure, not LLM behavior.

    describeE2E('Smoke test', () => {
      let harness: E2EHarness;

      beforeAll(async () => {
        harness = new E2EHarness();
        await harness.start();
      });

      afterAll(async () => {
        await harness.stop();
      });

      it('responds to a simple greeting without errors', async () => {
        const result = await harness.sendMessage('Hello!');

        // Any non-empty response is acceptable
        expect(result.finalResponse).toBeTruthy();
        expect(result.finalResponse.length).toBeGreaterThan(0);

        // Trace log file was produced
        expect(harness.getTurnLogs().length).toBe(1);
      }, 60_000);
    });

**tests/e2e/multi-turn/grocery-list.test.ts** (new file).

    import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
    import { E2EHarness } from '../harness.js';

    const hasApiKey = process.env.ANTHROPIC_API_KEY
      && process.env.ANTHROPIC_API_KEY !== 'test-api-key';

    const describeE2E = hasApiKey ? describe : describe.skip;

    describeE2E('Multi-turn: Grocery List', () => {
      let harness: E2EHarness;

      beforeAll(async () => {
        harness = new E2EHarness();
        await harness.start();
      });

      beforeEach(async () => {
        await harness.reset();
      });

      afterAll(async () => {
        await harness.stop();
      });

      it('creates grocery-list UI, then uses multi-turn history to regenerate with hummus on turn 2', async () => {
        const initialItems = ['eggs', 'milk', 'bread', 'butter'];

        // ── Turn 1: Natural grocery list request ──
        const turn1 = await harness.sendMessage(
          'Create a grocery list with eggs, milk, bread and butter'
        );

        // Deterministic: extract URL and verify HTML contains all items
        const firstUrl = harness.extractShortUrl(turn1.finalResponse);
        const firstHtml = (await harness.fetchPageHtml(firstUrl)).toLowerCase();
        for (const item of initialItems) {
          expect(firstHtml).toContain(item);
        }

        // ── Turn 2: intentionally omits original items to force history retrieval ──
        const turn2 = await harness.sendMessage(
          'Add hummus and regenerate the page. Return the new link.'
        );

        // Deterministic: new URL, HTML contains all original items plus hummus
        const secondUrl = harness.extractShortUrl(turn2.finalResponse);
        expect(secondUrl).not.toBe(firstUrl);

        const secondHtml = (await harness.fetchPageHtml(secondUrl)).toLowerCase();
        for (const item of [...initialItems, 'hummus']) {
          expect(secondHtml).toContain(item);
        }

        // ── LLM Judge: analyzes conversation transcript + full trace logs ──
        const verdict = await harness.judgeConversation([
          'The assistant correctly created a grocery list with all four requested items (eggs, milk, bread, butter) on turn 1.',
          'The assistant correctly interpreted "add hummus" on turn 2 as adding to the existing grocery list, not creating a new unrelated list.',
          'The turn 2 grocery list contains all five items (the original four plus hummus) — nothing was forgotten.',
          'The assistant provided a working link in each response.',
          'The conversation flow is natural and coherent — the assistant understood the user intent without confusion or unnecessary clarification.',
          'No errors in the trace logs indicate data loss, silent failures, or corrupted state.',
        ]);

        // Log the full verdict as a readable diagnostic (not a hard gate)
        console.log('\n── LLM Judge Verdict ──');
        for (const c of verdict.criteria) {
          console.log(`  ${c.verdict === 'PASS' ? '✓' : '✗'} ${c.criterion}`);
          console.log(`    → ${c.reason}`);
        }
        console.log(`  Overall: ${verdict.overall} — ${verdict.summary}`);
        console.log('── End Judge Verdict ──\n');
        expect(['PASS', 'FAIL']).toContain(verdict.overall);
      }, 240_000); // 4 minute timeout: 2 LLM turns + judge call
    });

The test allows LLM phrasing variance in SMS text, but the critical assertions are deterministic: extract generated URL, resolve it, fetch stored HTML, verify list item presence. The LLM judge receives the full conversation transcript and per-turn trace logs and provides qualitative analysis.

The `describeE2E` guard ensures the test is skipped when no valid API key is available. This prevents CI failures when the key is not configured.

Verification for Milestone 3: run `ANTHROPIC_API_KEY=sk-ant-... npm run test:e2e`. The test should complete within 5 minutes. Both turns should return responses containing generated `/u/:id` links. Turn 1 HTML should include the initial items. Turn 2 HTML should include all initial items plus hummus, proving multi-turn context continuity. The LLM judge evaluates the full conversation and trace logs and returns a structured diagnostic verdict that is logged for inspection.


### Future Work: Media Attachment Harness Support

This section documents the design for extending the harness to support media attachments in future tests (e.g., "send a photo of a grocery list, then ask to add an item"). This is not a milestone — it produces no code or trackable artifact in this plan. It is preserved here as a design reference for when media tests are needed.

To support media in the harness, `sendMessage` needs an optional `media` parameter:

    interface MediaOption {
      contentType: string;  // e.g., 'image/jpeg'
      url: string;          // Mock Twilio CDN URL
      mockContent: Buffer;  // The actual file bytes to return when downloaded
    }

    async sendMessage(text: string, options?: {
      timeout?: number;
      media?: MediaOption[];
    })

When media is provided, the harness:

1. Adds `NumMedia`, `MediaUrl0`, `MediaContentType0`, etc. fields to the webhook payload.
2. Registers the mock URLs with a mock HTTP fetcher so `processMediaAttachments` can download them.
3. Mocks the Gemini pre-analysis call (in `src/services/media/pre-analyze.ts`) to return a canned summary.

The mock HTTP fetcher can be implemented via `vi.mock` on the `node-fetch` or native `fetch` module, or by mocking the `downloadMediaBuffers` function in `src/services/media/process.ts`.

For the Gemini pre-analysis mock, the simplest approach is to mock the `preAnalyzeMedia` function in `src/services/media/pre-analyze.ts` to return a fixed `CurrentMediaSummary[]` array.

A future test for the "photo of a grocery list" scenario would:

1. Load a test image from `tests/e2e/fixtures/grocery-receipt.jpg`.
2. Send it with `sendMessage('What items are on this receipt?', { media: [{ contentType: 'image/jpeg', url: 'https://api.twilio.com/fake/media/1', mockContent: imageBuffer }] })`.
3. The assistant would process the image (via the drive-agent's `analyze_image` tool or Gemini pre-analysis) and respond with a list of items.
4. Send a follow-up: `sendMessage('Add hummus to the list')`.
5. Assert the response includes hummus and the original items from the receipt.

This design is sufficient to guide implementation when media tests are needed.


## Production Conversation Analysis

The judge module (`tests/e2e/judge.ts`) is designed to be reusable beyond tests. The `fromDatabase()` factory loads a real conversation from the production (or dev) SQLite database and returns a `JudgeInput` that can be passed to `judge()` with custom criteria.

**Usage from a script or REPL:**

    import { judge, fromDatabase } from './tests/e2e/judge.js';

    const input = await fromDatabase('+15551234567', { since: new Date('2026-02-22T10:00:00Z') });
    const verdict = await judge({
      ...input,
      criteria: [
        'Did the assistant correctly handle the user request?',
        'Was multi-turn context maintained?',
        'Were there any errors that affected the response quality?',
      ],
    });
    console.log(verdict.summary);

**What this gives you:** When you spot an error in production logs, you can point the judge at that phone number and time window to get a structured evaluation of what went wrong from the conversation's perspective. The judge sees the same transcript the user experienced.

**What it does NOT give you:** orchestrator-level diagnostics (plan steps, agent selections, tool calls). Those are emitted as structured JSON logs to stdout and are not persisted to a queryable store today. If production log analysis via the judge becomes valuable, persisting orchestrator events to a `logs` table would be a separate enhancement.

**No CLI script is included in this plan.** The `fromDatabase` + `judge` API is sufficient. A CLI wrapper (`npm run diagnose -- --phone ... --since ...`) can be added in ~40 lines when the need arises.


## Concrete Steps

All commands are run from the repository root (`/mnt/c/Code/hermes-assistant`) in WSL.

Step 1: Create the e2e test directory structure.

    mkdir -p tests/e2e/mocks tests/e2e/multi-turn

Step 2: Create `vitest.e2e.config.ts` at the repository root (content as described in Milestone 1).

Step 3: Create `tests/e2e/setup.ts` (content as described in Milestone 1, including all 7 provider wiring calls).

Step 4: Create `tests/e2e/judge.ts` (content as described in Milestone 1 — judge module with `judge()` and `fromDatabase()`).

Step 5: Create `tests/e2e/harness.ts` (content as described in Milestone 1, delegating to judge module).

Step 6: Create `tests/e2e/mocks/twilio.ts` (content as described in Milestone 2).

Step 7: Create `tests/e2e/mocks/google.ts` (content as described in Milestone 2).

Step 8: Create `tests/e2e/smoke.test.ts` (content as described in Milestone 3).

Step 9: Create `tests/e2e/multi-turn/grocery-list.test.ts` (content as described in Milestone 3).

Step 10: Add `"test:e2e": "vitest run --config vitest.e2e.config.ts"` to `package.json` scripts.

Step 11: Run the e2e test without an API key to verify skip behavior:

    npm run test:e2e

    Expected output: test suite is skipped with a message about missing API key.

Step 12: Run the e2e test with a real API key:

    ANTHROPIC_API_KEY=sk-ant-... npm run test:e2e

    Expected output: smoke test and grocery-list UI test pass, showing generated URLs and successful HTML-content assertions.

Step 13: Verify existing tests still pass:

    npm run test:unit && npm run test:integration

    Expected output: all existing tests pass unchanged.


## Validation and Acceptance

The change is accepted when:

1. `npm run test:e2e` (without `ANTHROPIC_API_KEY`) completes in under 5 seconds and reports all tests as skipped.

2. `ANTHROPIC_API_KEY=<valid-key> npm run test:e2e` completes within 5 minutes. The smoke test passes (any non-error response to "Hello!"). The grocery-list UI + multi-turn continuity test passes one deterministic verification layer plus one diagnostic layer:

   a. **UI generation (deterministic)**: turn 1 returns a valid generated UI URL whose HTML includes all four initial grocery items; turn 2 returns a different URL whose HTML includes all four original items plus hummus.

   b. **LLM judge (diagnostic-only)**: the judge receives the full conversation transcript (messages + generated page HTML + per-turn trace logs) and evaluates against 6 criteria covering correctness, intent inference, completeness, link presence, conversational coherence, and absence of concerning errors in the trace logs. Its verdict is logged for debugging and trend monitoring, but does not determine pass/fail.

3. `npm run test:unit && npm run test:integration` passes unchanged — the e2e infrastructure does not affect existing tests.

4. `npm run lint` passes — all new files follow project ESLint rules.

5. `npm run build` passes — no type errors introduced.


## Idempotence and Recovery

All steps can be run multiple times safely. Each test run creates a unique temp directory under `os.tmpdir()` (e.g., `/tmp/hermes-e2e-a1b2c3d4/`). Cleanup happens in two layers: primary cleanup in `harness.stop()`, and best-effort process-exit cleanup registered in `tests/e2e/setup.ts` so skipped or aborted runs do not leave persistent artifacts in normal cases. No files are created in the working tree's `data/` directory. No production data is affected.

If a test run is interrupted before `stop()` runs, orphaned temp directories may remain in the OS temp directory. These are harmless and will be cleaned up by the OS's periodic temp cleanup, or can be deleted manually:

    rm -rf /tmp/hermes-e2e-*

The developer's `./data/` directory (conversation.db, memory.db, credentials.db, pages/) is never read or written by e2e tests.


## Artifacts and Notes

Example expected test output (with real API key):

     PASS  tests/e2e/smoke.test.ts (12.3s)
       Smoke test
         ✓ responds to a simple greeting without errors (10200ms)

     PASS  tests/e2e/multi-turn/grocery-list.test.ts (68.4s)
       Multi-turn: Grocery List
         ✓ creates grocery-list UI, then uses multi-turn history to regenerate with hummus on turn 2 (65200ms)

     Test Files  2 passed (2)
          Tests  2 passed (2)

The actual LLM responses will vary between runs. Example turn 1 response:

    "I made your grocery list page: http://localhost:3000/u/abc123"

Example turn 2 response:

    "Updated list with hummus: http://localhost:3000/u/def456"

Example LLM judge output (logged to console):

    ── LLM Judge Verdict ──
      ✓ The assistant correctly created a grocery list...
        → All four items appear in the generated HTML.
      ✓ The assistant correctly interpreted 'add hummus'...
        → The assistant added hummus to the existing list rather than starting over.
      ✓ The turn 2 grocery list contains all five items...
        → eggs, milk, bread, butter, and hummus all present in turn 2 HTML.
      ✓ The assistant provided a working link...
        → Both responses include /u/ short URLs.
      ✓ The conversation flow is natural...
        → The assistant understood the follow-up without confusion.
      ✓ No concerning error logs...
        → No fatal error-level entries in trace logs.
      Overall: PASS — The assistant correctly maintained context across turns and generated complete grocery lists.
    ── End Judge Verdict ──


## Interfaces and Dependencies

**New npm scripts** (in `package.json`):

    "test:e2e": "vitest run --config vitest.e2e.config.ts"

**New files and their exports:**

In `tests/e2e/harness.ts`:

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

    export interface TurnLog {
      turnNumber: number;
      filePath: string;
      content: string;
    }

    export interface E2EResponse {
      syncResponse: string;
      asyncResponse: string | null;
      finalResponse: string;
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

In `tests/e2e/judge.ts`:

    export interface JudgeInput {
      messages: ConversationMessage[];
      generatedPages?: Map<string, string>;
      turnLogs?: TurnLog[];
      criteria: string[];
    }

    export async function judge(input: JudgeInput): Promise<JudgeVerdict>;

    /** Load a conversation from the production/dev database for judge analysis. */
    export async function fromDatabase(
      phoneNumber: string,
      options?: { since?: Date; limit?: number },
    ): Promise<Omit<JudgeInput, 'criteria'>>;

In `tests/e2e/mocks/twilio.ts`:

    export function getSentMessages(): SentMessage[];
    export function clearSentMessages(): void;

In `tests/e2e/mocks/google.ts`:

    export function seedGoogleCredentials(phoneNumber: string): Promise<void>;
    export function clearGoogleMocks(): void;

**External dependencies** (already in package.json, no new installs needed):

- `vitest` — test framework
- `@anthropic-ai/sdk` — real SDK (not mocked in e2e)
- `twilio` — mocked for outbound, real for signature validation
- `better-sqlite3` — real SQLite for conversation/memory databases
- `googleapis` — mocked at provider level

**Environment variables consumed by e2e tests:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes (or tests skip) | — | Real Anthropic API key |
| `TRACE_LOG_DIR` | No | `{E2E_TEMP_DIR}/logs` (set by setup) | Per-turn trace log file directory |
| `CLASSIFIER_MODEL_ID` | No | `claude-opus-4-5-20251101` (from config.ts) | Model for classification |
| `PLANNER_MODEL_ID` | No | `claude-opus-4-5-20251101` (from config.ts) | Model for planning |
| `AGENT_MODEL_ID` | No | `claude-opus-4-5-20251101` (from config.ts) | Model for agent execution |
| `COMPOSER_MODEL_ID` | No | `claude-opus-4-5-20251101` (from config.ts) | Model for response synthesis |

---

Revision Note (2026-02-22): Updated setup/teardown and validation details to reduce flakiness and strengthen isolation. The plan now requires per-test harness reset, user-config store closure in teardown, idempotent console restoration, best-effort temp-dir cleanup on process exit, corrected acceptance numbering, and timestamped Progress entries. The LLM judge remains in the plan as a diagnostic signal only (not a hard pass/fail gate), while deterministic assertions remain authoritative.

Revision Note (2026-02-22, review): Addressed review findings: (1) Documented model cost and env-var override path for cheaper iteration. (2) Specified `extractShortUrl` regex with full-response-text error messages. (3) Added async failure early-exit to `waitForAsyncResponse` via TraceLogger footer monitoring. (4) Enumerated all 7 provider wiring calls required in setup. (5) Added infrastructure smoke test. (6) Extracted judge into reusable `tests/e2e/judge.ts` module with `fromDatabase()` factory for production conversation analysis. (7) Demoted media attachment design from tracked milestone to future-work appendix. (8) Clarified `reset()` vs `stop()` responsibilities. (9) Changed judge model from Opus to Sonnet (judge doesn't need Opus-level reasoning, and saves cost). (10) Improved judge output formatting in tests for readability. (11) Replaced console.log/console.error interception with per-turn TraceLogger file reading — the harness exposes a single `getTurnLogs()` accessor and all log analysis is done by the LLM judge, not mechanically. (12) Simplified turn 1 prompt to natural language ("Create a grocery list with eggs, milk, bread and butter"). (13) Removed conversation history assertions — only URL presence and HTML content are asserted deterministically. (14) Added TraceLogger context to Context and Orientation section. (15) Added per-turn log decision to Decision Log.
