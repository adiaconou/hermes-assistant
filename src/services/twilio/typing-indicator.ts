/**
 * @fileoverview WhatsApp typing indicator service.
 *
 * Fires a typing indicator immediately when processing begins.
 * Because Twilio's typing indicator has a hard 25-second expiry per
 * messageId (re-firing the same messageId does NOT reset the timer),
 * we send a short interim message every ~20 seconds and fire a new
 * typing indicator using that message's SID.
 *
 * Returns a stop function so callers can cancel in a .finally() block.
 *
 * Best-effort: errors are logged but never thrown, since typing indicators
 * are UX polish rather than critical path.
 */

import config from '../../config.js';
import { fetchWithRetry } from './fetch-with-retry.js';

/** Twilio typing indicator endpoint. */
const TYPING_INDICATOR_URL = 'https://messaging.twilio.com/v2/Indicators/Typing.json';

/**
 * Interval between interim messages in milliseconds.
 * Must be less than Twilio's 25-second typing indicator expiry.
 */
const INTERIM_INTERVAL_MS = 20_000;

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
 * Callback that sends a short interim WhatsApp message and returns
 * the new message's SID. Used to refresh the typing indicator since
 * Twilio's 25-second hard limit is per-messageId.
 */
export type SendInterimMessage = () => Promise<string>;

/**
 * Start a WhatsApp typing indicator that fires immediately.
 *
 * Every ~20 seconds (before the 25s hard expiry), sends an interim
 * WhatsApp message via the provided callback and fires a new typing
 * indicator using that message's SID.
 *
 * @param messageSid The MessageSid from the inbound Twilio webhook
 * @param sendInterim Callback to send an interim message; returns the new message SID
 * @returns A stop function — call it to cancel the recurring indicator
 */
export function startTypingIndicator(
  messageSid: string,
  sendInterim?: SendInterimMessage,
): () => void {
  let stopped = false;

  // Fire immediately (non-blocking)
  fireTypingIndicator(messageSid);

  // If no interim sender provided, we can only fire once (25s max)
  if (!sendInterim) {
    return () => { stopped = true; };
  }

  // Chain: every INTERIM_INTERVAL_MS, send an interim message → fire typing indicator
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function scheduleNext(): void {
    timeoutId = setTimeout(async () => {
      if (stopped) return;

      try {
        const newSid = await sendInterim!();
        if (stopped) return;
        await fireTypingIndicator(newSid);
      } catch (error) {
        console.log(JSON.stringify({
          level: 'warn',
          message: 'Typing indicator interim message failed',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }));
      }

      if (!stopped) {
        scheduleNext();
      }
    }, INTERIM_INTERVAL_MS);
  }

  scheduleNext();

  // Return stop function
  return () => {
    stopped = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}
