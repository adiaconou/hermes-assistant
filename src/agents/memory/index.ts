/**
 * Memory Agent
 *
 * Specialized agent for memory operations. This agent handles
 * extracting and managing user facts/preferences.
 *
 * ## Design Decision: No Proactive Extraction
 *
 * Agents do NOT proactively extract facts during conversations. The memory-agent
 * is only invoked when users explicitly request memory operations:
 * - "Remember that I like coffee"
 * - "What do you know about me?"
 * - "Forget my allergy information"
 *
 * Background fact extraction is handled separately by the async memory processor
 * (see src/services/memory/processor.ts), which runs periodically to extract
 * facts from conversation history.
 *
 * This design ensures:
 * - Users have control over what gets remembered
 * - Conversation agents stay focused on their primary tasks
 * - No unnecessary memory operations during normal conversations
 *
 * Capabilities:
 * - Extract facts from conversation (when explicitly requested)
 * - View stored facts
 * - Update existing facts
 * - Delete facts
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';
import { MEMORY_AGENT_PROMPT } from './prompt.js';

/**
 * Memory tools that this agent can use.
 */
const MEMORY_TOOLS = [
  'extract_memory',
  'list_memories',
  'update_memory',
  'remove_memory',
];

/**
 * Memory agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'memory-agent',
  description: 'Manages user memory and facts. Use for storing, viewing, or deleting personal facts.',
  tools: MEMORY_TOOLS,
  examples: [
    'Remember that I like black coffee',
    'What do you know about me?',
    'Forget that I have a cat',
    'Update my preference to decaf',
  ],
};

/**
 * Execute the memory agent.
 *
 * @param task The memory task to perform
 * @param context Execution context
 * @returns StepResult with memory operation outcome
 */
export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  const userContext = context.userConfig?.name
    ? `User: ${context.userConfig.name}`
    : '';

  const systemPrompt = MEMORY_AGENT_PROMPT
    .replace('{userContext}', userContext);

  return executeWithTools(
    systemPrompt,
    task,
    MEMORY_TOOLS,
    context
  );
}
