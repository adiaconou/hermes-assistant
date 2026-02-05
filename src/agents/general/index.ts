/**
 * General Agent
 *
 * A "catch-all" agent that has access to all tools. This is used for:
 * - Requests that don't fit specialized agents
 * - Multi-domain tasks that span multiple capabilities
 * - The permanent fallback for any unclassified request
 *
 * In Phase 1, this is the only agent and wraps the existing message handler
 * to ensure backward compatibility.
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';
import { GENERAL_AGENT_PROMPT } from './prompt.js';

/**
 * General agent capability definition.
 * Used by the planner to understand what this agent can do.
 */
export const capability: AgentCapability = {
  name: 'general-agent',
  description: 'Handles all tasks using the full tool suite. Use when no specialized agent fits or for multi-domain requests.',
  tools: ['*'], // All tools
  examples: [
    'General questions and conversations',
    'Tasks spanning multiple domains',
    'Fallback for unclassified requests',
  ],
};

/**
 * Execute the general agent.
 *
 * @param task The task to perform
 * @param context Execution context with user info and previous results
 * @returns StepResult with the outcome
 */
export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  // Build a context-aware system prompt
  let systemPrompt = GENERAL_AGENT_PROMPT;

  // Add user context if available
  if (context.userConfig) {
    const name = context.userConfig.name || 'there';
    const timezone = context.userConfig.timezone || 'UTC';
    systemPrompt += `\n\nUser Context:
- Name: ${name}
- Timezone: ${timezone}`;
  }

  // Add previous step context if available
  const previousSteps = Object.keys(context.previousStepResults);
  if (previousSteps.length > 0) {
    systemPrompt += `\n\nPrevious steps have provided data. Reference step results by their ID if needed.`;
  }

  return executeWithTools(
    systemPrompt,
    task,
    ['*'], // All tools
    context
  );
}
