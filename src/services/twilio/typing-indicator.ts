/**
 * @fileoverview WhatsApp typing indicator service.
 *
 * Fires a typing indicator immediately when processing begins, then
 * re-fires every 20 seconds to keep the dots visible in WhatsApp.
 * Returns a stop function so callers can cancel in a .finally() block.
 *
 * Best-effort: errors are logged but never thrown, since typing indicators
 * are UX polish rather than critical path.
 */

import config from '../../config.js';
import { fetchWithRetry } from './fetch-with-retry.js';

/** Twilio typing indicator endpoint. */
const TYPING_INDICATOR_URL = 'https://messaging.twilio.com/v2/Indicators/Typing.json';

/** Re-fire interval in milliseconds (WhatsApp indicators expire ~25s). */
const REFIRE_INTERVAL_MS = 20_000;

/**
 * Send a single typing indicator request to Twilio.
 * Errors are caught and logged — never propagated.
 */
async function fireTypingIndicator(messageSid: string): Promise<void> {
  const { accountSid, authToken } = config.twilio;

  if (!accountSid || !authToken) {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Typing indicator skipped — Twilio credentials not configured',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await fetchWithRetry(
      TYPING_INDICATOR_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `messageId=${encodeURIComponent(messageSid)}&channel=whatsapp`,
      },
      'WhatsApp typing indicator',
      [500], // single fast retry
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Typing indicator returned non-OK status',
        status: response.status,
        body: body.slice(0, 200),
        timestamp: new Date().toISOString(),
      }));
    }
  } catch (error) {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Typing indicator request failed',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
  }
}

/**
 * Start a WhatsApp typing indicator that fires immediately and
 * re-fires every 20 seconds.
 *
 * @param messageSid The MessageSid from the Twilio webhook
 * @returns A stop function — call it to cancel the recurring indicator
 */
export function startTypingIndicator(messageSid: string): () => void {
  // Fire immediately (non-blocking)
  fireTypingIndicator(messageSid);

  // Re-fire on interval
  const intervalId = setInterval(() => {
    fireTypingIndicator(messageSid);
  }, REFIRE_INTERVAL_MS);

  // Return stop function
  return () => {
    clearInterval(intervalId);
  };
}
