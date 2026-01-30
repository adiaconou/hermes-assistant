/**
 * Email tools (Gmail).
 */

import type { ToolDefinition } from './types.js';
import { requirePhoneNumber, handleAuthError } from './utils.js';
import { listEmails, readEmail as readEmailService } from '../services/google/gmail.js';

export const getEmails: ToolDefinition = {
  tool: {
    name: 'get_emails',
    description: "List the user's recent emails. Use this to get message IDs before calling read_email.",
    input_schema: {
      type: 'object' as const,
      properties: {
        max_results: {
          type: 'number',
          description: 'Maximum number of emails to return (default 10)',
        },
        include_spam: {
          type: 'boolean',
          description: 'Include spam emails (default false)',
        },
      },
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { max_results = 10, include_spam = false } = input as {
      max_results?: number;
      include_spam?: boolean;
    };

    try {
      const emails = await listEmails(phoneNumber, {
        maxResults: Math.min(Math.max(max_results ?? 10, 1), 50),
        includeSpamTrash: include_spam ?? false,
      });
      return { success: true, emails };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const readEmail: ToolDefinition = {
  tool: {
    name: 'read_email',
    description: 'Read a specific email by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Email ID from get_emails',
        },
      },
      required: ['id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { id } = input as { id: string };

    try {
      const email = await readEmailService(phoneNumber, id);
      return { success: true, email };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
