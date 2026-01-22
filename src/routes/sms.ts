/**
 * SMS/WhatsApp Webhook Route
 *
 * Handles inbound messages from Twilio using a SYNC classification pattern:
 * 1. Receive webhook from Twilio
 * 2. Classify message synchronously (fast LLM call)
 * 3. Return TwiML with immediate response
 * 4. If async work needed, spawn background processing for full response
 *
 * Classification is fast (<5s typically) and provides a meaningful immediate
 * response. Heavy work (UI generation, complex queries) runs asynchronously.
 */
import { Router, Request, Response } from 'express';
import { generateResponse, classifyMessage } from '../llm.js';
import { getHistory, addMessage, type Message } from '../conversation.js';
import { sendSms, sendWhatsApp } from '../twilio.js';
import { getUserConfigStore, type UserConfig } from '../services/user-config/index.js';

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

/** Escapes special XML characters for safe TwiML embedding. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Process heavy async work (UI generation, complex responses).
 * Called when classification determines async work is needed.
 */
async function processAsyncWork(
  sender: string,
  message: string,
  channel: MessageChannel,
  history: Message[],
  userConfig: UserConfig | null
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
    const responseText = await generateResponse(message, history, sender, userConfig, { channel });

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
      const errorMessage = '😔 Sorry, I encountered an error completing your request. Please try again.';
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
 * Classifies message synchronously and returns TwiML with immediate response.
 * Spawns async work if classification indicates it's needed.
 */
router.post('/webhook/sms', async (req: Request, res: Response) => {
  const startTime = Date.now();
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

  try {
    // Get conversation history and user config
    const history = getHistory(sender);
    const configStore = getUserConfigStore();
    const userConfig = await configStore.get(sender);

    // Classify message synchronously - this should be fast
    const classification = await classifyMessage(message, history, userConfig);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Classification complete',
      needsAsyncWork: classification.needsAsyncWork,
      classificationDurationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Store messages in history
    addMessage(sender, 'user', message);
    addMessage(sender, 'assistant', classification.immediateResponse);

    // Return TwiML with the immediate response
    res.type('text/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(classification.immediateResponse)}</Message></Response>`
    );

    console.log(JSON.stringify({
      level: 'info',
      message: 'TwiML response sent',
      channel,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // If async work needed, spawn background processing (fire and forget)
    if (classification.needsAsyncWork) {
      const updatedHistory = getHistory(sender);

      processAsyncWork(sender, message, channel, updatedHistory, userConfig).catch((error) => {
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
      message: 'Failed to classify message',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Fall back to generic response if classification fails
    const fallbackMessage = "⏳ I'm processing your message and will respond shortly.";
    addMessage(sender, 'user', message);
    addMessage(sender, 'assistant', fallbackMessage);

    res.type('text/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(fallbackMessage)}</Message></Response>`
    );

    // Try to process with full LLM since classification failed
    const history = getHistory(sender);
    const configStore = getUserConfigStore();
    configStore.get(sender).then((userConfig) => {
      processAsyncWork(sender, message, channel, history, userConfig).catch((asyncError) => {
        console.error(JSON.stringify({
          level: 'error',
          message: 'Async fallback processing failed',
          error: asyncError instanceof Error ? asyncError.message : String(asyncError),
          timestamp: new Date().toISOString(),
        }));
      });
    });
  }
});

export default router;
