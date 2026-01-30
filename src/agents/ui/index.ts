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
  description: 'Generates interactive web pages. Use for lists, forms, calculators, or any content that benefits from visual/interactive presentation.',
  tools: UI_TOOLS,
  examples: [
    'Create a shopping list I can check off',
    'Make a calculator for tip splitting',
    'Build a form for my event RSVP',
    'Generate a weekly planner',
    'Create a timer for my workout',
  ],
};

/**
 * System prompt for the UI agent.
 */
const UI_AGENT_PROMPT = `You are a UI generation assistant.

Your job is to create interactive web pages for the user:
- Lists: Todo lists, shopping lists, checklists
- Forms: Input forms, surveys, RSVP pages
- Tools: Calculators, timers, converters
- Visualizations: Charts, planners, trackers

Guidelines:
1. Keep it mobile-friendly (touch targets, readable fonts)
2. Use simple, clean design (no external dependencies)
3. Pages run in a sandbox with NO network access
4. Use localStorage via hermesLoadState()/hermesSaveState() for persistence
5. Keep code concise - the page is delivered via SMS link

CRITICAL CONSTRAINTS:
- No fetch(), XMLHttpRequest, or WebSocket
- No external fonts, images, or CDN scripts
- All styling must be inline or in <style> tag
- All scripts must be inline in <script> tag

Persistence API:
- window.hermesLoadState(): Returns previously saved state or null
- window.hermesSaveState(data): Saves any JSON-serializable data

Example patterns:
- Interactive checklist with localStorage persistence
- Calculator with real-time results
- Form that validates and displays confirmation

{userContext}`;

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
  const userContext = context.userConfig?.name
    ? `User: ${context.userConfig.name}`
    : '';

  const systemPrompt = UI_AGENT_PROMPT
    .replace('{userContext}', userContext);

  return executeWithTools(
    systemPrompt,
    task,
    UI_TOOLS,
    context
  );
}
