import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { AgentExecutionContext, StepResult } from '../../../executor/types.js';

type ExecuteWithToolsFn = (
  systemPrompt: string,
  task: string,
  toolNames: string[],
  context: AgentExecutionContext,
  options?: { initialMessages?: MessageParam[] }
) => Promise<StepResult>;

let _executeWithTools: ExecuteWithToolsFn | null = null;

export function setExecuteWithTools(fn: ExecuteWithToolsFn): void {
  _executeWithTools = fn;
}

export function getExecuteWithTools(): ExecuteWithToolsFn {
  if (!_executeWithTools) throw new Error('executeWithTools not initialized — call setExecuteWithTools() at bootstrap');
  return _executeWithTools;
}
