/**
 * Email Agent
 *
 * Specialized agent for email operations. This agent handles
 * reading and searching emails from Gmail.
 *
 * Capabilities:
 * - Search emails
 * - Read email content
 * - List unread emails
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';
import { buildTimeContext } from '../../services/anthropic/prompts/context.js';

/**
 * Email tools that this agent can use.
 */
const EMAIL_TOOLS = [
  'get_emails',
  'get_email_content',
];

/**
 * Email agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'email-agent',
  description: 'Reads and searches Gmail. Use for checking, finding, or reading emails.',
  tools: EMAIL_TOOLS,
  examples: [
    'Do I have any unread emails?',
    'Check my email from John',
    'Find emails about the project',
    'What emails did I get today?',
    'Read the email from my boss',
  ],
};

/**
 * System prompt for the email agent.
 */
const EMAIL_AGENT_PROMPT = `You are an email assistant.

Your job is to help with email-related tasks:
- Searching emails: Find emails by sender, subject, content, or status
- Reading emails: Get full content of specific emails
- Summarizing: Provide concise summaries of email content

Guidelines:
1. Use Gmail search syntax for queries (from:, subject:, is:unread, etc.)
2. Present email results clearly with sender, subject, and preview
3. When reading an email, summarize key points concisely
4. Respect privacy - don't share sensitive content unnecessarily
5. Mention important details like attachments or urgent flags

{timeContext}

{userContext}`;

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
  const timeContext = context.userConfig
    ? `Current time: ${buildTimeContext(context.userConfig)}`
    : '';

  const userContext = context.userConfig?.name
    ? `User: ${context.userConfig.name}`
    : '';

  const systemPrompt = EMAIL_AGENT_PROMPT
    .replace('{timeContext}', timeContext)
    .replace('{userContext}', userContext);

  return executeWithTools(
    systemPrompt,
    task,
    EMAIL_TOOLS,
    context
  );
}
