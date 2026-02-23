/**
 * E2E mock for the WhatsApp typing indicator module.
 *
 * Captures startTypingIndicator calls so e2e tests can assert that
 * typing indicators are fired for WhatsApp messages without making
 * real HTTP requests to Twilio.
 */

import { vi } from 'vitest';

export interface TypingIndicatorCall {
  messageSid: string;
  timestamp: Date;
  stopped: boolean;
}

let calls: TypingIndicatorCall[] = [];

/**
 * Get all captured typing indicator calls.
 */
export function getTypingIndicatorCalls(): TypingIndicatorCall[] {
  return [...calls];
}

/**
 * Clear captured calls. Call in harness.reset().
 */
export function clearTypingIndicatorCalls(): void {
  calls = [];
}

/**
 * Mock startTypingIndicator that records the call and returns a stop function.
 */
const mockStartTypingIndicator = vi.fn((messageSid: string): (() => void) => {
  const call: TypingIndicatorCall = {
    messageSid,
    timestamp: new Date(),
    stopped: false,
  };
  calls.push(call);

  return () => {
    call.stopped = true;
  };
});

vi.mock('../../../src/services/twilio/typing-indicator.js', () => ({
  startTypingIndicator: mockStartTypingIndicator,
}));

export { mockStartTypingIndicator };
