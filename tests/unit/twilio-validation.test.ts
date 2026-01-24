/**
 * Unit tests for Twilio webhook signature validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateTwilioSignature } from '../../src/twilio.js';
import Twilio from 'twilio';

// Mock the twilio module
vi.mock('twilio', async () => {
  const actual = await vi.importActual('twilio');
  return {
    ...actual,
    default: {
      ...(actual as Record<string, unknown>).default,
      validateRequest: vi.fn(),
    },
  };
});

// Mock config
vi.mock('../../src/config.js', () => ({
  default: {
    nodeEnv: 'production',
    twilio: {
      authToken: 'test-auth-token',
      accountSid: 'test-account-sid',
      phoneNumber: '+15551234567',
    },
  },
}));

describe('validateTwilioSignature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when signature is missing', () => {
    const result = validateTwilioSignature(
      undefined,
      'https://example.com/webhook/sms',
      { From: '+1234567890', Body: 'test' }
    );

    expect(result).toBe(false);
  });

  it('returns false when signature is empty string', () => {
    const result = validateTwilioSignature(
      '',
      'https://example.com/webhook/sms',
      { From: '+1234567890', Body: 'test' }
    );

    expect(result).toBe(false);
  });

  it('calls Twilio validateRequest with correct parameters', () => {
    const mockValidateRequest = vi.mocked(Twilio.validateRequest);
    mockValidateRequest.mockReturnValue(true);

    const signature = 'valid-signature';
    const url = 'https://example.com/webhook/sms';
    const params = { From: '+1234567890', Body: 'Hello' };

    validateTwilioSignature(signature, url, params);

    expect(mockValidateRequest).toHaveBeenCalledWith(
      'test-auth-token',
      signature,
      url,
      params
    );
  });

  it('returns true when Twilio validates signature', () => {
    const mockValidateRequest = vi.mocked(Twilio.validateRequest);
    mockValidateRequest.mockReturnValue(true);

    const result = validateTwilioSignature(
      'valid-signature',
      'https://example.com/webhook/sms',
      { From: '+1234567890', Body: 'test' }
    );

    expect(result).toBe(true);
  });

  it('returns false when Twilio rejects signature', () => {
    const mockValidateRequest = vi.mocked(Twilio.validateRequest);
    mockValidateRequest.mockReturnValue(false);

    const result = validateTwilioSignature(
      'invalid-signature',
      'https://example.com/webhook/sms',
      { From: '+1234567890', Body: 'test' }
    );

    expect(result).toBe(false);
  });
});

describe('validateTwilioSignature in development mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to apply new mock
    vi.resetModules();
  });

  it('skips validation when SKIP_TWILIO_VALIDATION is true in development', async () => {
    // Set environment variable
    process.env.SKIP_TWILIO_VALIDATION = 'true';

    // Re-mock config for development mode
    vi.doMock('../../src/config.js', () => ({
      default: {
        nodeEnv: 'development',
        twilio: {
          authToken: 'test-auth-token',
        },
      },
    }));

    // Re-import to get fresh module with new mock
    const { validateTwilioSignature: devValidate } = await import('../../src/twilio.js');

    const result = devValidate(
      undefined, // No signature provided
      'https://example.com/webhook/sms',
      { From: '+1234567890', Body: 'test' }
    );

    // Should return true because validation is skipped
    expect(result).toBe(true);

    // Clean up
    delete process.env.SKIP_TWILIO_VALIDATION;
  });
});
