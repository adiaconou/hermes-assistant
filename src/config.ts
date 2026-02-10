/**
 * @fileoverview Centralized application configuration.
 *
 * All environment variables are loaded and validated here. This provides
 * a single source of truth for configuration and makes it easy to see
 * what external configuration the application requires.
 *
 * @see .env.example for required environment variables
 */

import 'dotenv/config';

// ---------------------------------------------------------------------------
// Config helpers — make required vs optional intent explicit
// ---------------------------------------------------------------------------

/** Read a required env var. Returns undefined if missing (caught by validateConfig). */
function required(key: string): string | undefined {
  return process.env[key];
}

/** Read an optional string env var with a default. */
function optional(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/** Read an optional integer env var with a default. */
function optionalInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  return raw ? parseInt(raw, 10) : defaultValue;
}

/** Read an optional float env var with a default. */
function optionalFloat(key: string, defaultValue: number): number {
  const raw = process.env[key];
  return raw ? parseFloat(raw) : defaultValue;
}

/** Read an optional boolean env var (defaults to `defaultValue`). */
function optionalBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  return raw !== (defaultValue ? 'false' : 'true') ? defaultValue : !defaultValue;
}

/** Return a path that differs between dev and production. */
function dbPath(envKey: string, prodPath: string, devPath: string): string {
  return process.env[envKey] || (process.env.NODE_ENV === 'production' ? prodPath : devPath);
}

// ---------------------------------------------------------------------------
// Config object
// ---------------------------------------------------------------------------

const config = {
  port: optionalInt('PORT', 3000),
  nodeEnv: optional('NODE_ENV', 'development'),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),

  /** Claude model IDs - centralized to avoid hardcoding across files */
  models: {
    classifier: optional('CLASSIFIER_MODEL_ID', 'claude-opus-4-5-20251101'),
    planner: optional('PLANNER_MODEL_ID', 'claude-opus-4-5-20251101'),
    agent: optional('AGENT_MODEL_ID', 'claude-opus-4-5-20251101'),
    composer: optional('COMPOSER_MODEL_ID', 'claude-opus-4-5-20251101'),
  },

  /** Twilio configuration for SMS */
  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },

  /** Google OAuth configuration */
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: optional('GOOGLE_REDIRECT_URI', 'http://localhost:3000/auth/google/callback'),
    sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID,
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: optional('GEMINI_MODEL', 'gemini-2.5-flash'),
  },

  /** Credential storage configuration */
  credentials: {
    provider: optional('CREDENTIAL_STORE_PROVIDER', 'sqlite') as 'sqlite' | 'memory',
    sqlitePath: dbPath('CREDENTIAL_STORE_SQLITE_PATH', '/app/data/credentials.db', './data/credentials.db'),
    encryptionKey: required('CREDENTIAL_ENCRYPTION_KEY'),
  },

  /** Memory system configuration */
  memory: {
    sqlitePath: dbPath('MEMORY_SQLITE_PATH', '/app/data/memory.db', './data/memory.db'),
    injectionThreshold: optionalFloat('MEMORY_INJECTION_THRESHOLD', 0.5),
  },

  /** Conversation storage configuration */
  conversation: {
    sqlitePath: dbPath('CONVERSATION_DB_PATH', '/app/data/conversation.db', './data/conversation.db'),
  },

  /** Async memory processor configuration */
  memoryProcessor: {
    intervalMs: optionalInt('MEMORY_PROCESSOR_INTERVAL_MS', 300000),
    batchSize: optionalInt('MEMORY_PROCESSOR_BATCH_SIZE', 100),
    perUserBatchSize: optionalInt('MEMORY_PROCESSOR_PER_USER_BATCH_SIZE', 25),
    enabled: optionalBool('MEMORY_PROCESSOR_ENABLED', true),
    modelId: optional('MEMORY_MODEL_ID', 'claude-opus-4-5-20251101'),
    logVerbose: optionalBool('MEMORY_LOG_VERBOSE', false),
  },

  /** Email watcher configuration */
  emailWatcher: {
    enabled: optionalBool('EMAIL_WATCHER_ENABLED', true),
    intervalMs: optionalInt('EMAIL_WATCHER_INTERVAL_MS', 60000),
    modelId: optional('EMAIL_WATCHER_MODEL_ID', 'claude-sonnet-4-5-20250929'),
    batchSize: optionalInt('EMAIL_WATCHER_BATCH_SIZE', 20),
    maxNotificationsPerHour: optionalInt('EMAIL_WATCHER_MAX_NOTIFICATIONS_PER_HOUR', 10),
    confidenceThreshold: optionalFloat('EMAIL_WATCHER_CONFIDENCE_THRESHOLD', 0.6),
  },

  /** Base URL for generating short links */
  baseUrl: optional('BASE_URL', 'http://localhost:3000'),

  /** UI generation configuration */
  ui: {
    storageProvider: optional('UI_STORAGE_PROVIDER', 'local') as 'local' | 's3',
    localStoragePath: optional('UI_LOCAL_STORAGE_PATH', './data/pages'),
    shortenerProvider: optional('UI_SHORTENER_PROVIDER', 'memory') as 'memory' | 'redis',
    shortenerPersistPath: process.env.UI_SHORTENER_PERSIST_PATH,
    pageTtlDays: optionalInt('PAGE_TTL_DAYS', 7),
  },

  /** AWS configuration (for Phase 4b production) */
  aws: {
    region: optional('AWS_REGION', 'us-east-1'),
    s3Bucket: process.env.AWS_S3_BUCKET,
  },

  /** Redis configuration (for Phase 4b production) */
  redis: {
    url: process.env.REDIS_URL,
  },
};

