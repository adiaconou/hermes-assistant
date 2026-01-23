/**
 * @fileoverview Gmail service.
 *
 * Provides listEmails and getEmail functions with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, gmail_v1 } from 'googleapis';
import config from '../../config.js';
import { getCredentialStore } from '../credentials/index.js';
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
 * Create an OAuth2 client with stored credentials.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Refresh an expired access token using the refresh token.
 */
async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error('Failed to refresh access token');
  }

  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date || Date.now() + 3600000,
  };
}

/**
 * Get an authenticated Gmail client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getGmailClient(phoneNumber: string): Promise<gmail_v1.Gmail> {
  const store = getCredentialStore();
  let creds = await store.get(phoneNumber, 'google');

  if (!creds) {
    throw new AuthRequiredError(phoneNumber);
  }

  // Refresh if token expires in < 5 minutes
  const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
  if (creds.expiresAt < Date.now() + REFRESH_THRESHOLD_MS) {
    try {
      const refreshed = await refreshAccessToken(creds.refreshToken);
      creds = {
        ...creds,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      };
      await store.set(phoneNumber, 'google', creds);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Refreshed Google access token',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Token refresh failed, removing credentials',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }));
      await store.delete(phoneNumber, 'google');
      throw new AuthRequiredError(phoneNumber);
    }
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: creds.accessToken });

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

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: query,
  });

  if (!response.data.messages?.length) {
    return [];
  }

  // Fetch metadata for each message
  const emails = await Promise.all(
    response.data.messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

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

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: emailId,
    format: 'full',
  });

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
