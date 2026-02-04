/**
 * Google Drive tools.
 */

import type { ToolDefinition } from './types.js';
import { requirePhoneNumber, handleAuthError } from './utils.js';
import {
  uploadFile,
  listFiles,
  createFolder,
  readFileContent,
  searchFiles,
  getOrCreateHermesFolder,
} from '../services/google/drive.js';

export const uploadToDrive: ToolDefinition = {
  tool: {
    name: 'upload_to_drive',
    description: "Upload a file or image to the user's Google Drive (in the Hermes folder). Use when saving attachments, images, or documents.",
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'File name including extension (e.g., "receipt.jpg", "notes.txt")',
        },
        content: {
          type: 'string',
          description: 'File content as base64 encoded string (for binary) or plain text',
        },
        mime_type: {
          type: 'string',
          description: 'MIME type (e.g., "image/jpeg", "text/plain", "application/pdf")',
        },
        folder_id: {
          type: 'string',
          description: 'Optional folder ID to upload to (defaults to Hermes root folder)',
        },
        description: {
          type: 'string',
          description: 'Optional file description',
        },
        is_base64: {
          type: 'boolean',
          description: 'Whether the content is base64 encoded (default: true for binary files)',
        },
      },
      required: ['name', 'content', 'mime_type'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { name, content, mime_type, folder_id, description, is_base64 } = input as {
      name: string;
      content: string;
      mime_type: string;
      folder_id?: string;
      description?: string;
      is_base64?: boolean;
    };

    try {
      // Determine if content is binary based on mime type
      const isBinary = is_base64 !== false && (
        mime_type.startsWith('image/') ||
        mime_type.startsWith('application/') ||
        is_base64 === true
      );

      const contentBuffer = isBinary
        ? Buffer.from(content, 'base64')
        : content;

      const file = await uploadFile(phoneNumber, {
        name,
        mimeType: mime_type,
        content: contentBuffer,
        folderId: folder_id,
        description,
      });

      console.log(JSON.stringify({
        level: 'info',
        message: 'File uploaded to Drive',
        fileId: file.id,
        fileName: name,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
        },
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Upload to Drive failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
        folder_id: {
          type: 'string',
          description: 'Optional folder ID to list files from (defaults to Hermes root folder)',
        },
        mime_type: {
          type: 'string',
          description: 'Optional MIME type filter (e.g., "application/vnd.google-apps.spreadsheet")',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of files to return (default: 50)',
        },
      },
      required: [],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { folder_id, mime_type, max_results } = input as {
      folder_id?: string;
      mime_type?: string;
      max_results?: number;
    };

    try {
      const files = await listFiles(phoneNumber, folder_id, {
        mimeType: mime_type,
        maxResults: max_results,
      });

      return {
        success: true,
        files: files.map(f => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          webViewLink: f.webViewLink,
          modifiedTime: f.modifiedTime,
        })),
        count: files.length,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'List Drive files failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
        name: {
          type: 'string',
          description: 'Folder name',
        },
        parent_id: {
          type: 'string',
          description: 'Optional parent folder ID (defaults to Hermes root folder)',
        },
      },
      required: ['name'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { name, parent_id } = input as {
      name: string;
      parent_id?: string;
    };

    try {
      const folder = await createFolder(phoneNumber, name, parent_id);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Drive folder created',
        folderId: folder.id,
        folderName: name,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        folder: {
          id: folder.id,
          name: folder.name,
          webViewLink: folder.webViewLink,
        },
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Create Drive folder failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
        file_id: {
          type: 'string',
          description: 'The file ID to read',
        },
      },
      required: ['file_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { file_id } = input as { file_id: string };

    try {
      const content = await readFileContent(phoneNumber, file_id);

      return {
        success: true,
        content,
        length: content.length,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Read Drive file failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
        name: {
          type: 'string',
          description: 'Search for files containing this name',
        },
        mime_type: {
          type: 'string',
          description: 'Filter by MIME type (e.g., "application/vnd.google-apps.spreadsheet" for Sheets)',
        },
        search_outside_hermes: {
          type: 'boolean',
          description: 'If true, search all of Drive (read-only). Default is false (Hermes folder only).',
        },
      },
      required: [],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { name, mime_type, search_outside_hermes } = input as {
      name?: string;
      mime_type?: string;
      search_outside_hermes?: boolean;
    };

    try {
      const files = await searchFiles(phoneNumber, {
        name,
        mimeType: mime_type,
        inHermesFolder: !search_outside_hermes,
      });

      return {
        success: true,
        files: files.map(f => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          webViewLink: f.webViewLink,
          modifiedTime: f.modifiedTime,
        })),
        count: files.length,
        searchedOutsideHermes: search_outside_hermes || false,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Search Drive failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const getHermesFolder: ToolDefinition = {
  tool: {
    name: 'get_hermes_folder',
    description: "Get the ID and link to the user's Hermes folder (creates it if needed).",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  handler: async (_input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    try {
      const folderId = await getOrCreateHermesFolder(phoneNumber);

      return {
        success: true,
        folderId,
        webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Get Hermes folder failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
