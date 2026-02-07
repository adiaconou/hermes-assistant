/**
 * Email Agent
 *
 * Specialized agent for email operations. This agent handles
 * reading and searching emails from Gmail with thorough exploration.
 *
 * Capabilities:
 * - Search emails with Gmail search syntax
 * - Read full email content
 * - Iteratively explore to find specific information
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';
import { applyAgentContext } from '../context.js';
import { EMAIL_AGENT_PROMPT } from './prompt.js';

/**
 * Email tools that this agent can use.
 */
const EMAIL_TOOLS = [
  'get_emails',
  'read_email',
  'get_email_thread',
];

/**
 * Email agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'email-agent',
  description: 'Searches and reads Gmail. Use for finding specific information, checking emails, or reading email content. Can search by sender, subject, date, and keywords.',
  tools: EMAIL_TOOLS,
  examples: [
    'Do I have any unread emails?',
    'Check my email from John',
    'Find emails about the project',
    'What emails did I get today?',
    'Read the email from my boss',
    'Find my hotel confirmation for my trip to Arizona',
    'Search for flight bookings from last year',
  ],
};

/**
 * Execute the email agent.
 *
 * @param task The email task to perform
 * @param context Execution context
 * @returns StepResult with email operation outcome
 */
export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  const systemPrompt = applyAgentContext(EMAIL_AGENT_PROMPT, context.userConfig);

  return executeWithTools(
    systemPrompt,
    task,
    EMAIL_TOOLS,
    context
  );
}
