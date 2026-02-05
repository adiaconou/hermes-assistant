/**
 * Conversation Service Types
 *
 * Defines interfaces for persistent conversation storage
 * with memory processing tracking.
 */

// ============================================================================
// Message Metadata Types (for image analysis persistence)
// ============================================================================

/**
 * Kind of metadata attached to a message.
 */
export type MessageMetadataKind = 'image_analysis';

/**
 * Metadata payload for image analysis results.
 * Stored as hidden data attached to the user message that contained the image.
 */
export interface ImageAnalysisMetadata {
  /** Google Drive file ID of the analyzed image (optional if unavailable) */
  driveFileId?: string;
  /** Google Drive web view URL (for potential re-analysis) */
  driveUrl?: string;
  /** MIME type of the image */
  mimeType: string;
  /** Gemini's analysis of the image content */
  analysis: string;
}

/**
 * Generic message metadata record.
 */
export interface MessageMetadata<T = unknown> {
  /** Unique identifier for this metadata record */
  id: string;
  /** ID of the message this metadata is attached to */
  messageId: string;
  /** Phone number of the user */
  phoneNumber: string;
  /** Kind of metadata */
  kind: MessageMetadataKind;
  /** Metadata payload */
  payload: T;
  /** Unix timestamp (milliseconds) when metadata was created */
  createdAt: number;
}

// ============================================================================
// Media Attachment Types
// ============================================================================

/**
 * Media attachment stored with a message.
 */
export interface StoredMediaAttachment {
  /** Google Drive file ID */
  driveFileId: string;
  /** Original filename */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** Google Drive web view link */
  webViewLink?: string;
}

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

  /** Media attachments uploaded to Drive */
  mediaAttachments?: StoredMediaAttachment[];
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
    channel?: 'sms' | 'whatsapp',
    mediaAttachments?: StoredMediaAttachment[]
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
    /** Include assistant messages in results */
    includeAssistant?: boolean;
  }): Promise<ConversationMessage[]>;

  /**
   * Mark messages as processed for memory extraction.
   * @param messageIds Array of message IDs to mark
   */
  markAsProcessed(messageIds: string[]): Promise<void>;

  /**
   * Get recent media attachments from a user's conversation.
   * @param phoneNumber User's phone number
   * @param limit Maximum number of attachments to return (default: 10)
   * @returns Array of media attachments with message context
   */
  getRecentMedia(phoneNumber: string, limit?: number): Promise<Array<{
    attachment: StoredMediaAttachment;
    messageId: string;
    createdAt: number;
  }>>;

  // ============================================================================
  // Message Metadata Methods (for image analysis persistence)
  // ============================================================================

  /**
   * Add metadata to a message (e.g., image analysis results).
   * @param messageId ID of the message to attach metadata to
   * @param phoneNumber User's phone number
   * @param kind Type of metadata
   * @param payload Metadata content
   */
  addMessageMetadata<T>(
    messageId: string,
    phoneNumber: string,
    kind: MessageMetadataKind,
    payload: T
  ): Promise<void>;

  /**
   * Get metadata for a set of messages.
   * @param messageIds Array of message IDs to fetch metadata for
   * @param kind Optional filter by metadata kind
   * @returns Map of messageId -> array of metadata payloads
   */
  getMessageMetadata<T = ImageAnalysisMetadata>(
    messageIds: string[],
    kind?: MessageMetadataKind
  ): Promise<Map<string, T[]>>;
}
