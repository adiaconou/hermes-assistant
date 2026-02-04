/**
 * Google Docs tools.
 */

import type { ToolDefinition } from './types.js';
import { requirePhoneNumber, handleAuthError } from './utils.js';
import {
  createDocument,
  readDocumentContent,
  appendText,
  findDocument,
} from '../services/google/docs.js';

export const createDocumentTool: ToolDefinition = {
  tool: {
    name: 'create_document',
    description: 'Create a new Google Document in the Hermes folder. Use for meeting notes, drafts, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Document title (e.g., "Meeting Notes - Jan 15")',
        },
        content: {
          type: 'string',
          description: 'Optional initial content for the document',
        },
        folder_id: {
          type: 'string',
          description: 'Optional folder ID to create in (defaults to Hermes root folder)',
        },
      },
      required: ['title'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { title, content, folder_id } = input as {
      title: string;
      content?: string;
      folder_id?: string;
    };

    try {
      const document = await createDocument(phoneNumber, title, content, folder_id);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Document created',
        documentId: document.id,
        title,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        document: {
          id: document.id,
          title: document.title,
          url: document.url,
        },
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Create document failed',
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

export const readDocument: ToolDefinition = {
  tool: {
    name: 'read_document',
    description: 'Read the content of a Google Document. Returns the plain text content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        document_id: {
          type: 'string',
          description: 'Document ID (from find_document or create_document)',
        },
      },
      required: ['document_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { document_id } = input as { document_id: string };

    try {
      const content = await readDocumentContent(phoneNumber, document_id);

      return {
        success: true,
        title: content.title,
        body: content.body,
        length: content.body.length,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Read document failed',
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

export const appendToDocument: ToolDefinition = {
  tool: {
    name: 'append_to_document',
    description: 'Append text to the end of a Google Document. Use for adding notes or updates to existing documents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        document_id: {
          type: 'string',
          description: 'Document ID (from find_document or create_document)',
        },
        text: {
          type: 'string',
          description: 'Text to append to the document',
        },
      },
      required: ['document_id', 'text'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { document_id, text } = input as {
      document_id: string;
      text: string;
    };

    try {
      await appendText(phoneNumber, document_id, text);

      return {
        success: true,
        appendedLength: text.length,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Append to document failed',
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

export const findDocumentTool: ToolDefinition = {
  tool: {
    name: 'find_document',
    description: 'Find a Google Document by name in the Hermes folder. Use to check if a document exists before creating a new one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Document title to search for (e.g., "Meeting Notes")',
        },
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
        return {
          success: true,
          found: false,
          message: `No document found with title "${title}"`,
        };
      }

      return {
        success: true,
        found: true,
        document: {
          id: document.id,
          title: document.title,
          url: document.url,
        },
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Find document failed',
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
