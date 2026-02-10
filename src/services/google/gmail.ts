/**
 * @fileoverview Gmail service.
 *
 * Provides listEmails and getEmail functions with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, gmail_v1 } from 'googleapis';
import { getAuthenticatedClient, withRetry, isInsufficientScopesError, handleScopeError } from './auth.js';
import { AuthRequiredError } from './calendar.js';

/**
 * Email returned by list operations.
 */
export interface Email {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
}

/**
 * Email with full body content.
 */
export interface EmailDetail extends Email {
  body: string;
}

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
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getGmailClient(phoneNumber: string): Promise<gmail_v1.Gmail> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Gmail');
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * List emails matching a query.
 *
 * @param phoneNumber - User's phone number
 * @param options - Query options
 * @returns Array of emails
 * @throws AuthRequiredError if not authenticated
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

    // Fetch metadata for each message
    const emails = await Promise.all(
      response.data.messages.map(async (msg) => {
        const detail = await withRetry(() => gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        }), phoneNumber, 'Gmail');

        const headers = detail.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name === name)?.value || '';

        return {
          id: msg.id!,
          threadId: msg.threadId!,
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
 * Get full email content by ID.
 *
 * @param phoneNumber - User's phone number
 * @param emailId - Email ID
 * @returns Email with body content
 * @throws AuthRequiredError if not authenticated
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

    return {
      id: response.data.id!,
      threadId: response.data.threadId!,
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
 * Extract plain text body from Gmail message payload.
 */
function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Direct body (simple messages)
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // Multipart - find text/plain part
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      // Recurse into nested parts (e.g., multipart/alternative)
      const nested = extractBodyText(part);
      if (nested) return nested;
    }
  }

  return '';
}

/**
 * Thread with all messages in the conversation.
 */
export interface EmailThread {
  id: string;
  messages: EmailDetail[];
}

/**
 * Get all messages in an email thread.
 *
 * @param phoneNumber - User's phone number
 * @param threadId - Thread ID from get_emails
 * @returns Thread with all messages
 * @throws AuthRequiredError if not authenticated
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

    const messages: EmailDetail[] = response.data.messages.map((msg) => {
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name === name)?.value || '';

      return {
        id: msg.id!,
        threadId: msg.threadId!,
        from: getHeader('From'),
        subject: getHeader('Subject'),
        snippet: msg.snippet || '',
        date: getHeader('Date'),
        isUnread: msg.labelIds?.includes('UNREAD') || false,
        body: extractBodyText(msg.payload),
      };
    });

    return {
      id: response.data.id!,
      messages,
    };
  } catch (error) {
    return handleGmailApiError(error, phoneNumber);
  }
}
