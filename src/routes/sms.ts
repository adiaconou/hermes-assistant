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
import { generateResponse, classifyMessage } from '../llm.js';
import { getHistory, addMessage, type Message } from '../conversation.js';
import { sendSms, sendWhatsApp } from '../twilio.js';

/**
 * Send a response via the appropriate channel (SMS or WhatsApp).
 */
async function sendResponse(
  sender: string,
  channel: MessageChannel,
  message: string
): Promise<void> {
  if (channel === 'whatsapp') {
    await sendWhatsApp(sender, message);
  } else {
    await sendSms(sender, message);
  }
}

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
 * Process heavy async work (UI generation, complex responses).
 * Called when classification determines async work is needed.
 */
async function processAsyncWork(
  sender: string,
  message: string,
  channel: MessageChannel,
  history: Message[]
): Promise<void> {
  const startTime = Date.now();

  try {
    console.log(JSON.stringify({
      level: 'info',
      message: 'Starting async work',
      channel,
      timestamp: new Date().toISOString(),
    }));

    // Use the full generateResponse with tool loop
    const responseText = await generateResponse(message, history);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Async work complete',
      responseLength: responseText.length,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Store in conversation history and send response
    addMessage(sender, 'assistant', responseText);
    await sendResponse(sender, channel, responseText);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Async response sent',
      channel,
      totalDurationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Async work failed',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Try to send error message to user
    try {
      const errorMessage = 'Sorry, I encountered an error completing your request. Please try again.';
      await sendResponse(sender, channel, errorMessage);
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
 * Process message with classification-based async pattern:
 * 1. Classify message to determine if async work is needed
 * 2. Send immediate response
 * 3. If async work needed, spawn background processing
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
      message: 'Processing message with classification',
      channel,
      historyLength: history.length,
      messageLength: message.length,
      timestamp: new Date().toISOString(),
    }));

    // Step 1: Quick classification
    const classification = await classifyMessage(message, history);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Classification complete',
      needsAsyncWork: classification.needsAsyncWork,
      classificationDurationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Step 2: Send immediate response
    await sendResponse(sender, channel, classification.immediateResponse);

    // Store messages in history
    addMessage(sender, 'user', message);
    addMessage(sender, 'assistant', classification.immediateResponse);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Immediate response sent',
      channel,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Step 3: If async work needed, continue processing
    if (classification.needsAsyncWork) {
      // Get updated history (includes the ack we just added)
      const updatedHistory = getHistory(sender);

      // Fire and forget - don't await
      processAsyncWork(sender, message, channel, updatedHistory).catch((error) => {
        console.error(JSON.stringify({
          level: 'error',
          message: 'Unhandled error in async work',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }));
      });
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to process message',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Try to send error message to user
    try {
      const errorMessage = 'Sorry, I encountered an error processing your message. Please try again.';
      await sendResponse(sender, channel, errorMessage);
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
