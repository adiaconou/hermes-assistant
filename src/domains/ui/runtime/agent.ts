/**
 * UI Agent
 *
 * Specialized agent for generating interactive web pages.
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../../executor/types.js';
import { getUiExecuteWithTools } from '../providers/executor.js';
import { applyAgentContext } from '../../../services/agent-context.js';
import { UI_AGENT_PROMPT } from './prompt.js';

const UI_TOOLS = [
  'generate_ui',
];

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

export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  const systemPrompt = applyAgentContext(UI_AGENT_PROMPT, context.userConfig);
  const executeWithTools = getUiExecuteWithTools();

  return executeWithTools(
    systemPrompt,
    task,
    UI_TOOLS,
    context
  );
}
