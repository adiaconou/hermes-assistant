import { afterEach, describe, expect, it, vi } from 'vitest';

const REQUIRED_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: 'test-api-key',
  TWILIO_ACCOUNT_SID: 'test-account-sid',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_PHONE_NUMBER: '+15555550000',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  CREDENTIAL_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  OAUTH_STATE_ENCRYPTION_KEY: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
};

const SNAPSHOT_KEYS = new Set([
  ...Object.keys(REQUIRED_ENV),
  'NODE_ENV',
  'SKIP_TWILIO_VALIDATION',
  'BASE_URL',
  'PORT',
]);

const ORIGINAL_ENV = new Map<string, string | undefined>(
  Array.from(SNAPSHOT_KEYS).map((key) => [key, process.env[key]])
);

async function importConfigWith(overrides: Record<string, string | undefined>) {
  vi.resetModules();

  for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return import('../../src/config.js');
}

describe('validateConfig Twilio signature bypass safety', () => {
  afterEach(() => {
    for (const key of SNAPSHOT_KEYS) {
      const original = ORIGINAL_ENV.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    vi.resetModules();
  });

  it('rejects SKIP_TWILIO_VALIDATION outside development', async () => {
    const { validateConfig } = await importConfigWith({
      NODE_ENV: 'production',
      SKIP_TWILIO_VALIDATION: 'true',
      BASE_URL: 'https://assistant.example.com',
      PORT: '3000',
    });

    expect(() => validateConfig()).toThrow(/SKIP_TWILIO_VALIDATION=true is only allowed/);
  });

  it('allows SKIP_TWILIO_VALIDATION in local development', async () => {
    const { validateConfig } = await importConfigWith({
      NODE_ENV: 'development',
      SKIP_TWILIO_VALIDATION: 'true',
      BASE_URL: 'http://localhost:3000',
      PORT: '3000',
    });

    expect(() => validateConfig()).not.toThrow();
  });
});
