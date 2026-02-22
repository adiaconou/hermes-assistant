/**
 * Domain capability metadata contract.
 *
 * Each migrated domain declares a capability.ts that exports
 * a DomainCapability describing its exposure level and registry metadata.
 */

export type DomainExposure = 'agent' | 'tool-only' | 'internal';

export interface DomainCapability {
  domain: string;
  exposure: DomainExposure;
  agentId?: string;
  agentModule?: string;
  tools?: string[];
}
