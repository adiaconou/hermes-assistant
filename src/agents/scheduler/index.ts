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
 * System prompt for the scheduler agent.
 */
const SCHEDULER_AGENT_PROMPT = `You are a reminders and scheduling assistant.

Your job is to help with reminders and scheduled messages:
- Creating reminders: One-time or recurring messages
- Viewing reminders: List all scheduled tasks
- Updating reminders: Change times or content
- Deleting reminders: Cancel scheduled messages

Guidelines:
1. For one-time reminders, use specific dates/times (e.g., "tomorrow at 9am", "next Friday at 3pm")
2. For recurring reminders, use clear patterns (e.g., "daily at 9am", "every Monday at noon")
3. Make reminder prompts specific and actionable (e.g., "Remind user to take medication" not just "medication")
4. When listing reminders, show the schedule in human-readable format
5. Confirm what was created/updated with the user

Important distinction:
- Reminders = scheduled SMS messages to the user
- Calendar events = entries in Google Calendar (use calendar-agent for those)

{timeContext}

{userContext}`;

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
