/**
 * Drive, Sheets, Docs, and Vision tools.
 */

import type { ToolDefinition } from '../../../tools/types.js';
import { requirePhoneNumber, handleAuthError } from '../../../tools/utils.js';
import type { StoredMediaAttachment } from '../../../services/conversation/types.js';
import {
  uploadFile,
  listFiles,
  createFolder,
  readFileContent,
  downloadFile,
} from '../providers/google-drive.js';
import { getOrCreateHermesFolder, searchFiles } from '../providers/google-core.js';
import {
  createSpreadsheet,
  readRange,
  writeRange,
  appendRows,
  findSpreadsheet,
} from '../providers/google-sheets.js';
import {
  createDocument,
  readDocumentContent,
  appendText,
  findDocument,
} from '../providers/google-docs.js';
import { analyzeImage, isAnalyzableImage } from '../providers/gemini-vision.js';
import { GeminiNotConfiguredError } from '../types.js';
import { downloadTwilioMedia, getMediaErrorMessage, isImageType } from '../../../services/twilio/media.js';
import { getConversationStore } from '../../../services/conversation/index.js';

// ===== Drive Tools =====

export const uploadToDrive: ToolDefinition = {
  tool: {
    name: 'upload_to_drive',
    description: "Upload a file or image to the user's Google Drive (in the Hermes folder). Use when saving attachments, images, or documents.",
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'File name including extension (e.g., "receipt.jpg", "notes.txt")' },
        content: { type: 'string', description: 'File content as base64 encoded string (for binary) or plain text' },
        mime_type: { type: 'string', description: 'MIME type (e.g., "image/jpeg", "text/plain", "application/pdf")' },
        folder_id: { type: 'string', description: 'Optional folder ID to upload to (defaults to Hermes root folder)' },
        description: { type: 'string', description: 'Optional file description' },
        is_base64: { type: 'boolean', description: 'Whether the content is base64 encoded (default: true for binary files)' },
      },
      required: ['name', 'content', 'mime_type'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { name, content, mime_type, folder_id, description, is_base64 } = input as {
      name: string; content: string; mime_type: string; folder_id?: string; description?: string; is_base64?: boolean;
    };
    try {
      const isBinary = is_base64 !== false && (mime_type.startsWith('image/') || mime_type.startsWith('application/') || is_base64 === true);
      const contentBuffer = isBinary ? Buffer.from(content, 'base64') : content;
      const file = await uploadFile(phoneNumber, { name, mimeType: mime_type, content: contentBuffer, folderId: folder_id, description });
      console.log(JSON.stringify({ level: 'info', message: 'File uploaded to Drive', fileId: file.id, fileName: name, timestamp: new Date().toISOString() }));
      return { success: true, file: { id: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink } };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Upload to Drive failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const listDriveFiles: ToolDefinition = {
  tool: {
    name: 'list_drive_files',
    description: "List files in the user's Hermes folder or a subfolder. Use to see what files exist.",
    input_schema: {
      type: 'object' as const,
      properties: {
        folder_id: { type: 'string', description: 'Optional folder ID to list files from (defaults to Hermes root folder)' },
        mime_type: { type: 'string', description: 'Optional MIME type filter (e.g., "application/vnd.google-apps.spreadsheet")' },
        max_results: { type: 'number', description: 'Maximum number of files to return (default: 50)' },
      },
      required: [],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { folder_id, mime_type, max_results } = input as { folder_id?: string; mime_type?: string; max_results?: number };
    try {
      const files = await listFiles(phoneNumber, folder_id, { mimeType: mime_type, maxResults: max_results });
      return { success: true, files: files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink, modifiedTime: f.modifiedTime })), count: files.length };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'List Drive files failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const createDriveFolder: ToolDefinition = {
  tool: {
    name: 'create_drive_folder',
    description: 'Create a folder in the Hermes hierarchy. Use to organize files by category.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parent_id: { type: 'string', description: 'Optional parent folder ID (defaults to Hermes root folder)' },
      },
      required: ['name'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { name, parent_id } = input as { name: string; parent_id?: string };
    try {
      const folder = await createFolder(phoneNumber, name, parent_id);
      console.log(JSON.stringify({ level: 'info', message: 'Drive folder created', folderId: folder.id, folderName: name, timestamp: new Date().toISOString() }));
      return { success: true, folder: { id: folder.id, name: folder.name, webViewLink: folder.webViewLink } };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Create Drive folder failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const readDriveFile: ToolDefinition = {
  tool: {
    name: 'read_drive_file',
    description: 'Read text content from a file in Drive. Use for text files, not for Google Docs/Sheets (use their specific tools instead).',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string', description: 'The file ID to read' },
      },
      required: ['file_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { file_id } = input as { file_id: string };
    try {
      const content = await readFileContent(phoneNumber, file_id);
      return { success: true, content, length: content.length };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Read Drive file failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const searchDrive: ToolDefinition = {
  tool: {
    name: 'search_drive',
    description: 'Search for files by name or type in the Hermes folder. Use to find existing files before creating new ones.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Search for files containing this name' },
        mime_type: { type: 'string', description: 'Filter by MIME type (e.g., "application/vnd.google-apps.spreadsheet" for Sheets)' },
        search_outside_hermes: { type: 'boolean', description: 'If true, search all of Drive (read-only). Default is false (Hermes folder only).' },
      },
      required: [],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { name, mime_type, search_outside_hermes } = input as { name?: string; mime_type?: string; search_outside_hermes?: boolean };
    try {
      const files = await searchFiles(phoneNumber, { name, mimeType: mime_type, inHermesFolder: !search_outside_hermes });
      return { success: true, files: files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink, modifiedTime: f.modifiedTime })), count: files.length, searchedOutsideHermes: search_outside_hermes || false };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Search Drive failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const getHermesFolder: ToolDefinition = {
  tool: {
    name: 'get_hermes_folder',
    description: "Get the ID and link to the user's Hermes folder (creates it if needed).",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  handler: async (_input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    try {
      const folderId = await getOrCreateHermesFolder(phoneNumber);
      return { success: true, folderId, webViewLink: `https://drive.google.com/drive/folders/${folderId}` };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Get Hermes folder failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== Sheets Tools =====

export const createSpreadsheetTool: ToolDefinition = {
  tool: {
    name: 'create_spreadsheet',
    description: 'Create a new Google Spreadsheet in the Hermes folder. Use for tracking expenses, logs, contacts, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Spreadsheet title (e.g., "Expense Tracker", "Contacts")' },
        folder_id: { type: 'string', description: 'Optional folder ID to create in (defaults to Hermes root folder)' },
      },
      required: ['title'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { title, folder_id } = input as { title: string; folder_id?: string };
    try {
      const spreadsheet = await createSpreadsheet(phoneNumber, title, folder_id);
      console.log(JSON.stringify({ level: 'info', message: 'Spreadsheet created', spreadsheetId: spreadsheet.id, title, timestamp: new Date().toISOString() }));
      return { success: true, spreadsheet: { id: spreadsheet.id, title: spreadsheet.title, url: spreadsheet.url } };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Create spreadsheet failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const readSpreadsheet: ToolDefinition = {
  tool: {
    name: 'read_spreadsheet',
    description: 'Read a range of cells from a Google Spreadsheet. Use to view spreadsheet data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spreadsheet_id: { type: 'string', description: 'Spreadsheet ID (from find_spreadsheet or create_spreadsheet)' },
        range: { type: 'string', description: 'A1 notation range (e.g., "Sheet1!A1:D10", "A:D" for entire columns)' },
      },
      required: ['spreadsheet_id', 'range'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { spreadsheet_id, range } = input as { spreadsheet_id: string; range: string };
    try {
      const data = await readRange(phoneNumber, spreadsheet_id, range);
      return { success: true, range: data.range, values: data.values, rowCount: data.values.length, columnCount: data.values.length > 0 ? data.values[0].length : 0 };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Read spreadsheet failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const writeSpreadsheet: ToolDefinition = {
  tool: {
    name: 'write_spreadsheet',
    description: 'Write data to a specific range of cells in a Google Spreadsheet. Use for updating existing data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spreadsheet_id: { type: 'string', description: 'Spreadsheet ID (from find_spreadsheet or create_spreadsheet)' },
        range: { type: 'string', description: 'A1 notation range (e.g., "Sheet1!A1:D3")' },
        values: { type: 'array', description: '2D array of values to write. Each inner array is a row.', items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } } },
      },
      required: ['spreadsheet_id', 'range', 'values'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { spreadsheet_id, range, values } = input as { spreadsheet_id: string; range: string; values: (string | number | boolean | null)[][] };
    try {
      const result = await writeRange(phoneNumber, spreadsheet_id, range, values);
      return { success: true, updatedCells: result.updatedCells, updatedRows: result.updatedRows, updatedColumns: result.updatedColumns };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Write spreadsheet failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const appendToSpreadsheet: ToolDefinition = {
  tool: {
    name: 'append_to_spreadsheet',
    description: 'Append rows to a Google Spreadsheet. Use for adding new entries to logs, expense trackers, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spreadsheet_id: { type: 'string', description: 'Spreadsheet ID (from find_spreadsheet or create_spreadsheet)' },
        range: { type: 'string', description: "A1 notation range (e.g., \"Sheet1!A:D\"). Rows will be appended after existing data." },
        rows: { type: 'array', description: 'Array of rows to append. Each row is an array of values.', items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } } },
      },
      required: ['spreadsheet_id', 'range', 'rows'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { spreadsheet_id, range, rows } = input as { spreadsheet_id: string; range: string; rows: (string | number | boolean | null)[][] };
    try {
      const result = await appendRows(phoneNumber, spreadsheet_id, range, rows);
      return { success: true, updatedRange: result.updatedRange, updatedRows: result.updatedRows };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Append to spreadsheet failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const findSpreadsheetTool: ToolDefinition = {
  tool: {
    name: 'find_spreadsheet',
    description: 'Find a Google Spreadsheet by name in the Hermes folder. Use to check if a spreadsheet exists before creating a new one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Spreadsheet title to search for (e.g., "Expense Tracker")' },
      },
      required: ['title'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { title } = input as { title: string };
    try {
      const spreadsheet = await findSpreadsheet(phoneNumber, title);
      if (!spreadsheet) {
        return { success: true, found: false, message: `No spreadsheet found with title "${title}"` };
      }
      return { success: true, found: true, spreadsheet: { id: spreadsheet.id, title: spreadsheet.title, url: spreadsheet.url } };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Find spreadsheet failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== Docs Tools =====

export const createDocumentTool: ToolDefinition = {
  tool: {
    name: 'create_document',
    description: 'Create a new Google Document in the Hermes folder. Use for meeting notes, drafts, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Document title (e.g., "Meeting Notes - Jan 15")' },
        content: { type: 'string', description: 'Optional initial content for the document' },
        folder_id: { type: 'string', description: 'Optional folder ID to create in (defaults to Hermes root folder)' },
      },
      required: ['title'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { title, content, folder_id } = input as { title: string; content?: string; folder_id?: string };
    try {
      const document = await createDocument(phoneNumber, title, content, folder_id);
      console.log(JSON.stringify({ level: 'info', message: 'Document created', documentId: document.id, title, timestamp: new Date().toISOString() }));
      return { success: true, document: { id: document.id, title: document.title, url: document.url } };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Create document failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const readDocument: ToolDefinition = {
  tool: {
    name: 'read_document',
    description: 'Read the content of a Google Document. Returns the plain text content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        document_id: { type: 'string', description: 'Document ID (from find_document or create_document)' },
      },
      required: ['document_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { document_id } = input as { document_id: string };
    try {
      const content = await readDocumentContent(phoneNumber, document_id);
      return { success: true, title: content.title, body: content.body, length: content.body.length };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Read document failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const appendToDocument: ToolDefinition = {
  tool: {
    name: 'append_to_document',
    description: 'Append text to the end of a Google Document. Use for adding notes or updates to existing documents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        document_id: { type: 'string', description: 'Document ID (from find_document or create_document)' },
        text: { type: 'string', description: 'Text to append to the document' },
      },
      required: ['document_id', 'text'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { document_id, text } = input as { document_id: string; text: string };
    try {
      await appendText(phoneNumber, document_id, text);
      return { success: true, appendedLength: text.length };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Append to document failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const findDocumentTool: ToolDefinition = {
  tool: {
    name: 'find_document',
    description: 'Find a Google Document by name in the Hermes folder. Use to check if a document exists before creating a new one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Document title to search for (e.g., "Meeting Notes")' },
      },
      required: ['title'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { title } = input as { title: string };
    try {
      const document = await findDocument(phoneNumber, title);
      if (!document) {
        return { success: true, found: false, message: `No document found with title "${title}"` };
      }
      return { success: true, found: true, document: { id: document.id, title: document.title, url: document.url } };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;
      console.error(JSON.stringify({ level: 'error', message: 'Find document failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== Vision Tool =====

export const analyzeImageTool: ToolDefinition = {
  tool: {
    name: 'analyze_image',
    description: `Analyze an image using AI vision. Use this to:
- Identify what type of document an image is (receipt, business card, screenshot, etc.)
- Extract text and data from images (OCR)
- Describe what's in a photo
- Answer questions about image content

The image must be provided as either:
1. A Twilio media URL (from an inbound message attachment)
2. A Google Drive file ID (for previously uploaded images)
3. Base64-encoded image data with mime type

Common analysis prompts:
- "What type of document is this?"
- "Extract all text from this image"
- "Extract receipt data as JSON"
- "Extract contact information from this business card"
- "Describe what's in this image"`,
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'What to analyze or extract from the image. Be specific about what information you want.' },
        media_url: { type: 'string', description: 'Twilio media URL from an inbound message (if available)' },
        drive_file_id: { type: 'string', description: 'Google Drive file ID for a previously uploaded image' },
        image_base64: { type: 'string', description: 'Base64-encoded image data (if no media_url or drive_file_id)' },
        mime_type: { type: 'string', description: 'MIME type of the image (required if using image_base64)' },
        attachment_index: { type: 'number', description: 'Index of the media attachment to analyze (0-based, defaults to 0)' },
      },
      required: ['prompt'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { prompt, media_url, drive_file_id, image_base64, mime_type, attachment_index } = input as {
      prompt: string; media_url?: string; drive_file_id?: string; image_base64?: string; mime_type?: string; attachment_index?: number;
    };

    try {
      let imageBuffer: Buffer;
      let imageMimeType: string;
      let storedItem: StoredMediaAttachment | undefined;
      let source: 'media_url' | 'drive_file_id' | 'storedMedia' | 'mediaAttachments' | 'base64' | 'none' = 'none';
      const attachmentIndex = attachment_index ?? 0;

      if (media_url) {
        source = 'media_url';
        const downloaded = await downloadTwilioMedia(media_url);
        if (!isImageType(downloaded.contentType)) {
          return { success: false, error: 'The provided media is not an image. Use this tool only for images.' };
        }
        imageBuffer = downloaded.buffer;
        imageMimeType = downloaded.contentType;
      } else if (drive_file_id) {
        source = 'drive_file_id';
        imageBuffer = await downloadFile(phoneNumber, drive_file_id);
        storedItem = context.storedMedia?.find(m => m.driveFileId === drive_file_id);
        imageMimeType = storedItem?.mimeType || 'image/jpeg';
        if (!isImageType(imageMimeType)) {
          return { success: false, error: `Drive file is not an image (${imageMimeType}). Use this tool only for images.` };
        }
      } else if (context.storedMedia && context.storedMedia.length > 0) {
        source = 'storedMedia';
        storedItem = context.storedMedia.find(m => m.originalIndex === attachmentIndex) ?? context.storedMedia[attachmentIndex];
        if (!storedItem) {
          return { success: false, error: `No stored media at index ${attachmentIndex}. Available indices: 0-${context.storedMedia.length - 1}` };
        }
        if (!isImageType(storedItem.mimeType)) {
          return { success: false, error: `Stored media at index ${attachmentIndex} is not an image (${storedItem.mimeType}). Use this tool only for images.` };
        }
        imageBuffer = await downloadFile(phoneNumber, storedItem.driveFileId);
        imageMimeType = storedItem.mimeType;
      } else if (context.mediaAttachments && context.mediaAttachments.length > 0) {
        source = 'mediaAttachments';
        const attachment = context.mediaAttachments[attachmentIndex];
        if (!attachment) {
          return { success: false, error: `No attachment at index ${attachmentIndex}. Available indices: 0-${context.mediaAttachments.length - 1}` };
        }
        if (!isImageType(attachment.contentType)) {
          return { success: false, error: `Attachment at index ${attachmentIndex} is not an image (${attachment.contentType}). Use this tool only for images.` };
        }
        const downloaded = await downloadTwilioMedia(attachment.url);
        imageBuffer = downloaded.buffer;
        imageMimeType = downloaded.contentType;
      } else if (image_base64 && mime_type) {
        source = 'base64';
        if (!isAnalyzableImage(mime_type)) {
          return { success: false, error: `MIME type ${mime_type} is not a supported image type.` };
        }
        imageBuffer = Buffer.from(image_base64, 'base64');
        imageMimeType = mime_type;
      } else {
        return { success: false, error: 'No image provided. Provide media_url, drive_file_id, image_base64+mime_type, or ensure mediaAttachments are in context.' };
      }

      if (!storedItem && (source === 'media_url' || source === 'mediaAttachments')) {
        if (context.storedMedia && context.storedMedia.length > 0) {
          storedItem = context.storedMedia.find(m => m.originalIndex === attachmentIndex) ?? context.storedMedia[attachmentIndex];
        }
      }

      const analysis = await analyzeImage(imageBuffer, imageMimeType, prompt);

      if (context.messageId) {
        try {
          const driveFileId = storedItem?.driveFileId ?? drive_file_id;
          const driveUrl = storedItem?.webViewLink;
          const conversationStore = getConversationStore();
          await conversationStore.addMessageMetadata(
            context.messageId,
            phoneNumber,
            'image_analysis',
            { driveFileId, driveUrl, mimeType: imageMimeType, analysis }
          );
        } catch (metadataError) {
          console.error(JSON.stringify({
            level: 'warn',
            message: 'Failed to persist image analysis metadata',
            error: metadataError instanceof Error ? metadataError.message : String(metadataError),
            timestamp: new Date().toISOString(),
          }));
        }
      }

      return { success: true, analysis, imageSizeBytes: imageBuffer.length, mimeType: imageMimeType };
    } catch (error) {
      if (error instanceof GeminiNotConfiguredError) {
        return { success: false, error: 'Image analysis is not configured. Please contact support.' };
      }
      const mediaError = getMediaErrorMessage(error);
      if (mediaError !== 'Sorry, I had trouble downloading that file. Please try again.') {
        return { success: false, error: mediaError };
      }
      console.error(JSON.stringify({ level: 'error', message: 'Image analysis failed', error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
