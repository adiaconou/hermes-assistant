#!/usr/bin/env node

/**
 * Agent registry consistency checker.
 *
 * Validates that:
 * 1. Every domain with exposure:'agent' has runtime/agent.ts and runtime/prompt.ts.
 * 2. Every exposure:'agent' domain is present in src/registry/agents.ts.
 * 3. tool-only and internal domains are NOT in the agent registry.
 *
 * Exit 0 if consistent, exit 1 with remediation messages otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOMAINS_DIR = path.join(ROOT, 'src', 'domains');
const REGISTRY_PATH = path.join(ROOT, 'src', 'registry', 'agents.ts');

const errors = [];

// ---------- Parse domain capabilities ----------

const domainCapabilities = [];

if (fs.existsSync(DOMAINS_DIR)) {
  for (const entry of fs.readdirSync(DOMAINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const domainName = entry.name;
    const capPath = path.join(DOMAINS_DIR, domainName, 'capability.ts');

    if (!fs.existsSync(capPath)) {
      errors.push(`Domain '${domainName}' is missing capability.ts at src/domains/${domainName}/capability.ts`);
      continue;
    }

    const capSrc = fs.readFileSync(capPath, 'utf-8');

    // Extract exposure value
    const exposureMatch = capSrc.match(/exposure:\s*['"]([\w-]+)['"]/);
    if (!exposureMatch) {
      errors.push(`Domain '${domainName}': cannot parse exposure from capability.ts`);
      continue;
    }

    // Extract agentId if present
    const agentIdMatch = capSrc.match(/agentId:\s*['"]([^'"]+)['"]/);

    domainCapabilities.push({
      domain: domainName,
      exposure: exposureMatch[1],
      agentId: agentIdMatch?.[1] || null,
    });
  }
}

// ---------- Parse agent registry ----------

const registryAgentIds = [];

if (fs.existsSync(REGISTRY_PATH)) {
  const registrySrc = fs.readFileSync(REGISTRY_PATH, 'utf-8');

  // Extract agent capability names from the registry
  // Match patterns like: capability: xxxCapability where xxx maps to an agent
  // Also match direct agent name strings in capability objects
  const capabilityImports = registrySrc.matchAll(/import\s+\{[^}]*capability\s+as\s+(\w+).*?\}\s+from\s+['"]([^'"]+)['"]/g);
  for (const match of capabilityImports) {
    const varName = match[1];
    const importPath = match[2];
    // Derive agent name from import path
    // e.g., '../agents/calendar/index.js' -> 'calendar'
    // e.g., '../domains/scheduler/runtime/agent.js' -> 'scheduler'
    const agentsMatch = importPath.match(/agents\/(\w+)\//);
    const domainsMatch = importPath.match(/domains\/([^/]+)\//);
    const agentName = agentsMatch?.[1] || domainsMatch?.[1] || varName;
    registryAgentIds.push(agentName);
  }
} else {
  errors.push('Agent registry not found at src/registry/agents.ts');
}

// ---------- Validate ----------

for (const cap of domainCapabilities) {
  if (cap.exposure === 'agent') {
    // Check runtime/agent.ts exists
    const agentPath = path.join(DOMAINS_DIR, cap.domain, 'runtime', 'agent.ts');
    if (!fs.existsSync(agentPath)) {
      errors.push(
        `Domain '${cap.domain}' has exposure:'agent' but missing runtime/agent.ts.\n` +
        `  Fix: create src/domains/${cap.domain}/runtime/agent.ts`
      );
    }

    // Check runtime/prompt.ts exists
    const promptPath = path.join(DOMAINS_DIR, cap.domain, 'runtime', 'prompt.ts');
    if (!fs.existsSync(promptPath)) {
      errors.push(
        `Domain '${cap.domain}' has exposure:'agent' but missing runtime/prompt.ts.\n` +
        `  Fix: create src/domains/${cap.domain}/runtime/prompt.ts`
      );
    }

    // Check present in registry
    if (!registryAgentIds.includes(cap.domain)) {
      errors.push(
        `Domain '${cap.domain}' has exposure:'agent' but is not in src/registry/agents.ts.\n` +
        `  Fix: import and add ${cap.domain} agent to the AGENTS array in src/registry/agents.ts`
      );
    }
  } else {
    // tool-only or internal should NOT be in agent registry
    if (registryAgentIds.includes(cap.domain)) {
      errors.push(
        `Domain '${cap.domain}' has exposure:'${cap.exposure}' but IS in src/registry/agents.ts.\n` +
        `  Fix: remove ${cap.domain} from the AGENTS array (it should not have an agent entry)`
      );
    }
  }
}

// ---------- Output ----------

if (errors.length > 0) {
  console.log(`\n${errors.length} agent registry issue(s):\n`);
  for (const e of errors) {
    console.log(`ERROR: ${e}\n`);
  }
  process.exit(1);
} else {
  const domainCount = domainCapabilities.length;
  const agentCount = domainCapabilities.filter(c => c.exposure === 'agent').length;
  console.log(`Agent registry consistent: ${agentCount} agent domain(s), ${domainCount} total domain(s)`);
  process.exit(0);
}
