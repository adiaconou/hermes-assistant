/**
 * @fileoverview Injected executeWithTools provider for email-watcher domain.
 *
 * Uses the same set/get injection pattern as the scheduler domain
 * to avoid a direct import from executor/tool-executor (which would
 * be a reverse dependency from domain → runtime infrastructure).
 */

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

/**
 * Inject the executeWithTools function at bootstrap time.
 * Called from src/index.ts before the email watcher starts.
 */
export function setEmailWatcherExecuteWithTools(fn: ExecuteWithToolsFn): void {
  _executeWithTools = fn;
}

/**
 * Retrieve the injected executeWithTools function.
 * Throws if called before injection (programming error).
 */
export function getEmailWatcherExecuteWithTools(): ExecuteWithToolsFn {
  if (!_executeWithTools) {
    throw new Error(
      'email-watcher executeWithTools not injected. Call setEmailWatcherExecuteWithTools() at startup.',
    );
  }
  return _executeWithTools;
}
