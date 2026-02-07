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

/**
 * Application configuration loaded from environment variables.
 *
 * @property port - HTTP server port (default: 3000)
 * @property nodeEnv - Runtime environment: 'development' | 'production'
 * @property twilioPhoneNumber - Twilio phone number for sending SMS
 * @property anthropicApiKey - Anthropic API key for Claude
 * @property baseUrl - Base URL for generating links (default: http://localhost:3000)
 * @property ui - UI generation configuration
 */
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  /** Twilio configuration for SMS */
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },

  /** Google OAuth configuration */
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
    /** Optional: Shared Drive ID for Hermes folder (defaults to My Drive) */
    sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID,
    /** Gemini API key for vision/OCR */
    geminiApiKey: process.env.GEMINI_API_KEY,
    /** Gemini model to use (default: gemini-2.5-flash) */
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },

  /** Credential storage configuration */
  credentials: {
    /** Storage provider: 'sqlite' (default) or 'memory' (tests only) */
    provider: (process.env.CREDENTIAL_STORE_PROVIDER || 'sqlite') as 'sqlite' | 'memory',
    /** Path to SQLite database file - uses /app/data in production for Railway volume mount */
    sqlitePath: process.env.CREDENTIAL_STORE_SQLITE_PATH ||
      (process.env.NODE_ENV === 'production' ? '/app/data/credentials.db' : './data/credentials.db'),
    /** Encryption key for tokens at rest (32-byte hex string) */
    encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY,
  },

  /** Memory system configuration */
  memory: {
    /** Path to SQLite database file - uses /app/data in production for Railway volume mount */
    sqlitePath: process.env.MEMORY_SQLITE_PATH ||
      (process.env.NODE_ENV === 'production' ? '/app/data/memory.db' : './data/memory.db'),
    /**
     * Minimum confidence threshold for injecting facts into agent prompts.
     * Facts below this threshold are kept in the database but not shown to agents.
     * Default 0.5 means only facts with moderate confidence or higher are injected.
     */
    injectionThreshold: parseFloat(process.env.MEMORY_INJECTION_THRESHOLD || '0.5'),
  },

  /** Conversation storage configuration */
  conversation: {
    /** Path to SQLite database file */
    sqlitePath: process.env.CONVERSATION_DB_PATH ||
      (process.env.NODE_ENV === 'production' ? '/app/data/conversation.db' : './data/conversation.db'),
  },

  /** Async memory processor configuration */
  memoryProcessor: {
    /** Interval between processing runs in milliseconds (default: 5 minutes) */
    intervalMs: parseInt(process.env.MEMORY_PROCESSOR_INTERVAL_MS || '300000', 10),
    /** Maximum messages to process per run */
    batchSize: parseInt(process.env.MEMORY_PROCESSOR_BATCH_SIZE || '100', 10),
    /** Maximum messages per user per run */
    perUserBatchSize: parseInt(process.env.MEMORY_PROCESSOR_PER_USER_BATCH_SIZE || '25', 10),
    /** Whether async processing is enabled */
    enabled: process.env.MEMORY_PROCESSOR_ENABLED !== 'false',
    /** Model ID for memory extraction */
    modelId: process.env.MEMORY_MODEL_ID || 'claude-opus-4-5-20251101',
    /** Verbose logging for prompts/responses (dev/local only) */
    logVerbose: process.env.MEMORY_LOG_VERBOSE === 'true',
  },

  /** Email watcher configuration */
  emailWatcher: {
    enabled: process.env.EMAIL_WATCHER_ENABLED !== 'false',
    intervalMs: parseInt(process.env.EMAIL_WATCHER_INTERVAL_MS || '60000', 10),
    modelId: process.env.EMAIL_WATCHER_MODEL_ID || 'claude-haiku-4-5-20251001',
    batchSize: parseInt(process.env.EMAIL_WATCHER_BATCH_SIZE || '20', 10),
    maxNotificationsPerHour: parseInt(process.env.EMAIL_WATCHER_MAX_NOTIFICATIONS_PER_HOUR || '10', 10),
    confidenceThreshold: parseFloat(process.env.EMAIL_WATCHER_CONFIDENCE_THRESHOLD || '0.6'),
  },

  /** Base URL for generating short links */
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  /** UI generation configuration */
  ui: {
    /** Storage provider: 'local' (default) or 's3' */
    storageProvider: (process.env.UI_STORAGE_PROVIDER || 'local') as 'local' | 's3',

    /** Path for local file storage (default: ./data/pages) */
    localStoragePath: process.env.UI_LOCAL_STORAGE_PATH || './data/pages',

    /** Shortener provider: 'memory' (default) or 'redis' */
    shortenerProvider: (process.env.UI_SHORTENER_PROVIDER || 'memory') as 'memory' | 'redis',

    /** Path for persisting memory shortener data (optional) */
    shortenerPersistPath: process.env.UI_SHORTENER_PERSIST_PATH,

    /** Page TTL in days (default: 7) */
    pageTtlDays: parseInt(process.env.PAGE_TTL_DAYS || '7', 10),
  },

  /** AWS configuration (for Phase 4b production) */
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
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
