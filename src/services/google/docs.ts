/**
 * @fileoverview Google Docs service.
 *
 * Provides Docs operations with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, docs_v1 } from 'googleapis';
import config from '../../config.js';
import { getCredentialStore } from '../credentials/index.js';
import { AuthRequiredError } from './calendar.js';
import { getOrCreateHermesFolder, moveToHermesFolder } from './drive.js';

/**
 * Document returned by our API.
 */
export interface Document {
  id: string;
  title: string;
  url: string;
}

/**
 * Document content.
 */
export interface DocumentContent {
  title: string;
  body: string;
}

/**
 * Retry configuration for Google API calls.
 */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Check if an error is retryable (429 or 5xx).
 */
function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: number }).code;
    return code === 429 || (code >= 500 && code < 600);
  }
  return false;
}

/**
 * Check if an error is due to insufficient OAuth scopes.
 * This happens when user authenticated before Docs scopes were added.
 */
function isInsufficientScopesError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('insufficient authentication scopes') ||
         message.includes('Insufficient Permission');
}

/**
 * Handle Docs API errors, converting scope errors to AuthRequiredError.
 * Deletes credentials if scopes are insufficient so user can re-auth.
 */
async function handleDocsApiError(
  error: unknown,
  phoneNumber: string
): Promise<never> {
  if (isInsufficientScopesError(error)) {
    console.log(JSON.stringify({
      level: 'warn',
      message: 'Docs scope missing, removing credentials for re-auth',
      phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }));

    // Delete credentials so user can re-authenticate with Docs scopes
    const store = getCredentialStore();
    await store.delete(phoneNumber, 'google');

    throw new AuthRequiredError(phoneNumber);
  }

  // Re-throw other errors as-is
  throw error;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and optional scope error handling.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  phoneNumber?: string
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Check for scope errors immediately (don't retry these)
      if (phoneNumber && isInsufficientScopesError(error)) {
        await handleDocsApiError(error, phoneNumber);
      }

      lastError = error;
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        console.log(JSON.stringify({
          level: 'warn',
          message: 'Retrying Google Docs API call',
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          timestamp: new Date().toISOString(),
        }));
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
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
 * Get an authenticated Docs client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getDocsClient(
  phoneNumber: string
): Promise<docs_v1.Docs> {
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
        message: 'Refreshed Google access token for Docs',
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

  return google.docs({ version: 'v1', auth: oauth2Client });
}

/**
 * Extract plain text from a Google Docs body.
 */
function extractTextFromBody(body: docs_v1.Schema$Body | undefined): string {
  if (!body?.content) {
    return '';
  }

  const textParts: string[] = [];

  for (const element of body.content) {
    if (element.paragraph?.elements) {
      for (const paragraphElement of element.paragraph.elements) {
        if (paragraphElement.textRun?.content) {
          textParts.push(paragraphElement.textRun.content);
        }
      }
    }
  }

  return textParts.join('');
}

/**
 * Create a new document.
 *
 * @param phoneNumber - User's phone number
 * @param title - Document title
 * @param content - Optional initial content
 * @param folderId - Optional folder ID to move the document to
 * @returns Created document
 * @throws AuthRequiredError if not authenticated
 */
export async function createDocument(
  phoneNumber: string,
  title: string,
  content?: string,
  folderId?: string
): Promise<Document> {
  const docs = await getDocsClient(phoneNumber);

  // Create the document
  const response = await withRetry(() =>
    docs.documents.create({
      requestBody: {
        title,
      },
    }), phoneNumber
  );

  const documentId = response.data.documentId!;
  const documentUrl = `https://docs.google.com/document/d/${documentId}`;

  // Add initial content if provided
  if (content) {
    await withRetry(() =>
      docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: content,
              },
            },
          ],
        },
      }), phoneNumber
    );
  }

  // Move to Hermes folder if folderId provided, otherwise default to Hermes
  const targetFolder = folderId || await getOrCreateHermesFolder(phoneNumber);
  await moveToHermesFolder(phoneNumber, documentId, targetFolder);

  console.log(JSON.stringify({
    level: 'info',
    message: 'Created document',
    documentId,
    title,
    hasContent: !!content,
    timestamp: new Date().toISOString(),
  }));

  return {
    id: documentId,
    title,
    url: documentUrl,
  };
}

/**
 * Read document content.
 *
 * @param phoneNumber - User's phone number
 * @param documentId - Document ID
 * @returns Document content
 * @throws AuthRequiredError if not authenticated
 */
export async function readDocumentContent(
  phoneNumber: string,
  documentId: string
): Promise<DocumentContent> {
  const docs = await getDocsClient(phoneNumber);

  const response = await withRetry(() =>
    docs.documents.get({
      documentId,
    }), phoneNumber
  );

  return {
    title: response.data.title || '',
    body: extractTextFromBody(response.data.body),
  };
}

/**
 * Append text to the end of a document.
 *
 * @param phoneNumber - User's phone number
 * @param documentId - Document ID
 * @param text - Text to append
 * @throws AuthRequiredError if not authenticated
 */
export async function appendText(
  phoneNumber: string,
  documentId: string,
  text: string
): Promise<void> {
  const docs = await getDocsClient(phoneNumber);

  // First, get the document to find the end index
  const docResponse = await withRetry(() =>
    docs.documents.get({
      documentId,
    }), phoneNumber
  );

  // Find the last index in the document body
  const body = docResponse.data.body;
  let endIndex = 1;

  if (body?.content) {
    const lastElement = body.content[body.content.length - 1];
    if (lastElement?.endIndex) {
      endIndex = lastElement.endIndex - 1;
    }
  }

  // Ensure we have a newline before appending
  const textToAppend = text.startsWith('\n') ? text : '\n' + text;

  await withRetry(() =>
    docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: endIndex },
              text: textToAppend,
            },
          },
        ],
      },
    }), phoneNumber
  );

  console.log(JSON.stringify({
    level: 'info',
    message: 'Appended text to document',
    documentId,
    textLength: text.length,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Find a document by title in the Hermes folder.
 *
 * @param phoneNumber - User's phone number
 * @param title - Document title to search for
 * @returns Found document or null
 * @throws AuthRequiredError if not authenticated
 */
export async function findDocument(
  phoneNumber: string,
  title: string
): Promise<Document | null> {
  // Use Drive search to find documents
  const { searchFiles } = await import('./drive.js');

  const files = await searchFiles(phoneNumber, {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
    inHermesFolder: true,
  });

  if (files.length === 0) {
    return null;
  }

  // Return exact match if found, otherwise first result
  const exactMatch = files.find(f => f.name === title);
  const match = exactMatch || files[0];

  return {
    id: match.id,
    title: match.name,
    url: match.webViewLink || `https://docs.google.com/document/d/${match.id}`,
  };
}
