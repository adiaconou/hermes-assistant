/**
 * Agent Router
 *
 * Routes execution to the appropriate agent based on agent name.
 * This centralizes the agent dispatch logic, making it easy to
 * add new agents.
 */

import type { StepResult, AgentExecutionContext, AgentExecutor } from './types.js';
import { AGENTS } from '../registry/agents.js';

/**
 * Map of agent names to their executor functions.
 */
const agentExecutors: Map<string, AgentExecutor> = new Map(
  AGENTS.map(agent => [agent.capability.name, agent.executor])
);

const generalExecutor = agentExecutors.get('general-agent');

/**
 * Route a task to the appropriate agent.
 *
 * @param agentName Name of the agent to execute
 * @param task Task description to execute
 * @param context Execution context
 * @returns StepResult from the agent
 */
export function routeToAgent(
  agentName: string,
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  const executor = agentExecutors.get(agentName);

  if (!executor) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'Unknown agent, falling back to general-agent',
      requestedAgent: agentName,
      timestamp: new Date().toISOString(),
    }));

    if (generalExecutor) {
      return generalExecutor(task, context);
    }

    return Promise.resolve({
      success: false,
      output: null,
      error: `Unknown agent: ${agentName}`,
    });
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'Routing to agent',
    agent: agentName,
    taskPreview: task.substring(0, 80),
    timestamp: new Date().toISOString(),
  }));

  return executor(task, context);
}

/**
 * Register a new agent executor.
 * Used to add new agents at runtime.
 */
export function registerAgentExecutor(
  agentName: string,
  executor: AgentExecutor
): void {
  agentExecutors.set(agentName, executor);
}

/**
 * Get all registered agent names.
 */
export function getRegisteredAgentNames(): string[] {
  return Array.from(agentExecutors.keys());
}
