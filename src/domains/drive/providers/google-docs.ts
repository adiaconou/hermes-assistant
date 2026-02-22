/**
 * @fileoverview Google Docs service.
 */

import { docs as docsApi, docs_v1 } from '@googleapis/docs';
import { getAuthenticatedClient, withRetry, getOrCreateHermesFolder, moveToHermesFolder, searchFiles } from './google-core.js';
import type { Document, DocumentContent } from '../types.js';

async function getDocsClient(phoneNumber: string): Promise<docs_v1.Docs> {
  const oauth2Client = await getAuthenticatedClient(phoneNumber, 'Docs');
  return docsApi({ version: 'v1', auth: oauth2Client });
}

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

export async function createDocument(
  phoneNumber: string,
  title: string,
  content?: string,
  folderId?: string
): Promise<Document> {
  const docs = await getDocsClient(phoneNumber);

  const response = await withRetry(() =>
    docs.documents.create({
      requestBody: {
        title,
      },
    }), phoneNumber
  );

  const documentId = response.data.documentId!;
  const documentUrl = `https://docs.google.com/document/d/${documentId}`;

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

export async function appendText(
  phoneNumber: string,
  documentId: string,
  text: string
): Promise<void> {
  const docs = await getDocsClient(phoneNumber);

  const docResponse = await withRetry(() =>
    docs.documents.get({
      documentId,
    }), phoneNumber
  );

  const body = docResponse.data.body;
  let endIndex = 1;

  if (body?.content) {
    const lastElement = body.content[body.content.length - 1];
    if (lastElement?.endIndex) {
      endIndex = lastElement.endIndex - 1;
    }
  }

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

export async function findDocument(
  phoneNumber: string,
  title: string
): Promise<Document | null> {
  const files = await searchFiles(phoneNumber, {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
    inHermesFolder: true,
  });

  if (files.length === 0) {
    return null;
  }

  const exactMatch = files.find(f => f.name === title);
  const match = exactMatch || files[0];

  return {
    id: match.id,
    title: match.name,
    url: match.webViewLink || `https://docs.google.com/document/d/${match.id}`,
  };
}
