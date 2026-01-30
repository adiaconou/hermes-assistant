/**
 * Tool type definitions (canonical location).
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { UserConfig } from '../services/user-config/index.js';

/**
 * Context passed to tool handlers.
 */
export interface ToolContext {
  phoneNumber?: string;
  channel?: 'sms' | 'whatsapp';
  userConfig?: UserConfig | null;
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
