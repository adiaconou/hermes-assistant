/**
 * Global test setup for Vitest.
 *
 * This file runs before all tests. It configures the test environment
 * and sets up mock cleanup between tests.
 */

import { beforeEach, vi } from 'vitest';

// Set test environment variables before any imports
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-api-key';
process.env.TWILIO_ACCOUNT_SID = 'test-account-sid';
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
process.env.TWILIO_PHONE_NUMBER = '+15555550000';
process.env.BASE_URL = 'http://localhost:3000';
process.env.UI_STORAGE_PROVIDER = 'local';
process.env.UI_SHORTENER_PROVIDER = 'memory';
process.env.UI_LOCAL_STORAGE_PATH = './data/test-pages';

// Import mocks
import './mocks/anthropic.js';
import './mocks/twilio.js';

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
