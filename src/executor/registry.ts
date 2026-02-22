/**
 * Agent Registry
 *
 * Centralized registry for agent definitions. The orchestrator uses this
 * during planning (to select agents) and execution (to look up agent configs).
 *
 * Adding a new agent only requires adding an entry here (NFR-6: Extensibility).
 */

import type { AgentCapability, AgentRegistry, AgentExecutor } from './types.js';
import { AGENTS } from '../registry/agents.js';
import { registerAgentExecutor } from './router.js';

/**
 * All registered agents.
 * Order matters: specialized agents should be listed before general-agent.
 */
const agents: AgentCapability[] = AGENTS.map(a => a.capability);

/**
 * Create an agent registry instance.
 * The registry provides lookup and listing of available agents.
 */
export function createAgentRegistry(): AgentRegistry {
  const agentMap = new Map(agents.map(a => [a.name, a]));

  return {
    getAgent: (name: string) => agentMap.get(name),
    listAgents: () => [...agentMap.values()],
  };
}

/**
 * Register a new agent in the registry.
 * Used to add specialized agents in later phases.
 */
export function registerAgent(agent: AgentCapability, executor?: AgentExecutor): void {
  // Insert before general-agent (which should always be last)
  const generalIndex = agents.findIndex(a => a.name === 'general-agent');
  if (generalIndex >= 0) {
    agents.splice(generalIndex, 0, agent);
  } else {
    agents.push(agent);
  }

  if (executor) {
    registerAgentExecutor(agent.name, executor);
  }
}

/**
 * Get all agent names for quick lookup.
 */
export function getAgentNames(): string[] {
  return agents.map(a => a.name);
}

/**
 * Format agents for inclusion in the planning prompt.
 * Returns a string with agent descriptions for the LLM.
 */
export function formatAgentsForPrompt(registry: AgentRegistry): string {
  return registry
    .listAgents()
    .map(agent => {
      const examples = agent.examples.length > 0
        ? `\n    Examples: ${agent.examples.join(', ')}`
        : '';
      return `  - ${agent.name}: ${agent.description}${examples}`;
    })
    .join('\n');
}
