/**
 * @fileoverview Gmail History Sync + Email Normalization.
 *
 * Syncs new emails from Gmail using the History API and normalizes
 * them into IncomingEmail format for classification.
 */

import { google, gmail_v1 } from 'googleapis';
import { getAuthenticatedClient } from './google-core.js';
import { getUserConfigStore } from '../../../services/user-config/index.js';
import config from '../../../config.js';
import type { IncomingEmail, EmailAttachment } from '../types.js';

/**
 * Sync new emails for a user since their last known historyId.
 *
 * On first run (no historyId), seeds the cursor from the user's profile
 * and returns an empty array. Subsequent runs fetch new INBOX messages
 * via Gmail's history API.
 */
export async function syncNewEmails(phoneNumber: string): Promise<IncomingEmail[]> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'EmailWatcher');
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const userConfigStore = getUserConfigStore();
  const userConfig = await userConfigStore.get(phoneNumber);

  const historyId = userConfig?.emailWatcherHistoryId;

  // First run: seed the historyId cursor and return empty
  if (!historyId) {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const currentHistoryId = profile.data.historyId;
    if (currentHistoryId) {
      await userConfigStore.updateEmailWatcherState(phoneNumber, currentHistoryId);
    }
    return [];
  }

  // Subsequent runs: fetch history since last known cursor
  try {
    const messageIds = await fetchHistoryMessageIds(gmail, historyId);

    if (messageIds.length === 0) {
      return [];
    }

    // Limit to batchSize
    const limitedIds = messageIds.slice(0, config.emailWatcher.batchSize);

    // Fetch full messages and normalize
    const emails: IncomingEmail[] = [];
    for (const msgId of limitedIds) {
      try {
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'full',
        });
        if (response.data) {
          emails.push(prepareEmailForClassification(response.data));
        }
      } catch (err) {
        console.log(JSON.stringify({
          level: 'warn',
          message: 'Failed to fetch email for classification',
          messageId: msgId,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }));
      }
    }

    // Update historyId cursor to latest
    const profile = await gmail.users.getProfile({ userId: 'me' });
    if (profile.data.historyId) {
      await userConfigStore.updateEmailWatcherState(phoneNumber, profile.data.historyId);
    }

    return emails;
  } catch (err: unknown) {
    // historyId invalid (HTTP 404) — reset cursor
    if (isHttp404(err)) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Gmail historyId invalid (404), resetting cursor',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        timestamp: new Date().toISOString(),
      }));
      const profile = await gmail.users.getProfile({ userId: 'me' });
      if (profile.data.historyId) {
        await userConfigStore.updateEmailWatcherState(phoneNumber, profile.data.historyId);
      }
      return [];
    }
    throw err;
  }
}

/**
 * Fetch all new INBOX message IDs from Gmail history, following pagination.
 */
async function fetchHistoryMessageIds(
  gmail: gmail_v1.Gmail,
  startHistoryId: string
): Promise<string[]> {
  const messageIds = new Set<string>();
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      pageToken,
    });

    const history = response.data.history ?? [];
    for (const entry of history) {
      const addedMessages = entry.messagesAdded ?? [];
      for (const added of addedMessages) {
        const msg = added.message;
        if (msg?.id && msg.labelIds?.includes('INBOX')) {
          messageIds.add(msg.id);
        }
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return [...messageIds];
}

/**
 * Check if an error is an HTTP 404 from the Gmail API.
 */
function isHttp404(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code: number }).code === 404;
  }
  return false;
}

/**
 * Normalize a Gmail message into an IncomingEmail for classification.
 *
 * Extracts headers, decodes body content (preferring text/plain),
 * strips HTML tags, collects attachment metadata, and truncates.
 */
export function prepareEmailForClassification(
  message: gmail_v1.Schema$Message
): IncomingEmail {
  const headers = message.payload?.headers ?? [];
  const getHeader = (name: string): string =>
    headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

  const from = getHeader('From');
  const subject = getHeader('Subject');
  const date = getHeader('Date');
  const messageId = message.id ?? '';

  // Extract body and attachments from MIME parts
  const { body: rawBody, attachments } = extractBodyAndAttachments(message.payload);

  // Normalize whitespace and truncate
  const body = rawBody
    ? normalizeWhitespace(rawBody).slice(0, 5000)
    : '[No body — see attachments]';

  return { messageId, from, subject, date, body, attachments };
}

/**
 * Walk MIME parts to extract body text and attachment metadata.
 * Prefers text/plain over text/html.
 */
function extractBodyAndAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined | null
): { body: string; attachments: EmailAttachment[] } {
  const attachments: EmailAttachment[] = [];
  let plainText = '';
  let htmlText = '';

  if (!payload) {
    return { body: '', attachments };
  }

  function walkParts(part: gmail_v1.Schema$MessagePart): void {
    const mimeType = part.mimeType ?? '';
    const filename = part.filename ?? '';
    const bodyData = part.body?.data;
    const bodySize = part.body?.size ?? 0;

    // Collect attachment metadata (non-inline parts with filenames)
    if (filename && bodySize > 0) {
      attachments.push({
        filename,
        mimeType,
        sizeBytes: bodySize,
      });
    }

    // Extract text content
    if (mimeType === 'text/plain' && bodyData && !filename) {
      plainText += decodeBodyData(bodyData);
    } else if (mimeType === 'text/html' && bodyData && !filename) {
      htmlText += decodeBodyData(bodyData);
    }

    // Recurse into child parts
    if (part.parts) {
      for (const child of part.parts) {
        walkParts(child);
      }
    }
  }

  walkParts(payload);

  // Prefer plain text; fall back to stripped HTML
  let body = plainText || stripHtmlTags(htmlText);

  // Strip base64 inline image data but keep alt text
  body = body.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[inline image]');

  return { body, attachments };
}

/**
 * Decode base64url-encoded body data from Gmail API.
 */
function decodeBodyData(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

/**
 * Strip HTML tags from a string, preserving alt text from images.
 */
function stripHtmlTags(html: string): string {
  if (!html) return '';

  return html
    // Extract alt text from images
    .replace(/<img[^>]+alt=["']([^"']*)["'][^>]*>/gi, ' $1 ')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * Collapse runs of whitespace into single spaces/newlines.
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
