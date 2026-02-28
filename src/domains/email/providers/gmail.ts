/**
 * @fileoverview Gmail service.
 *
 * Provides listEmails, getEmail, and getThread functions with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { gmail as gmailApi, gmail_v1 } from '@googleapis/gmail';
import { getAuthenticatedClient, withRetry, isInsufficientScopesError, handleScopeError } from './google-core.js';
import type { Email, EmailDetail, EmailThread } from '../types.js';

/**
 * Handle Gmail API errors, converting scope errors to AuthRequiredError.
 */
async function handleGmailApiError(
  error: unknown,
  phoneNumber: string
): Promise<never> {
  if (isInsufficientScopesError(error)) {
    return handleScopeError(error, phoneNumber, 'Gmail');
  }
  throw error;
}

/**
 * Get an authenticated Gmail client for a phone number.
 */
async function getGmailClient(phoneNumber: string): Promise<gmail_v1.Gmail> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Gmail');
  return gmailApi({ version: 'v1', auth: oauth2Client });
}

/**
 * List emails matching a query.
 */
export async function listEmails(
  phoneNumber: string,
  options: {
    query?: string;
    maxResults?: number;
  } = {}
): Promise<Email[]> {
  const gmail = await getGmailClient(phoneNumber);
  const { query = 'is:inbox', maxResults = 10 } = options;

  try {
    const response = await withRetry(() => gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query,
    }), phoneNumber, 'Gmail');

    if (!response.data.messages?.length) {
      return [];
    }

    const emails = await Promise.all(
      response.data.messages
        .filter((msg) => msg.id) // boundary: skip messages without an id
        .map(async (msg) => {
          const msgId = msg.id as string; // boundary-ok: filtered above
          const detail = await withRetry(() => gmail.users.messages.get({
            userId: 'me',
            id: msgId,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          }), phoneNumber, 'Gmail');

          const headers = detail.data.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find((h) => h.name === name)?.value || '';

          return {
            id: msgId,
            threadId: msg.threadId || msgId,
            from: getHeader('From'),
            subject: getHeader('Subject'),
            snippet: detail.data.snippet || '',
            date: getHeader('Date'),
            isUnread: detail.data.labelIds?.includes('UNREAD') || false,
          };
        })
    );

    return emails;
  } catch (error) {
    return handleGmailApiError(error, phoneNumber);
  }
}

/**
 * Extract plain text body from Gmail message payload.
 */
function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      const nested = extractBodyText(part);
      if (nested) return nested;
    }
  }

  return '';
}

/**
 * Get full email content by ID.
 */
export async function getEmail(
  phoneNumber: string,
  emailId: string
): Promise<EmailDetail | null> {
  const gmail = await getGmailClient(phoneNumber);

  try {
    const response = await withRetry(() => gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'full',
    }), phoneNumber, 'Gmail');

    if (!response.data) return null;

    const headers = response.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name === name)?.value || '';

    const body = extractBodyText(response.data.payload);

    // Boundary: require id from API response
    if (!response.data.id) {
      throw new Error(`Gmail API returned email without id for emailId=${emailId}`);
    }

    return {
      id: response.data.id,
      threadId: response.data.threadId || response.data.id,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      snippet: response.data.snippet || '',
      date: getHeader('Date'),
      isUnread: response.data.labelIds?.includes('UNREAD') || false,
      body,
    };
  } catch (error) {
    return handleGmailApiError(error, phoneNumber);
  }
}

/**
 * Get all messages in an email thread.
 */
export async function getThread(
  phoneNumber: string,
  threadId: string
): Promise<EmailThread | null> {
  const gmail = await getGmailClient(phoneNumber);

  try {
    const response = await withRetry(() => gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    }), phoneNumber, 'Gmail');

    if (!response.data || !response.data.messages) return null;

    // Boundary: require thread id from API response
    if (!response.data.id) {
      throw new Error(`Gmail API returned thread without id for threadId=${threadId}`);
    }

    const messages: EmailDetail[] = response.data.messages
      .filter((msg) => msg.id) // boundary: skip messages without an id
      .map((msg) => {
        const msgId = msg.id as string; // boundary-ok: filtered above
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name === name)?.value || '';

        return {
          id: msgId,
          threadId: msg.threadId || msgId,
          from: getHeader('From'),
          subject: getHeader('Subject'),
          snippet: msg.snippet || '',
          date: getHeader('Date'),
          isUnread: msg.labelIds?.includes('UNREAD') || false,
          body: extractBodyText(msg.payload),
        };
      });

    return {
      id: response.data.id,
      messages,
    };
  } catch (error) {
    return handleGmailApiError(error, phoneNumber);
  }
}
