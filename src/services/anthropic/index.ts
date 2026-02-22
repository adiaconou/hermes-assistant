/**
 * Anthropic service - LLM client, classification, and prompts.
 */

// Client
export { getClient } from './client.js';

// Classification
export { classifyMessage } from './classification.js';
export type { ClassificationResult } from './types.js';

// Prompts
export {
  SYSTEM_PROMPT,
  buildTimeContext,
  buildMemoryXml,
  buildUserContext,
  buildClassificationPrompt,
} from './prompts/index.js';
