import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { StepResult, AgentExecutionContext } from '../../../executor/types.js';

type ExecuteWithToolsFn = (
  systemPrompt: string,
  task: string,
  toolNames: string[],
  context: AgentExecutionContext,
  options?: { initialMessages?: MessageParam[] },
) => Promise<StepResult>;

let _executeWithTools: ExecuteWithToolsFn | null = null;

export function setEmailExecuteWithTools(fn: ExecuteWithToolsFn): void {
  _executeWithTools = fn;
}

export function getEmailExecuteWithTools(): ExecuteWithToolsFn {
  if (!_executeWithTools) {
    throw new Error('email executeWithTools not injected. Call setEmailExecuteWithTools() at startup.');
  }
  return _executeWithTools;
}
