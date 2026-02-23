/**
 * Unit tests for WhatsApp typing indicator service.
 *
 * Tests fire-immediately, 20s re-fire interval, stop function, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config before importing the module under test
vi.mock('../../../../src/config.js', () => ({
  default: {
    twilio: {
      accountSid: 'ACtest123',
      authToken: 'test-auth-token',
    },
  },
}));

// Mock fetchWithRetry to capture calls
const mockFetchWithRetry = vi.fn(async () => new Response('', { status: 204 }));
vi.mock('../../../../src/services/twilio/fetch-with-retry.js', () => ({
  fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
}));

import { startTypingIndicator } from '../../../../src/services/twilio/typing-indicator.js';

describe('typing-indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetchWithRetry.mockClear();
    mockFetchWithRetry.mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires immediately on start', () => {
    const stop = startTypingIndicator('SM_test_123');
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    // Verify the URL and method
    const [url, init] = mockFetchWithRetry.mock.calls[0] as [string, RequestInit, string, number[]];
    expect(url).toBe('https://messaging.twilio.com/v2/Indicators/Typing.json');
    expect(init.method).toBe('POST');
    expect(init.body).toContain('messageId=SM_test_123');
    expect(init.body).toContain('channel=whatsapp');

    // Verify Basic Auth header
    const expectedAuth = Buffer.from('ACtest123:test-auth-token').toString('base64');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${expectedAuth}`);

    stop();
  });

  it('re-fires every 20 seconds', () => {
    const stop = startTypingIndicator('SM_test_456');
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    // Advance 20s
    vi.advanceTimersByTime(20_000);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);

    // Advance another 20s
    vi.advanceTimersByTime(20_000);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(3);

    stop();
  });

  it('stop function cancels the interval', () => {
    const stop = startTypingIndicator('SM_test_789');
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    stop();

    // Advancing time should not trigger more calls
    vi.advanceTimersByTime(60_000);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('does not throw when fetch fails', () => {
    mockFetchWithRetry.mockRejectedValue(new Error('network down'));

    // Should not throw
    const stop = startTypingIndicator('SM_error_test');
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    stop();
  });

  it('logs warning when Twilio credentials are missing', async () => {
    // Temporarily override config mock to have empty credentials
    const configModule = await import('../../../../src/config.js');
    const original = { ...configModule.default.twilio };
    configModule.default.twilio.accountSid = '';
    configModule.default.twilio.authToken = '';

    // Reset fetchWithRetry mock so we can verify no calls happen
    mockFetchWithRetry.mockClear();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const stop = startTypingIndicator('SM_no_creds');

    // Stop the interval immediately to prevent infinite timer loop
    stop();

    // Advance a small amount to let the initial async fire complete
    await vi.advanceTimersByTimeAsync(100);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('credentials not configured')
    );

    // fetchWithRetry should NOT have been called (early return before fetch)
    expect(mockFetchWithRetry).not.toHaveBeenCalled();

    consoleSpy.mockRestore();

    // Restore config
    configModule.default.twilio.accountSid = original.accountSid;
    configModule.default.twilio.authToken = original.authToken;
  });
});
