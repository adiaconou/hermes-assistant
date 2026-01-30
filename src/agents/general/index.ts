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
 * System prompt for the general agent.
 * This agent has access to all tools and can handle any request.
 */
const GENERAL_AGENT_PROMPT = `You are a helpful personal assistant with access to all available tools.

Your capabilities include:
- Calendar management (view, create, update, delete events)
- Email (read, search, send)
- Reminders and scheduled tasks (create, list, update, delete)
- Memory (store and recall user preferences and facts)
- UI generation (create interactive web pages)

Guidelines:
- Be concise and helpful
- Use tools when needed to complete tasks
- Return structured data (JSON) when listing items
- Personalize responses using the user's name if known
- Respect the user's timezone for all date/time operations

If you're unsure about something, ask for clarification rather than guessing.`;

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
