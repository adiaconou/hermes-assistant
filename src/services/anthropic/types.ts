/**
 * Type definitions for the Anthropic service module.
 */

export type { ToolContext, ToolHandler, ToolDefinition } from '../../tools/types.js';

/**
 * Classification result for determining if async processing is needed.
 */
export interface ClassificationResult {
  needsAsyncWork: boolean;
  immediateResponse: string;
}
