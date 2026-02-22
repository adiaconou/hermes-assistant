/**
 * Email tools (Gmail).
 */

import type { ToolDefinition } from '../../../tools/types.js';
import { requirePhoneNumber, handleAuthError } from '../../../tools/utils.js';
import { listEmails, getEmail as getEmailService, getThread as getThreadService } from '../providers/gmail.js';

export const getEmails: ToolDefinition = {
  tool: {
    name: 'get_emails',
    description: `Search and list emails from Gmail. Supports full Gmail search syntax.

Common search operators:
- from:sender@example.com - Emails from specific sender
- to:recipient@example.com - Emails to specific recipient
- subject:keyword - Search in subject line
- is:unread - Only unread emails
- has:attachment - Emails with attachments
- newer_than:7d - Last 7 days (also: 1d, 1m, 1y)
- older_than:30d - Older than 30 days
- after:2024/01/01 - After specific date
- before:2024/12/31 - Before specific date
- label:travel - Emails with specific label

Combine operators: "from:hotel newer_than:1y subject:confirmation"`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query using Gmail search syntax. If not provided, returns recent inbox emails.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of emails to return (1-50, default 10)',
        },
        include_spam: {
          type: 'boolean',
          description: 'Include spam folder in search (default false)',
        },
      },
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { query: userQuery, max_results = 10, include_spam = false } = input as {
      query?: string;
      max_results?: number;
      include_spam?: boolean;
    };

    try {
      let query = userQuery;
      if (!query) {
        query = include_spam ? undefined : 'is:inbox';
      } else if (!include_spam && !query.includes('in:spam')) {
        query = `(${query}) AND is:inbox`;
      }

      const emails = await listEmails(phoneNumber, {
        maxResults: Math.min(Math.max(max_results ?? 10, 1), 50),
        query,
      });
      return { success: true, emails, query_used: query };
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
    description: 'Read a specific email by ID. Returns full email content including body.',
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
      const email = await getEmailService(phoneNumber, id);
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

export const getEmailThread: ToolDefinition = {
  tool: {
    name: 'get_email_thread',
    description: `Get all emails in a conversation thread. Use this when you find a relevant email and want to see the full conversation context (replies, follow-ups, etc.).

This is useful for:
- Finding related confirmation emails in a thread
- Getting full context when a snippet mentions something relevant
- Following a conversation to find specific details`,
    input_schema: {
      type: 'object' as const,
      properties: {
        thread_id: {
          type: 'string',
          description: 'Thread ID from get_emails (the threadId field)',
        },
      },
      required: ['thread_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);
    const { thread_id } = input as { thread_id: string };

    try {
      const thread = await getThreadService(phoneNumber, thread_id);
      if (!thread) {
        return { success: false, error: 'Thread not found' };
      }
      return {
        success: true,
        thread_id: thread.id,
        message_count: thread.messages.length,
        messages: thread.messages,
      };
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
