/**
 * Tool type definitions (canonical location).
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { UserConfig } from '../services/user-config/index.js';
import type { StoredMediaAttachment } from '../services/conversation/types.js';

/**
 * Media attachment from WhatsApp/MMS.
 */
export interface MediaAttachment {
  url: string;
  contentType: string;
  index: number;
}

/**
 * Context passed to tool handlers.
 */
export interface ToolContext {
  phoneNumber?: string;
  channel?: 'sms' | 'whatsapp';
  userConfig?: UserConfig | null;
  /** Media attachments from inbound message (Twilio URLs) */
  mediaAttachments?: MediaAttachment[];
  /** Media files uploaded to Google Drive (persistent storage) */
  storedMedia?: StoredMediaAttachment[];
  /** ID of the originating user message (for attaching metadata like image analysis) */
  messageId?: string;
}

/**
 * Handler function type for tool execution.
 */
export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext
) => Promise<Record<string, unknown>>;

/**
 * Pairs a tool definition with its handler.
 */
export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}
