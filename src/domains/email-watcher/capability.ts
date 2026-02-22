import type { DomainCapability } from '../../types/domain.js';

export const capability: DomainCapability = {
  domain: 'email-watcher',
  exposure: 'tool-only',
  tools: ['create_email_skill', 'list_email_skills', 'update_email_skill', 'delete_email_skill', 'toggle_email_watcher', 'test_email_skill'],
};
