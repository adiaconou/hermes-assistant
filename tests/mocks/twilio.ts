/**
 * Mock for twilio module.
 *
 * Captures sent messages for assertions without making real API calls.
 */

import { vi } from 'vitest';
import { validateRequest } from 'twilio/lib/webhooks/webhooks.js';

/**
 * Captured message from a send operation.
 */
export interface SentMessage {
  to: string;
  from: string;
  body: string;
  sid: string;
  status: string;
  timestamp: Date;
}

// Store sent messages for assertions
let sentMessages: SentMessage[] = [];

// Counter for generating unique message SIDs
let messageCounter = 0;

/**
 * Get all sent messages for assertions.
 */
export function getSentMessages(): SentMessage[] {
  return [...sentMessages];
}

/**
 * Get the last sent message.
 */
export function getLastSentMessage(): SentMessage | undefined {
  return sentMessages[sentMessages.length - 1];
}

/**
 * Clear all sent messages. Call this in beforeEach.
 */
export function clearSentMessages(): void {
  sentMessages = [];
  messageCounter = 0;
}

/**
 * Mock messages.create method.
 */
const mockMessagesCreate = vi.fn(
  async (params: { to: string; from: string; body: string }): Promise<{ sid: string; status: string }> => {
    messageCounter++;
    const sid = `SM${messageCounter.toString().padStart(32, '0')}`;

    const message: SentMessage = {
      to: params.to,
      from: params.from,
      body: params.body,
      sid,
      status: 'queued',
      timestamp: new Date(),
    };

    sentMessages.push(message);

    return {
      sid,
      status: 'queued',
    };
  }
);

/**
 * Mock Twilio client.
 */
class MockTwilioClient {
  messages = {
    create: mockMessagesCreate,
  };
}

/**
 * Mock Twilio factory function.
 */
function MockTwilio(_accountSid?: string, _authToken?: string): MockTwilioClient {
  return new MockTwilioClient();
}

// Export as default (matches how Twilio is imported)
export default MockTwilio;

// Also export the mock function for direct access in tests
export { mockMessagesCreate };

// Set up the module mock (keep named exports like validateRequest/getExpectedTwilioSignature)
vi.mock('twilio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('twilio')>();
  return {
    ...actual,
    default: MockTwilio,
    validateRequest,
  };
});
