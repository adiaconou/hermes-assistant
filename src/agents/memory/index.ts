/**
 * Memory Agent
 *
 * Specialized agent for memory operations. This agent handles
 * extracting and managing user facts/preferences.
 *
 * Capabilities:
 * - Extract facts from conversation
 * - View stored facts
 * - Delete facts
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';

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
 * System prompt for the memory agent.
 */
const MEMORY_AGENT_PROMPT = `You are a memory management assistant.

Your job is to help store and manage facts about the user:
- Extract facts: Store new information the user shares
- View facts: Recall what you know about the user
- Delete facts: Remove outdated or incorrect information

Guidelines:
1. Extract atomic, self-contained facts (e.g., "Likes black coffee" not "Prefers beverages")
2. Don't extract temporary information ("I'm busy today")
3. Don't extract duplicate facts that are already stored
4. Be respectful of privacy - only store information the user explicitly shares
5. Confirm what was stored/deleted

Categories to use:
- preferences: food, music, communication style
- relationships: family, pets, friends, colleagues
- health: allergies, conditions, medications
- work: job, company, role
- interests: hobbies, activities
- personal: general personal details

{userContext}`;

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
