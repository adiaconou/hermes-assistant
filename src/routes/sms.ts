/**
 * SMS/WhatsApp Webhook Route
 *
 * Handles inbound messages from Twilio with channel-specific patterns:
 *
 * **WhatsApp flow** (skip classifier, use typing indicator):
 * 1. Receive webhook, store user message
 * 2. Return empty TwiML (no ack message)
 * 3. Start typing indicator, run orchestrator in background
 *
 * **SMS flow** (classifier for personalized ack):
 * 1. Receive webhook, classify for ack text
 * 2. Store user message + ack, return TwiML with ack
 * 3. Always run orchestrator in background
 *
 * Both channels always route through the orchestrator.
 */
import { Router, Request, Response } from 'express';
import { classifyMessage } from '../services/anthropic/index.js';
import { TOOLS } from '../tools/index.js';
import { getHistory, addMessage } from '../conversation.js';
import { sendSms, sendWhatsApp, validateTwilioSignature } from '../twilio.js';
import { getUserConfigStore, type UserConfig } from '../services/user-config/index.js';
import { getMemoryStore } from '../domains/memory/runtime/index.js';
import { handleWithOrchestrator } from '../orchestrator/index.js';
import type { MediaAttachment } from '../types/media.js';
import type { StoredMediaAttachment, CurrentMediaSummary, ImageAnalysisMetadata } from '../services/conversation/types.js';
import { processMediaAttachments } from '../services/media/index.js';
import { getConversationStore } from '../services/conversation/index.js';
import config from '../config.js';
import { detectChannel, normalize, sanitize, type MessageChannel } from '../utils/phone.js';
import { startTypingIndicator } from '../services/twilio/typing-indicator.js';

// Re-export for backwards compatibility
export type { MediaAttachment } from '../types/media.js';

/**
 * Send a response via the appropriate channel (SMS or WhatsApp).
 */
async function sendResponse(
  sender: string,
  channel: MessageChannel,
  message: string
): Promise<void> {
  const safeMessage = enforceSmsLength(message, channel);
  if (channel === 'whatsapp') {
    await sendWhatsApp(sender, safeMessage);
  } else {
    await sendSms(sender, safeMessage);
  }
}

const router = Router();

/**
 * Simple per-phone-number rate limiter.
 * Tracks message timestamps per sender and rejects if too many arrive
 * in the window. Stale entries are cleaned up periodically.
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 20; // max messages per window per phone number

const rateLimitMap = new Map<string, number[]>();

/** Periodic cleanup of stale rate limit entries (every 5 minutes). */
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap) {
    const fresh = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) {
      rateLimitMap.delete(key);
    } else {
      rateLimitMap.set(key, fresh);
    }
  }
}, 5 * 60_000);

/**
 * Check if a phone number is rate limited.
 * Returns true if the request should be allowed, false if rate-limited.
 */
function checkRateLimit(phoneNumber: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(phoneNumber) || [];
  const fresh = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  if (fresh.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(phoneNumber, fresh);
    return false;
  }

  fresh.push(now);
  rateLimitMap.set(phoneNumber, fresh);
  return true;
}

/**
 * Twilio sends these fields (among others) in the webhook POST body.
 * See: https://www.twilio.com/docs/messaging/guides/webhook-request
 */
type TwilioWebhookBody = {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  // Media attachment fields
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  MediaUrl1?: string;
  MediaContentType1?: string;
  MediaUrl2?: string;
  MediaContentType2?: string;
  MediaUrl3?: string;
  MediaContentType3?: string;
  MediaUrl4?: string;
  MediaContentType4?: string;
  MediaUrl5?: string;
  MediaContentType5?: string;
  MediaUrl6?: string;
  MediaContentType6?: string;
  MediaUrl7?: string;
  MediaContentType7?: string;
  MediaUrl8?: string;
  MediaContentType8?: string;
  MediaUrl9?: string;
  MediaContentType9?: string;
};

/**
 * Extract media attachments from Twilio webhook body.
 */
export function extractMediaAttachments(body: TwilioWebhookBody): MediaAttachment[] {
  const numMedia = parseInt(body.NumMedia || '0', 10);
  if (numMedia === 0) {
    return [];
  }

  const attachments: MediaAttachment[] = [];

  for (let i = 0; i < numMedia && i < 10; i++) {
    const urlKey = `MediaUrl${i}` as keyof TwilioWebhookBody;
    const typeKey = `MediaContentType${i}` as keyof TwilioWebhookBody;

    const url = body[urlKey] as string | undefined;
    const contentType = body[typeKey] as string | undefined;

    if (url && contentType) {
      attachments.push({
        url,
        contentType,
        index: i,
      });
    }
  }

  return attachments;
}


/**
 * Generates a descriptive placeholder when user sends media without text.
 * This ensures the LLM receives non-empty content and understands media is attached.
 * Exported for testing.
 */
