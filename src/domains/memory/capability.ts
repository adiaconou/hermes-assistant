import type { DomainCapability } from '../../types/domain.js';

export const capability: DomainCapability = {
  domain: 'memory',
  exposure: 'agent',
  agentId: 'memory-agent',
  agentModule: './runtime/agent.js',
  tools: ['extract_memory', 'list_memories', 'update_memory', 'remove_memory'],
};
