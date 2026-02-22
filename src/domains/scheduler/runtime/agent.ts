/**
 * Scheduler Agent
 *
 * Specialized agent for reminders and scheduled tasks. This agent
 * handles creating, viewing, and managing scheduled messages that
 * will be sent to the user at specified times.
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../../executor/types.js';
import { getExecuteWithTools } from '../providers/executor.js';
import { applyAgentContext } from '../../../agents/context.js';
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
  const systemPrompt = applyAgentContext(SCHEDULER_AGENT_PROMPT, context.userConfig);
  const executeWithTools = getExecuteWithTools();

  return executeWithTools(
    systemPrompt,
    task,
    SCHEDULER_TOOLS,
    context
  );
}
