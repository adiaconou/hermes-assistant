/**
 * Twilio client module for sending outbound SMS and webhook validation.
 *
 * Used for async response pattern where we return immediately from the webhook
 * and send the actual response via Twilio's REST API.
 */

import Twilio from 'twilio';
import config from './config.js';

let client: Twilio.Twilio | null = null;

/**
 * Validate Twilio webhook signature.
 *
 * @param signature - X-Twilio-Signature header value
 * @param url - Full webhook URL (must match exactly what Twilio sends)
 * @param params - Request body parameters
 * @returns true if signature is valid
 */
export function validateTwilioSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, string>
): boolean {
  // Skip validation in development if explicitly disabled
  if (config.nodeEnv === 'development' && process.env.SKIP_TWILIO_VALIDATION === 'true') {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Twilio signature validation SKIPPED (dev mode)',
      timestamp: new Date().toISOString(),
    }));
    return true;
  }

  if (!signature) {
    return false;
  }

  if (!config.twilio.authToken) {
    console.log(JSON.stringify({
      level: 'error',
      message: 'Cannot validate Twilio signature: TWILIO_AUTH_TOKEN not configured',
      timestamp: new Date().toISOString(),
    }));
    return false;
  }

  return Twilio.validateRequest(config.twilio.authToken, signature, url, params);
}

/**
 * Get or create the Twilio client singleton.
 */
function getClient(): Twilio.Twilio {
  if (!client) {
    if (!config.twilio.accountSid || !config.twilio.authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be configured');
    }
    client = Twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return client;
}

/**
 * Send an SMS message via Twilio REST API.
 *
 * @param to - Recipient phone number (E.164 format, e.g., +15551234567)
 * @param body - Message body text
 * @returns Message SID on success
 */
export async function sendSms(to: string, body: string): Promise<string> {
  if (!config.twilio.phoneNumber) {
    throw new Error('TWILIO_PHONE_NUMBER must be configured');
  }

  const twilioClient = getClient();

  console.log(JSON.stringify({
    level: 'info',
    message: 'Sending SMS via Twilio API',
    to: to.slice(-4).padStart(to.length, '*'),
    bodyLength: body.length,
    timestamp: new Date().toISOString(),
  }));

  const message = await twilioClient.messages.create({
    body,
    from: config.twilio.phoneNumber,
    to,
  });

  console.log(JSON.stringify({
    level: 'info',
    message: 'SMS sent successfully',
    messageSid: message.sid,
    status: message.status,
    timestamp: new Date().toISOString(),
  }));

  return message.sid;
}

/**
 * Send a WhatsApp message via Twilio REST API.
 *
 * @param to - Recipient phone number (E.164 format without whatsapp: prefix)
 * @param body - Message body text
 * @returns Message SID on success
 */
export async function sendWhatsApp(to: string, body: string): Promise<string> {
  if (!config.twilio.phoneNumber) {
    throw new Error('TWILIO_PHONE_NUMBER must be configured');
  }

  const twilioClient = getClient();

  console.log(JSON.stringify({
    level: 'info',
    message: 'Sending WhatsApp via Twilio API',
    to: to.slice(-4).padStart(to.length, '*'),
    bodyLength: body.length,
    timestamp: new Date().toISOString(),
  }));

  const message = await twilioClient.messages.create({
    body,
    from: `whatsapp:${config.twilio.phoneNumber}`,
    to: `whatsapp:${to}`,
  });

  console.log(JSON.stringify({
    level: 'info',
    message: 'WhatsApp sent successfully',
    messageSid: message.sid,
    status: message.status,
    timestamp: new Date().toISOString(),
  }));

  return message.sid;
}
