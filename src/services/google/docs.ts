/**
 * @fileoverview Google Docs service.
 *
 * Provides Docs operations with automatic token refresh.
 * Throws AuthRequiredError when user hasn't connected their Google account.
 */

import { google, docs_v1 } from 'googleapis';
import { getAuthenticatedClient, withRetry } from './auth.js';
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
 * Get an authenticated Docs client for a phone number.
 * Automatically refreshes token if expired.
 * @throws AuthRequiredError if no credentials exist
 */
async function getDocsClient(
  phoneNumber: string
): Promise<docs_v1.Docs> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Docs');
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
