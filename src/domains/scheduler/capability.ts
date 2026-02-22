import type { DomainCapability } from '../../types/domain.js';

export const capability: DomainCapability = {
  domain: 'scheduler',
  exposure: 'agent',
  agentId: 'scheduler-agent',
  agentModule: './runtime/agent.js',
  tools: ['create_scheduled_job', 'list_scheduled_jobs', 'update_scheduled_job', 'delete_scheduled_job'],
};
