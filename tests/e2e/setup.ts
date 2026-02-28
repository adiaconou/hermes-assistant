/**
 * E2E test setup file.
 *
 * Sets environment variables BEFORE any application module imports.
 * This is critical because src/config.ts reads env vars at import time.
 *
 * All persistent stores point at a unique temp directory per test run
 * so nothing is written to the working tree's data/ directory.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

// ── Create a unique temp directory for this test run ──
const E2E_TEMP_DIR = path.join(os.tmpdir(), `hermes-e2e-${randomUUID().slice(0, 8)}`);
fs.mkdirSync(E2E_TEMP_DIR, { recursive: true });

// ── Point ALL persistent stores at the temp directory ──
// NODE_ENV=development enables TraceLogger file writing (per-turn log files)
process.env.NODE_ENV = 'development';
process.env.CONVERSATION_DB_PATH = path.join(E2E_TEMP_DIR, 'conversation.db');
process.env.MEMORY_SQLITE_PATH = path.join(E2E_TEMP_DIR, 'memory.db');
process.env.CREDENTIAL_STORE_PROVIDER = 'memory';
process.env.CREDENTIAL_STORE_SQLITE_PATH = path.join(E2E_TEMP_DIR, 'credentials.db');
process.env.UI_LOCAL_STORAGE_PATH = path.join(E2E_TEMP_DIR, 'pages');
process.env.UI_SHORTENER_PROVIDER = 'memory';
process.env.TRACE_LOG_DIR = path.join(E2E_TEMP_DIR, 'logs');
process.env.MEMORY_PROCESSOR_ENABLED = 'false';
process.env.EMAIL_WATCHER_ENABLED = 'false';

// ANTHROPIC_API_KEY: intentionally NOT set — comes from real env
// Model IDs: NOT overridden — inherits production defaults from config.ts

// ── Twilio test values (same as tests/setup.ts) ──
process.env.TWILIO_ACCOUNT_SID = 'test-account-sid';
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
process.env.TWILIO_PHONE_NUMBER = '+15555550000';
process.env.BASE_URL = 'http://localhost:3000';
process.env.CREDENTIAL_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.OAUTH_STATE_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

// ── Export for harness teardown ──
export const E2E_TEMP_ROOT = E2E_TEMP_DIR;

// ── Best-effort cleanup even if tests are skipped or aborted ──
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

// ── Import mocks (Twilio, Google, typing indicator; NOT Anthropic — real SDK is used) ──
// vi.mock() calls inside these files are hoisted by vitest regardless of import order.
import './mocks/twilio.js';
import './mocks/google.js';
import './mocks/typing-indicator.js';

// ── Wire ALL domain executor providers ──
// IMPORTANT: These must be dynamic imports (await import) because static imports
// are hoisted above the process.env assignments. Static imports would cause
// config.ts to load before env vars are set, reading from .env/real env instead
// of our test values.
const { executeWithTools } = await import('../../src/executor/tool-executor.js');
const { setCalendarExecuteWithTools } = await import('../../src/domains/calendar/providers/executor.js');
const { setMemoryExecuteWithTools } = await import('../../src/domains/memory/providers/executor.js');
const { setEmailExecuteWithTools } = await import('../../src/domains/email/providers/executor.js');
const { setDriveExecuteWithTools } = await import('../../src/domains/drive/providers/executor.js');
const { setUiExecuteWithTools } = await import('../../src/domains/ui/providers/executor.js');
const { setSkillsExecuteWithTools } = await import('../../src/domains/skills/providers/executor.js');
const { setEmailWatcherExecuteWithTools } = await import('../../src/domains/email-watcher/providers/executor.js');
const { setExecuteWithTools } = await import('../../src/domains/scheduler/providers/executor.js');

setCalendarExecuteWithTools(executeWithTools);
setMemoryExecuteWithTools(executeWithTools);
setEmailExecuteWithTools(executeWithTools);
setDriveExecuteWithTools(executeWithTools);
setUiExecuteWithTools(executeWithTools);
setSkillsExecuteWithTools(executeWithTools);
setEmailWatcherExecuteWithTools(executeWithTools);
setExecuteWithTools(executeWithTools);

// ── Log active model IDs at startup ──
const config = (await import('../../src/config.js')).default;
console.log(JSON.stringify({
  event: 'e2e_setup',
  tempDir: E2E_TEMP_DIR,
  models: {
    classifier: config.models.classifier,
    planner: config.models.planner,
    agent: config.models.agent,
    composer: config.models.composer,
  },
}));
