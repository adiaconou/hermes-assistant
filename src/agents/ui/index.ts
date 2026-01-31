/**
 * UI Agent
 *
 * Specialized agent for generating interactive web pages.
 * Creates mobile-friendly HTML/CSS/JS pages for rich interactions.
 *
 * Capabilities:
 * - Generate interactive lists
 * - Create forms and calculators
 * - Build rich visualizations
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';
import { buildTimeContext } from '../../services/anthropic/prompts/context.js';
import { UI_AGENT_PROMPT } from './prompts.js';

/**
 * UI tools that this agent can use.
 */
const UI_TOOLS = [
  'generate_ui',
];

/**
 * UI agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'ui-agent',
  description: `Generates interactive web pages. Use for lists, forms, calculators, or any content that benefits from visual/interactive presentation. IMPORTANT: This agent CANNOT fetch external data (no network access). To display live data (weather, calendar events, etc.), first fetch the data with another agent, then pass it to ui-agent to render.`,
  tools: UI_TOOLS,
  examples: [
    'Create a shopping list I can check off',
    'Make a calculator for tip splitting',
    'Build a form for my event RSVP',
    'Generate a weekly planner',
    'Create a timer for my workout',
    'Display calendar events in an interactive view (requires calendar data from previous step)',
  ],
};

/**
 * Execute the UI agent.
 *
 * @param task The UI task to perform
 * @param context Execution context
 * @returns StepResult with UI generation outcome (including shortUrl)
 */
export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  // Build system prompt with context
  const timeContext = context.userConfig
    ? `Current time: ${buildTimeContext(context.userConfig)}`
    : '';

  const userContext = context.userConfig?.name
    ? `User: ${context.userConfig.name}`
    : '';

  const systemPrompt = UI_AGENT_PROMPT
    .replace('{timeContext}', timeContext)
    .replace('{userContext}', userContext);

  return executeWithTools(
    systemPrompt,
    task,
    UI_TOOLS,
    context
  );
}
