/**
 * @fileoverview Email domain type definitions.
 */

// Re-export AuthRequiredError for convenience
export { AuthRequiredError } from '../../providers/auth.js';

/** Email returned by list operations. */
export interface Email {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
}

/** Email with full body content. */
export interface EmailDetail extends Email {
  body: string;
}

/** Thread with all messages in the conversation. */
export interface EmailThread {
  id: string;
  messages: EmailDetail[];
}
