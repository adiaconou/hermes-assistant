/**
 * Calendar Agent
 *
 * Specialized agent for calendar operations. This agent has focused
 * capabilities for reading and writing calendar events, with
 * optimized prompts for calendar-specific tasks.
 *
 * Capabilities:
 * - List events for a date/range
 * - Create new events
 * - Update existing events
 * - Delete events
 * - Find free time slots
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';
import { buildTimeContext } from '../../services/anthropic/prompts/context.js';
import { CALENDAR_AGENT_PROMPT } from './prompt.js';

/**
 * Calendar tools that this agent can use.
 */
const CALENDAR_TOOLS = [
  'get_calendar_events',
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',
  'resolve_date',
];

/**
 * Calendar agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'calendar-agent',
  description: 'Manages Google Calendar events. Use for viewing, creating, updating, or deleting calendar events.',
  tools: CALENDAR_TOOLS,
  examples: [
    'What\'s on my calendar today?',
    'Schedule a meeting tomorrow at 2pm',
    'Cancel my 3pm appointment',
    'Move my dentist appointment to next week',
    'What am I doing this week?',
  ],
};

/**
 * Execute the calendar agent.
 *
 * @param task The calendar task to perform
 * @param context Execution context
 * @returns StepResult with calendar operation outcome
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

  const systemPrompt = CALENDAR_AGENT_PROMPT
    .replace('{timeContext}', timeContext)
    .replace('{userContext}', userContext);

  return executeWithTools(
    systemPrompt,
    task,
    CALENDAR_TOOLS,
    context
  );
}
