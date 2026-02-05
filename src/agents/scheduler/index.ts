/**
 * Scheduler Agent
 *
 * Specialized agent for reminders and scheduled tasks. This agent
 * handles creating, viewing, and managing scheduled messages that
 * will be sent to the user at specified times.
 *
 * Capabilities:
 * - Create one-time reminders
 * - Create recurring reminders
 * - List scheduled tasks
 * - Update scheduled tasks
 * - Delete scheduled tasks
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';
import { buildTimeContext } from '../../services/anthropic/prompts/context.js';
import { SCHEDULER_AGENT_PROMPT } from './prompt.js';

/**
 * Scheduler tools that this agent can use.
 */
const SCHEDULER_TOOLS = [
  'create_scheduled_job',
  'list_scheduled_jobs',
  'update_scheduled_job',
  'delete_scheduled_job',
  'resolve_date',
];

/**
 * Scheduler agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'scheduler-agent',
  description: 'Manages reminders and scheduled tasks. Use for creating, viewing, updating, or deleting reminders and recurring messages.',
  tools: SCHEDULER_TOOLS,
  examples: [
    'Remind me to call mom tomorrow at 5pm',
    'Set a daily reminder at 8am to take vitamins',
    'What reminders do I have?',
    'Cancel my morning reminder',
    'Change my gym reminder to 7am',
  ],
};

/**
 * Execute the scheduler agent.
 *
 * @param task The scheduler task to perform
 * @param context Execution context
 * @returns StepResult with scheduler operation outcome
 */
export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  // Build system prompt with context
  const timeContext = context.userConfig
    ? `Current time: ${buildTimeContext(context.userConfig)}`
    : 'Timezone: not set (ask user for timezone first)';

  const userContext = context.userConfig?.name
    ? `User: ${context.userConfig.name}`
    : '';

  const systemPrompt = SCHEDULER_AGENT_PROMPT
    .replace('{timeContext}', timeContext)
    .replace('{userContext}', userContext);

  return executeWithTools(
    systemPrompt,
    task,
    SCHEDULER_TOOLS,
    context
  );
}