export function generateMediaDescription(attachments: MediaAttachment[]): string {
  const typeDescriptions = attachments.map((a) => {
    const type = a.contentType.split('/')[0]; // 'image', 'application', 'audio', etc.
    const subtype = a.contentType.split('/')[1]; // 'jpeg', 'pdf', etc.

    if (type === 'image') return 'image';
    if (type === 'audio') return 'audio file';
    if (type === 'video') return 'video';
    if (subtype === 'pdf') return 'PDF document';
    if (a.contentType.includes('word') || a.contentType.includes('document')) return 'document';
    return 'file';
  });

  // Deduplicate and count
  const counts = new Map<string, number>();
  for (const desc of typeDescriptions) {
    counts.set(desc, (counts.get(desc) || 0) + 1);
  }

  const parts: string[] = [];
  for (const [desc, count] of counts) {
    if (count === 1) {
      parts.push(`an ${desc}`);
    } else {
      parts.push(`${count} ${desc}s`);
    }
  }

  return `[User sent ${parts.join(' and ')}]`;
}

/**
 * Build the message content passed into classification/orchestration.
 *
 * Always includes a compact media hint when attachments are present so
 * agents know an image/file exists even when user text is provided.
 */
export function buildMessageWithMediaContext(
  body: string | undefined,
  attachments: MediaAttachment[]
): string {
  const text = body || '';
  if (attachments.length === 0) {
    return text;
  }

  const mediaDescription = generateMediaDescription(attachments);
  if (text.trim().length === 0) {
    return mediaDescription;
  }

  return `${text}\n\n${mediaDescription}`;
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

/** SMS has a 160 character limit per segment. */
const SMS_MAX_LENGTH = 160;
const MEDIA_IMMEDIATE_ACK = "Working on your attachment now. I'll send results shortly.";

/**
 * Enforce SMS length limits for synchronous TwiML responses.
 * WhatsApp supports longer messages, so only SMS is truncated.
 * Exported for testing.
 */
export function enforceSmsLength(message: string, channel: MessageChannel): string {
  // WhatsApp doesn't need truncation
  if (channel === 'whatsapp') return message;

  if (message.length <= SMS_MAX_LENGTH) return message;

  // Use canned acknowledgment for long responses - better UX than truncation
  return "Working on your request. I'll send the full response shortly.";
}

/**
 * Process heavy async work (UI generation, complex responses).
 * Called when classification determines async work is needed.
 *
 * Uses the orchestrator for async work (legacy generateResponse removed).
 * If media attachments are present, downloads from Twilio, then runs
 * Drive upload and Gemini pre-analysis in parallel before planning.
 */
async function processAsyncWork(
  sender: string,
  message: string,
  channel: MessageChannel,
  userConfig: UserConfig | null,
  mediaAttachments?: MediaAttachment[],
  userMessageId?: string
): Promise<void> {
  const startTime = Date.now();
  let storedMedia: StoredMediaAttachment[] = [];
  let preAnalysis: CurrentMediaSummary[] = [];

  try {
    console.log(JSON.stringify({
      level: 'info',
      message: 'Starting async work',
      channel,
      useOrchestrator: true,
      numMedia: mediaAttachments?.length || 0,
      timestamp: new Date().toISOString(),
    }));

    // Process media: download from Twilio, then upload to Drive + pre-analyze in parallel
    if (mediaAttachments && mediaAttachments.length > 0) {
      const mediaResult = await processMediaAttachments(sender, mediaAttachments);
      storedMedia = mediaResult.storedMedia;
      preAnalysis = mediaResult.preAnalysis;

      if (storedMedia.length > 0) {
        console.log(JSON.stringify({
          level: 'info',
          message: 'Media uploaded to Drive',
          count: storedMedia.length,
          fileIds: storedMedia.map(m => m.driveFileId),
          timestamp: new Date().toISOString(),
        }));
      }

      // Backfill media attachments on the user message (Issue #5)
      if (userMessageId && storedMedia.length > 0) {
        try {
          const conversationStore = getConversationStore();
          await conversationStore.updateMediaAttachments(userMessageId, storedMedia);
        } catch (backfillError) {
          console.log(JSON.stringify({
            level: 'warn',
            message: 'Failed to backfill media attachments on user message',
            error: backfillError instanceof Error ? backfillError.message : String(backfillError),
            timestamp: new Date().toISOString(),
          }));
        }
      }

      // Persist pre-analysis summaries as metadata (Issue #2)
      if (userMessageId && preAnalysis.length > 0) {
        const conversationStore = getConversationStore();
        for (const summary of preAnalysis) {
          try {
            await conversationStore.addMessageMetadata(
              userMessageId,
              sender,
              'image_analysis',
              { mimeType: summary.mime_type, analysis: summary.summary } satisfies Pick<ImageAnalysisMetadata, 'mimeType' | 'analysis'>
            );
          } catch (metadataError) {
            console.log(JSON.stringify({
              level: 'warn',
              message: 'Failed to persist pre-analysis metadata',
              error: metadataError instanceof Error ? metadataError.message : String(metadataError),
              timestamp: new Date().toISOString(),
            }));
          }
        }
      }
    }

    // Always use orchestrator handler (pass pre-analysis for planner enrichment)
    const responseText = await handleWithOrchestrator(message, sender, channel, userConfig, mediaAttachments, storedMedia, userMessageId, preAnalysis);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Async work complete',
      responseLength: responseText.length,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Store in conversation history and send response
    await addMessage(sender, 'assistant', responseText, channel);
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
 * Always routes through the orchestrator for both channels.
 *
 * WhatsApp: skip classifier, return empty TwiML, show typing indicator.
 * SMS: run classifier for personalized ack, return TwiML with ack.
 */
export async function handleSmsWebhook(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();

  // Validate Twilio signature before processing
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  const webhookUrl = `${config.baseUrl}/webhook/sms`;

  if (!validateTwilioSignature(signature, webhookUrl, req.body)) {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Invalid Twilio signature - rejecting request',
      timestamp: new Date().toISOString(),
    }));
    res.status(403).send('Forbidden');
    return;
  }

  const webhookBody = req.body as TwilioWebhookBody;
  const { From, Body } = webhookBody;

  const channel = detectChannel(From || '');
  const sender = normalize(From || '');

  // Per-phone rate limiting
  if (!checkRateLimit(sender)) {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Rate limited',
      from: sanitize(sender),
      timestamp: new Date().toISOString(),
    }));
    res.status(429).send('Rate limited');
    return;
  }

  // Extract media attachments
  const mediaAttachments = extractMediaAttachments(webhookBody);

  // Always include media context so the model can call image/file tools
  // even when the user also provides a text caption.
  const message = buildMessageWithMediaContext(Body, mediaAttachments);

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Message received',
      channel,
      from: sanitize(sender),
      bodyLength: message.length,
      numMedia: mediaAttachments.length,
      mediaTypes: mediaAttachments.map(m => m.contentType),
      timestamp: new Date().toISOString(),
    })
  );

  try {
    if (channel === 'whatsapp') {
      // ── WhatsApp flow: skip classifier, return empty TwiML, typing indicator ──
      const userMessage = await addMessage(sender, 'user', message, channel);

      // Return empty TwiML immediately (no ack stored in history)
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

      console.log(JSON.stringify({
        level: 'info',
        message: 'Empty TwiML sent (WhatsApp)',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }));

      // Start typing indicator, stop in .finally()
      const stopTyping = startTypingIndicator(webhookBody.MessageSid);

      const configStore = getUserConfigStore();
      const userConfig = await configStore.get(sender);

      processAsyncWork(sender, message, channel, userConfig, mediaAttachments, userMessage.id)
        .catch((error) => {
          console.error(JSON.stringify({
            level: 'error',
            message: 'Unhandled error in async work',
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          }));
        })
        .finally(stopTyping);
    } else {
      // ── SMS flow: classifier for personalized ack, always run orchestrator ──
      const configStore = getUserConfigStore();
      const memoryStore = getMemoryStore();
      const [history, userConfig, userFacts] = await Promise.all([
        getHistory(sender),
        configStore.get(sender),
        memoryStore.getFacts(sender),
      ]);

      // Classify for ack text only — result no longer gates orchestrator
      const classification = await classifyMessage(TOOLS, message, history, userConfig, userFacts);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Classification complete',
        classificationDurationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }));

      const hasMedia = mediaAttachments.length > 0;
      const immediateResponse = hasMedia
        ? MEDIA_IMMEDIATE_ACK
        : classification.immediateResponse;

      // Store messages in history
      const userMessage = await addMessage(sender, 'user', message, channel);
      await addMessage(sender, 'assistant', immediateResponse, channel);

      // Enforce SMS length limits for TwiML response
      const safeImmediateResponse = enforceSmsLength(immediateResponse, channel);

      // Return TwiML with the immediate response
      res.type('text/xml');
      res.send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(safeImmediateResponse)}</Message></Response>`
      );

      console.log(JSON.stringify({
        level: 'info',
        message: 'TwiML response sent',
        channel,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }));

      // Always spawn background processing (fire and forget)
      processAsyncWork(sender, message, channel, userConfig, mediaAttachments, userMessage.id).catch((error) => {
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
      message: 'Webhook processing failed',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }));

    // Fall back to generic response
    const fallbackMessage = "⏳ I'm processing your message and will respond shortly.";
    const fallbackUserMessage = await addMessage(sender, 'user', message, channel);

    if (channel === 'whatsapp') {
      // WhatsApp: return empty TwiML, always orchestrate
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } else {
      // SMS: return fallback ack
      await addMessage(sender, 'assistant', fallbackMessage, channel);
      res.type('text/xml');
      res.send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(fallbackMessage)}</Message></Response>`
      );
    }

    // Try to process with full pipeline even after failure
    const configStore = getUserConfigStore();
    configStore.get(sender).then((userConfig) => {
      processAsyncWork(sender, message, channel, userConfig, mediaAttachments, fallbackUserMessage.id).catch((asyncError) => {
        console.error(JSON.stringify({
          level: 'error',
          message: 'Async fallback processing failed',
          error: asyncError instanceof Error ? asyncError.message : String(asyncError),
          timestamp: new Date().toISOString(),
        }));
      });
    });
  }
}

router.post('/webhook/sms', handleSmsWebhook);

export default router;
