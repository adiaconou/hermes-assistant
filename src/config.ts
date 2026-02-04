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
     * Default 0.0 means all facts are injected (current behavior).
     * Set to 0.6 to only inject established facts (hide observations).
     */
    injectionThreshold: parseFloat(process.env.MEMORY_INJECTION_THRESHOLD || '0'),
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

export default config;
