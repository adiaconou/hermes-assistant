/**
 * Email (Gmail) tools.
 */

import type { ToolDefinition } from '../types.js';
import { requirePhoneNumber, handleAuthError } from './utils.js';
import { listEmails, getEmail } from '../../services/google/gmail.js';

export const getEmails: ToolDefinition = {
  tool: {
    name: 'get_emails',
    description: `Search and retrieve emails from the user's Gmail inbox.

Use for checking unread emails, finding emails from specific senders, or searching by subject/content.

Query examples:
- "is:unread" - unread emails
- "from:john@example.com" - emails from John
- "subject:meeting" - emails about meetings
- "newer_than:1d" - emails from last 24 hours
- "has:attachment" - emails with attachments
- Combine: "is:unread from:boss"

Returns sender, subject, date, and preview snippet.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query (default: "is:unread"). Examples: "is:unread", "from:boss@company.com"',
        },
        max_results: {
          type: 'number',
          description: 'Maximum emails to return (default: 5, max: 10)',
        },
      },
      required: [],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { query, max_results } = input as {
      query?: string;
      max_results?: number;
    };

    try {
      const emails = await listEmails(phoneNumber, {
        query: query || 'is:unread',
        maxResults: Math.min(max_results || 5, 10),
      });

      console.log(JSON.stringify({
        level: 'info',
        message: 'Fetched emails',
        count: emails.length,
        query: query || 'is:unread',
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        count: emails.length,
        emails: emails.map((e) => ({
          id: e.id,
          from: e.from,
          subject: e.subject,
          snippet: e.snippet,
          date: e.date,
          unread: e.isUnread,
        })),
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber);
      if (authResult) {
        console.log(JSON.stringify({
          level: 'info',
          message: 'Gmail auth required, returning auth URL',
          authUrl: authResult.auth_url,
          timestamp: new Date().toISOString(),
        }));
        return authResult;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({
        level: 'error',
        message: 'Email fetch failed',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: `Failed to fetch emails: ${errorMessage}`,
        hint: 'This is an unexpected error. Please try again or contact support.',
      };
    }
  },
};

export const readEmail: ToolDefinition = {
  tool: {
    name: 'read_email',
    description: `Get the full content of a specific email by its ID.

Use after get_emails when the user wants to read the full message, not just the preview.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        email_id: {
          type: 'string',
          description: 'The email ID from get_emails',
        },
      },
      required: ['email_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { email_id } = input as { email_id: string };

    try {
      const email = await getEmail(phoneNumber, email_id);

      if (!email) {
        return { success: false, error: 'Email not found' };
      }

      // Truncate very long emails to avoid context limits
      const maxBodyLength = 30000;
      const truncatedBody = email.body.length > maxBodyLength
        ? email.body.substring(0, maxBodyLength) + '...'
        : email.body;

      console.log(JSON.stringify({
        level: 'info',
        message: 'Read email',
        emailId: email_id,
        bodyLength: email.body.length,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        email: {
          from: email.from,
          subject: email.subject,
          date: email.date,
          body: truncatedBody,
        },
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber);
      if (authResult) return authResult;

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({
        level: 'error',
        message: 'Email read failed',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: `Failed to read email: ${errorMessage}`,
        hint: 'This is an unexpected error. Please try again or contact support.',
      };
    }
  },
};
