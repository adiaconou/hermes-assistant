/**
 * Email Agent
 *
 * Specialized agent for email operations.
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../../executor/types.js';
import { getEmailExecuteWithTools } from '../providers/executor.js';
import { applyAgentContext } from '../../../agents/context.js';
import { EMAIL_AGENT_PROMPT } from './prompt.js';

/**
 * Email tools that this agent can use.
 */
const EMAIL_TOOLS = [
  'get_emails',
  'read_email',
  'get_email_thread',
  'toggle_email_watcher',
];

/**
 * Email agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'email-agent',
  description: 'Searches and reads Gmail. Can search by sender, subject, date, and keywords. Can toggle the background email watcher.',
  tools: EMAIL_TOOLS,
  examples: [
    'Do I have any unread emails?',
    'Check my email from John',
    'Find emails about the project',
    'What emails did I get today?',
    'Read the email from my boss',
    'Find my hotel confirmation for my trip to Arizona',
    'Search for flight bookings from last year',
    'Pause email watching',
  ],
};

/**
 * Execute the email agent.
 */
export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  const systemPrompt = applyAgentContext(EMAIL_AGENT_PROMPT, context.userConfig);
  const executeWithTools = getEmailExecuteWithTools();

  return executeWithTools(
    systemPrompt,
    task,
    EMAIL_TOOLS,
    context
  );
}
