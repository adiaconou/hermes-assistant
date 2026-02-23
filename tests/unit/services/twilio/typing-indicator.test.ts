/**
 * Unit tests for WhatsApp typing indicator service.
 *
 * Tests fire-immediately, interim message chain, stop function, error handling,
 * and fallback when no sendInterim callback is provided.
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

  it('sends interim message and fires new indicator every 20s', async () => {
    let interimCount = 0;
    const mockSendInterim = vi.fn(async () => {
      interimCount++;
      return `SM_interim_${interimCount}`;
    });

    const stop = startTypingIndicator('SM_test_456', mockSendInterim);
    // Initial fire
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
    expect(mockSendInterim).not.toHaveBeenCalled();

    // Advance 20s — triggers interim message + new typing indicator
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockSendInterim).toHaveBeenCalledTimes(1);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);

    // Second fire should use the interim message's SID
    const [, secondInit] = mockFetchWithRetry.mock.calls[1] as [string, RequestInit, string, number[]];
    expect(secondInit.body).toContain('messageId=SM_interim_1');

    // Advance another 20s
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockSendInterim).toHaveBeenCalledTimes(2);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(3);

    const [, thirdInit] = mockFetchWithRetry.mock.calls[2] as [string, RequestInit, string, number[]];
    expect(thirdInit.body).toContain('messageId=SM_interim_2');

    stop();
  });

  it('stop function cancels further interim messages', async () => {
    const mockSendInterim = vi.fn(async () => 'SM_interim');

    const stop = startTypingIndicator('SM_test_789', mockSendInterim);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    stop();

    // Advancing time should not trigger interim messages
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockSendInterim).not.toHaveBeenCalled();
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('without sendInterim, only fires once (no re-fire)', async () => {
    const stop = startTypingIndicator('SM_no_interim');
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    // Advancing time should NOT trigger more calls (no interval without sendInterim)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    stop();
  });

  it('does not throw when fetch fails', () => {
    mockFetchWithRetry.mockRejectedValue(new Error('network down'));

    // Should not throw
    const stop = startTypingIndicator('SM_error_test');
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    stop();
  });

  it('does not throw when interim message fails', async () => {
    const mockSendInterim = vi.fn(async () => {
      throw new Error('send failed');
    });

    const stop = startTypingIndicator('SM_interim_err', mockSendInterim);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    // Advance 20s — interim fails but should not throw
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockSendInterim).toHaveBeenCalledTimes(1);
    // No new typing indicator fired (interim failed)
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    // Should still schedule next attempt
    mockSendInterim.mockResolvedValueOnce('SM_recovered');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockSendInterim).toHaveBeenCalledTimes(2);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);

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

    // Stop immediately to prevent further scheduling
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
