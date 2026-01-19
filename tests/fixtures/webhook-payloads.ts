/**
 * Sample Twilio webhook payloads for testing.
 *
 * These match the format Twilio sends to webhook endpoints.
 * See: https://www.twilio.com/docs/messaging/guides/webhook-request
 */

/**
 * Twilio webhook body format.
 */
export interface TwilioWebhookPayload {
  MessageSid: string;
  AccountSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  NumSegments?: string;
}

/**
 * Create a basic SMS webhook payload.
 */
export function createSmsPayload(
  body: string,
  from = '+15551234567',
  to = '+15555550000'
): TwilioWebhookPayload {
  return {
    MessageSid: `SM${Date.now()}`,
    AccountSid: 'test-account-sid',
    From: from,
    To: to,
    Body: body,
    NumMedia: '0',
    NumSegments: '1',
  };
}

/**
 * Create a WhatsApp webhook payload.
 * WhatsApp messages have "whatsapp:" prefix on the From/To numbers.
 */
export function createWhatsAppPayload(
  body: string,
  from = '+15551234567',
  to = '+15555550000'
): TwilioWebhookPayload {
  return {
    MessageSid: `SM${Date.now()}`,
    AccountSid: 'test-account-sid',
    From: `whatsapp:${from}`,
    To: `whatsapp:${to}`,
    Body: body,
    NumMedia: '0',
    NumSegments: '1',
  };
}

/**
 * Sample payloads for common test scenarios.
 */
export const samplePayloads = {
  /** Simple greeting message */
  greeting: createSmsPayload('Hello!'),

  /** Question that needs simple response */
  simpleQuestion: createSmsPayload('What time is it?'),

  /** Request that triggers UI generation */
  groceryList: createSmsPayload('Create a grocery list for making pasta'),

  /** Request for a todo list */
  todoList: createSmsPayload('Make me a todo list for today'),

  /** WhatsApp greeting */
  whatsAppGreeting: createWhatsAppPayload('Hi there!'),

  /** Empty message */
  emptyMessage: createSmsPayload(''),

  /** Long message */
  longMessage: createSmsPayload('A'.repeat(1000)),
};

/**
 * Convert payload to URL-encoded form data string.
 * Express parses this format when Content-Type is application/x-www-form-urlencoded.
 */
export function toFormData(payload: TwilioWebhookPayload): string {
  return Object.entries(payload)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}
