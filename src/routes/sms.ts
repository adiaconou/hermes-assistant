/**
 * SMS/WhatsApp Webhook Route
 *
 * Handles inbound messages from Twilio. Both SMS and WhatsApp messages
 * arrive at the same endpoint—Twilio distinguishes them via the "whatsapp:"
 * prefix on the From field.
 *
 * Response format: TwiML (Twilio Markup Language) XML. The response must be
 * returned synchronously in the webhook response body; Twilio does not support
 * async callbacks for message replies.
 */
import { Router, Request, Response } from 'express';
import { generateResponse } from '../llm.js';
import { getHistory, addMessage } from '../conversation.js';

const router = Router();

/**
 * Twilio sends these fields (among others) in the webhook POST body.
 * See: https://www.twilio.com/docs/messaging/guides/webhook-request
 *
 * Example SMS message:
 *   { From: "+15551234567", To: "+15559876543", Body: "Hello" }
 *
 * Example WhatsApp message:
 *   { From: "whatsapp:+15551234567", To: "whatsapp:+15559876543", Body: "Hello" }
 */
type TwilioWebhookBody = {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
};

type MessageChannel = 'whatsapp' | 'sms';

/** WhatsApp messages arrive with "whatsapp:" prefix on the From number. */
function detectChannel(from: string): MessageChannel {
  return from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
}

/** Removes "whatsapp:" prefix to get the raw phone number. */
function stripPrefix(address: string): string {
  return address.replace('whatsapp:', '');
}

/** Masks phone number for logging (security: avoid logging full numbers). */
function sanitizePhone(phone: string): string {
  if (phone.length < 4) return '****';
  return '***' + phone.slice(-4);
}

/** Escapes user input for safe inclusion in TwiML XML response. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * POST /webhook/sms
 *
 * Twilio calls this endpoint when an SMS or WhatsApp message is received.
 * Must respond with TwiML XML to send a reply back to the sender.
 */
router.post('/webhook/sms', async (req: Request, res: Response) => {
  const { From, Body } = req.body as TwilioWebhookBody;

  const channel = detectChannel(From || '');
  const sender = stripPrefix(From || '');
  const message = Body || '';

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Message received',
      channel,
      from: sanitizePhone(sender),
      bodyLength: message.length,
      timestamp: new Date().toISOString(),
    })
  );

  let responseText: string;

  try {
    const history = getHistory(sender);
    responseText = await generateResponse(message, history);
    addMessage(sender, 'user', message);
    addMessage(sender, 'assistant', responseText);
  } catch (error) {
    responseText = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }

  const escapedResponse = escapeXml(responseText);

  res.type('text/xml');
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapedResponse}</Message></Response>`
  );
});

export default router;
