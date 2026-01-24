/**
 * Type definitions for the LLM module.
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

/**
 * Classification result for determining if async processing is needed.
 */
export interface ClassificationResult {
  needsAsyncWork: boolean;
  immediateResponse: string;
}

/**
 * Options for customizing generateResponse behavior.
 * Used by scheduled job executor to customize system prompt and tools.
 */
export interface GenerateOptions {
  /** Override the default system prompt */
  systemPrompt?: string;
  /** Override the default tools (for restricting available tools) */
  tools?: Tool[];
  /** Message channel (sms or whatsapp) - used for creating scheduled jobs */
  channel?: 'sms' | 'whatsapp';
}
