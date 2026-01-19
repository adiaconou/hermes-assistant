/**
 * SMS/WhatsApp Webhook Route
 *
 * Handles inbound messages from Twilio using an ASYNC response pattern:
 * 1. Receive webhook from Twilio
 * 2. Return empty TwiML immediately (acknowledges receipt)
 * 3. Process message in background (LLM call, tool use, etc.)
 * 4. Send response via Twilio REST API
 *
 * This avoids Twilio's 15-second webhook timeout for long-running operations.
 */
import { Router, Request, Response } from 'express';
import { generateResponse } from '../llm.js';
import { getHistory, addMessage } from '../conversation.js';
import { sendSms, sendWhatsApp } from '../twilio.js';

const router = Router();

/**
 * Twilio sends these fields (among others) in the webhook POST body.
 * See: https://www.twilio.com/docs/messaging/guides/webhook-request
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

/**
 * Process message and send response asynchronously.
 * This runs in the background after the webhook has returned.
 */
async function processMessageAsync(
  sender: string,
  message: string,
  channel: MessageChannel
): Promise<void> {
  const startTime = Date.now();

  try {
    const history = getHistory(sender);
    console.log(JSON.stringify({
      level: 'info',
      message: 'Processing message async',
      channel,
      historyLength: history.length,
      messageLength: message.length,
      timestamp: new Date().toISOString(),
    }));

    const responseText = await generateResponse(message, history);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Response generated',
      responseLength: responseText.length,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Store in conversation history
    addMessage(sender, 'user', message);
    addMessage(sender, 'assistant', responseText);

    // Send response via Twilio API
    if (channel === 'whatsapp') {
      await sendWhatsApp(sender, responseText);
    } else {
      await sendSms(sender, responseText);
    }

    console.log(JSON.stringify({
      level: 'info',
      message: 'Async response complete',
      channel,
      totalDurationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to process message async',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Try to send error message to user
    try {
      const errorMessage = 'Sorry, I encountered an error processing your message. Please try again.';
      if (channel === 'whatsapp') {
        await sendWhatsApp(sender, errorMessage);
      } else {
        await sendSms(sender, errorMessage);
      }
    } catch (sendError) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to send error message to user',
        error: sendError instanceof Error ? sendError.message : String(sendError),
        timestamp: new Date().toISOString(),
      }));
    }
  }
}

/**
 * POST /webhook/sms
 *
 * Twilio calls this endpoint when an SMS or WhatsApp message is received.
 * Returns empty TwiML immediately, processes message in background.
 */
router.post('/webhook/sms', (req: Request, res: Response) => {
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

  // Return empty TwiML immediately to acknowledge receipt
  // This prevents Twilio timeout (15s for SMS, longer for WhatsApp)
  res.type('text/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  // Process message in background (don't await)
  processMessageAsync(sender, message, channel).catch((error) => {
    // This catch is a safety net - errors should be handled in processMessageAsync
    console.error(JSON.stringify({
      level: 'error',
      message: 'Unhandled error in async processing',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
  });
});

export default router;