/**
 * Validate critical configuration at startup.
 * Throws if required values are missing or invalid.
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // Required API keys
  if (!config.anthropicApiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  // Twilio (required for SMS)
  if (!config.twilio.accountSid) errors.push('TWILIO_ACCOUNT_SID is required');
  if (!config.twilio.authToken) errors.push('TWILIO_AUTH_TOKEN is required');
  if (!config.twilio.phoneNumber) errors.push('TWILIO_PHONE_NUMBER is required');

  // Google OAuth (required for calendar/email/drive)
  if (!config.google.clientId) errors.push('GOOGLE_CLIENT_ID is required');
  if (!config.google.clientSecret) errors.push('GOOGLE_CLIENT_SECRET is required');

  // Encryption key validation
  if (!config.credentials.encryptionKey) {
    errors.push('CREDENTIAL_ENCRYPTION_KEY is required');
  } else if (!/^[0-9a-fA-F]{64}$/.test(config.credentials.encryptionKey)) {
    errors.push('CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  // Numeric bounds
  if (config.port < 1 || config.port > 65535) {
    errors.push(`PORT must be 1-65535, got ${config.port}`);
  }
  if (config.memoryProcessor.intervalMs < 1000) {
    errors.push(`MEMORY_PROCESSOR_INTERVAL_MS must be >= 1000, got ${config.memoryProcessor.intervalMs}`);
  }
  if (config.memoryProcessor.batchSize < 1) {
    errors.push(`MEMORY_PROCESSOR_BATCH_SIZE must be >= 1, got ${config.memoryProcessor.batchSize}`);
  }
  if (config.memory.injectionThreshold < 0 || config.memory.injectionThreshold > 1) {
    errors.push(`MEMORY_INJECTION_THRESHOLD must be 0-1, got ${config.memory.injectionThreshold}`);
  }
  if (config.ui.pageTtlDays < 1) {
    errors.push(`PAGE_TTL_DAYS must be >= 1, got ${config.ui.pageTtlDays}`);
  }
  if (config.emailWatcher.intervalMs < 10000) {
    errors.push(`EMAIL_WATCHER_INTERVAL_MS must be >= 10000, got ${config.emailWatcher.intervalMs}`);
  }
  if (config.emailWatcher.batchSize < 1 || config.emailWatcher.batchSize > 100) {
    errors.push(`EMAIL_WATCHER_BATCH_SIZE must be 1-100, got ${config.emailWatcher.batchSize}`);
  }
  if (config.emailWatcher.confidenceThreshold < 0 || config.emailWatcher.confidenceThreshold > 1) {
    errors.push(`EMAIL_WATCHER_CONFIDENCE_THRESHOLD must be 0-1, got ${config.emailWatcher.confidenceThreshold}`);
  }

  if (errors.length > 0) {
    console.error(JSON.stringify({
      level: 'fatal',
      message: 'Configuration validation failed',
      errors,
      timestamp: new Date().toISOString(),
    }));
    throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

export default config;
