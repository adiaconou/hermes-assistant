/**
 * @fileoverview Express server entry point for the Hermes SMS Assistant.
 *
 * This module bootstraps the Express application, configures middleware,
 * and mounts route handlers. In Phase 1 (current), it serves as a simple
 * echo server to prove the SMS pipeline works end-to-end.
 *
 * @see docs/phase-1-requirements.md for Phase 1 specification
 */

import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config, { validateConfig } from './config.js';

// Fail fast if critical configuration is missing
validateConfig();
import smsRouter from './routes/sms.js';
import pagesRouter from './routes/pages.js';
import authRouter from './routes/auth.js';
import adminRouter from './admin/index.js';
import { healthHandler } from './routes/health.js';
import { initScheduler, stopScheduler } from './domains/scheduler/runtime/index.js';
import { READ_ONLY_TOOLS } from './tools/index.js';
import { setExecuteWithTools } from './domains/scheduler/providers/executor.js';
import { setEmailWatcherExecuteWithTools } from './domains/email-watcher/providers/executor.js';
import { setCalendarExecuteWithTools } from './domains/calendar/providers/executor.js';
import { setMemoryExecuteWithTools } from './domains/memory/providers/executor.js';
import { setEmailExecuteWithTools } from './domains/email/providers/executor.js';
import { setDriveExecuteWithTools } from './domains/drive/providers/executor.js';
import { setUiExecuteWithTools } from './domains/ui/providers/executor.js';
import { setSkillsExecuteWithTools } from './domains/skills/providers/executor.js';
import { initFilesystemSkills } from './domains/skills/runtime/index.js';
import { executeWithTools } from './executor/tool-executor.js';
import { closeConversationStore } from './services/conversation/index.js';
import { startMemoryProcessor, stopMemoryProcessor } from './domains/memory/service/processor.js';
import { closeMemoryStore } from './domains/memory/runtime/index.js';
import { startEmailWatcher, stopEmailWatcher } from './domains/email-watcher/runtime/index.js';
import { closeTwilioWebhookIdempotencyStore } from './services/twilio/webhook-idempotency.js';
import { closeOAuthStateNonceStore } from './services/auth/oauth-state-nonce.js';
import { initObservability } from './utils/observability/index.js';

initObservability();

const app = express();

// Parse URL-encoded bodies (Twilio sends this format)
app.use(express.urlencoded({ extended: false }));

// Health check endpoint
app.get('/health', healthHandler);

// SMS routes
app.use(smsRouter);

// OAuth routes
app.use(authRouter);

// Generated UI pages route
app.use(pagesRouter);

// Admin routes (memory management, etc.)
app.use(adminRouter);

// Initialize database for scheduler
const dbPath = config.credentials.sqlitePath;
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

// Wire executor for all domains (provider injection)
setExecuteWithTools(executeWithTools);
setEmailWatcherExecuteWithTools(executeWithTools);
setCalendarExecuteWithTools(executeWithTools);
setMemoryExecuteWithTools(executeWithTools);
setEmailExecuteWithTools(executeWithTools);
setDriveExecuteWithTools(executeWithTools);
setUiExecuteWithTools(executeWithTools);
setSkillsExecuteWithTools(executeWithTools);

// Initialize filesystem skills registry
initFilesystemSkills();

// Initialize scheduler (creates tables, sets up poller)
const poller = initScheduler(db, undefined, READ_ONLY_TOOLS.map(t => t.name));

const server = app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Server started',
      port: config.port,
      env: config.nodeEnv,
      timestamp: new Date().toISOString(),
    })
  );

  // Debug: Log presence of critical env vars (not values)
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Config check',
      hasCredentialEncryptionKey: !!config.credentials.encryptionKey,
      credentialEncryptionKeyLength: config.credentials.encryptionKey?.length ?? 0,
      hasOAuthStateEncryptionKey: !!config.oauth.stateEncryptionKey,
      oauthStateEncryptionKeyLength: config.oauth.stateEncryptionKey?.length ?? 0,
      hasGoogleClientId: !!config.google.clientId,
      hasGoogleClientSecret: !!config.google.clientSecret,
      googleRedirectUri: config.google.redirectUri,
      baseUrl: config.baseUrl,
      timestamp: new Date().toISOString(),
    })
  );

  if (config.nodeEnv === 'development' && process.env.SKIP_TWILIO_VALIDATION === 'true') {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'Twilio signature validation bypass is ACTIVE (development only)',
        baseUrl: config.baseUrl,
        port: config.port,
        timestamp: new Date().toISOString(),
      })
    );
  }

  // Start the scheduler poller after server is ready
  poller.start();

  // Start the memory processor
  startMemoryProcessor();

  // Start the email watcher
  startEmailWatcher();
});

let isShuttingDown = false;

// Graceful shutdown
async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Shutdown signal received',
      signal,
      timestamp: new Date().toISOString(),
    })
  );

  // Stop background pollers first, waiting for in-flight operations
  await Promise.all([
    stopScheduler(),
    stopMemoryProcessor(),
    stopEmailWatcher(),
  ]);

  // Then close database connections
  closeConversationStore();
  closeMemoryStore();
  closeTwilioWebhookIdempotencyStore();
  closeOAuthStateNonceStore();
  db.close();

  const forceExitTimer = setTimeout(() => {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'Force exiting after shutdown timeout',
        timestamp: new Date().toISOString(),
      })
    );
    process.exit(1);
  }, 10000);

  server.close(() => {
    clearTimeout(forceExitTimer);
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Server closed',
        timestamp: new Date().toISOString(),
      })
    );
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
