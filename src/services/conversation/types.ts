/**
 * Conversation Service Types
 *
 * Defines interfaces for persistent conversation storage
 * with memory processing tracking.
 */

/**
 * A single message in a conversation.
 */
export interface ConversationMessage {
  /** Unique identifier for this message */
  id: string;

  /** Phone number of the user */
  phoneNumber: string;

  /** Message role: user or assistant */
  role: 'user' | 'assistant';

  /** Message content */
  content: string;

  /** Channel: sms or whatsapp */
  channel: 'sms' | 'whatsapp';

  /** Unix timestamp (milliseconds) when message was created */
  createdAt: number;

  /** Whether this message has been processed for memory extraction */
  memoryProcessed: boolean;

  /** Unix timestamp (milliseconds) when memory was processed */
  memoryProcessedAt?: number;
}

/**
 * Options for filtering conversation history.
 */
export interface GetHistoryOptions {
  /** Maximum number of messages to return (default: 50) */
  limit?: number;

  /** Filter by memory processing status */
  memoryProcessed?: boolean;

  /** Only include messages created after this timestamp (milliseconds) */
  since?: number;

  /** Only include messages created before this timestamp (milliseconds) */
  until?: number;

  /** Filter by role */
  role?: 'user' | 'assistant';
}

/**
 * Interface for conversation storage operations.
 */
export interface ConversationStore {
  /**
   * Add a message to the conversation.
   * @returns The created message with generated ID
   */
  addMessage(
    phoneNumber: string,
    role: 'user' | 'assistant',
    content: string,
    channel?: 'sms' | 'whatsapp'
  ): Promise<ConversationMessage>;

  /**
   * Get conversation history for a user.
   * Results are returned in chronological order (oldest first).
   * @param phoneNumber User's phone number (optional - if omitted, returns messages for all users)
   * @param options Optional filters
   */
  getHistory(phoneNumber?: string, options?: GetHistoryOptions): Promise<ConversationMessage[]>;

  /**
   * Get unprocessed user messages for async memory extraction.
   * Results are returned in chronological order (oldest first).
   * @param options Optional filters and limits
   */
  getUnprocessedMessages(options?: {
    /** Maximum total messages to return */
    limit?: number;
    /** Maximum messages per user */
    perUserLimit?: number;
  }): Promise<ConversationMessage[]>;

  /**
   * Mark messages as processed for memory extraction.
   * @param messageIds Array of message IDs to mark
   */
  markAsProcessed(messageIds: string[]): Promise<void>;
}
