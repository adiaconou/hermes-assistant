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
  'create_email_skill',
  'list_email_skills',
  'update_email_skill',
  'delete_email_skill',
  'toggle_email_watcher',
  'test_email_skill',
];

/**
 * Email agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'email-agent',
  description: 'Searches and reads Gmail. Manages email watching skills that automatically process incoming emails (log to spreadsheets, send notifications). Can search by sender, subject, date, and keywords.',
  tools: EMAIL_TOOLS,
  examples: [
    'Do I have any unread emails?',
    'Check my email from John',
    'Find emails about the project',
    'What emails did I get today?',
    'Read the email from my boss',
    'Find my hotel confirmation for my trip to Arizona',
    'Search for flight bookings from last year',
    'Show my email skills',
    'Start tracking job application emails in a spreadsheet',
    'Disable the expense tracker',
    'Pause email watching',
    'Test the tax tracker on my recent emails',
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
