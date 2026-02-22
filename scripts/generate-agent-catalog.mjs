#!/usr/bin/env node
/**
 * Domain & Agent Catalog Generator.
 *
 * Reads domain capabilities, agent metadata, tool definitions, layer structure,
 * and cross-domain dependencies to produce docs/generated/agent-catalog.md.
 *
 * Usage:
 *   npm run docs:agents
 *   node scripts/generate-agent-catalog.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DOMAINS_DIR = path.join(SRC, 'domains');
const REGISTRY_PATH = path.join(SRC, 'registry', 'agents.ts');
const BOUNDARIES_PATH = path.join(ROOT, 'config', 'architecture-boundaries.json');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'generated', 'agent-catalog.md');

// Canonical layer order
const LAYER_ORDER = ['types', 'config', 'repo', 'providers', 'service', 'runtime', 'ui'];

// ---------- helpers ----------

/** Extract a single-quoted or double-quoted string after a key in TS source. */
function extractString(src, key) {
  const re = new RegExp(`${key}:\\s*['"]([^'"]+)['"]`);
  const m = src.match(re);
  return m?.[1] || null;
}

/** Extract a template literal or string value after a key (first line only). */
function extractDescription(src, key) {
  // Try template literal first (most common for multi-line descriptions)
  const tmplRe = new RegExp(`${key}:\\s*\`([^\`]*)\``);
  const tmplM = src.match(tmplRe);
  if (tmplM) {
    const firstLine = tmplM[1].split('\n')[0].trim();
    return firstLine;
  }

  // Try single-quoted string (handles escaped quotes like \')
  const sqRe = new RegExp(`${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`);
  const sqM = src.match(sqRe);
  if (sqM) return sqM[1].replace(/\\'/g, "'");

  // Try double-quoted string
  const dqRe = new RegExp(`${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const dqM = src.match(dqRe);
  if (dqM) return dqM[1].replace(/\\"/g, '"');

  return null;
}

/** Extract examples array (handles escaped quotes in single-quoted strings). */
function extractExamples(src) {
  const re = /examples:\s*\[([\s\S]*?)\]/;
  const m = src.match(re);
  if (!m) return [];

  const body = m[1];
  const results = [];

  // Match single-quoted strings with escaped quotes
  const sqRe = /'((?:[^'\\]|\\.)*)'/g;
  let sqM;
  while ((sqM = sqRe.exec(body)) !== null) {
    results.push(sqM[1].replace(/\\'/g, "'"));
  }
  if (results.length > 0) return results;

  // Fall back to double-quoted strings
  const dqRe = /"((?:[^"\\]|\\.)*)"/g;
  let dqM;
  while ((dqM = dqRe.exec(body)) !== null) {
    results.push(dqM[1].replace(/\\"/g, '"'));
  }
  return results;
}

/** Get list of tool name+description from a tools.ts file. */
function extractToolMeta(toolsPath) {
  if (!fs.existsSync(toolsPath)) return [];
  const src = fs.readFileSync(toolsPath, 'utf-8');
  const tools = [];

  // Tool definitions follow the pattern:
  //   tool: {
  //     name: 'tool_name',
  //     description: '...' or `...`,
  //     input_schema: { properties: { param: { description: '...' } } }
  //   }
  //
  // We need to match the top-level name/description, not parameter descriptions.
  // Strategy: find each "tool: {" block, then extract name and description from it.
  const toolBlockRe = /tool:\s*\{/g;
  let blockMatch;
  while ((blockMatch = toolBlockRe.exec(src)) !== null) {
    // Find the name and description before we hit input_schema (or within ~300 chars)
    const blockStart = blockMatch.index;
    // Grab text from "tool: {" up to "input_schema" or 500 chars, whichever comes first
    const rest = src.slice(blockStart, blockStart + 800);
    const schemaPos = rest.indexOf('input_schema');
    const header = schemaPos > 0 ? rest.slice(0, schemaPos) : rest.slice(0, 500);

    const nameM = header.match(/name:\s*'((?:[^'\\]|\\.)+)'/);
    if (!nameM) continue;

    const toolName = nameM[1].replace(/\\'/g, "'");
    const desc = extractDescription(header, 'description');
    tools.push({ name: toolName, description: desc || '' });
  }

  return tools;
}

// ---------- parse domains ----------

const domains = [];

if (fs.existsSync(DOMAINS_DIR)) {
  for (const entry of fs.readdirSync(DOMAINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const domainName = entry.name;
    const domainDir = path.join(DOMAINS_DIR, domainName);

    // capability.ts (required)
    const capPath = path.join(domainDir, 'capability.ts');
    if (!fs.existsSync(capPath)) continue;
    const capSrc = fs.readFileSync(capPath, 'utf-8');

    const exposure = extractString(capSrc, 'exposure') || 'unknown';
    const agentId = extractString(capSrc, 'agentId');

    // Detect layers present on disk
    const layers = [];
    for (const layer of LAYER_ORDER) {
      const layerDir = path.join(domainDir, layer);
      const layerFile = path.join(domainDir, `${layer}.ts`);
      if (fs.existsSync(layerDir) || fs.existsSync(layerFile)) {
        layers.push(layer);
      }
    }

    // Agent metadata (from runtime/agent.ts)
    let agentDescription = null;
    let agentExamples = [];
    let agentNameFromRuntime = null;
    const agentPath = path.join(domainDir, 'runtime', 'agent.ts');
    if (fs.existsSync(agentPath)) {
      const agentSrc = fs.readFileSync(agentPath, 'utf-8');
      agentDescription = extractDescription(agentSrc, 'description');
      agentExamples = extractExamples(agentSrc);
      agentNameFromRuntime = extractString(agentSrc, 'name');
    }

    // Tool definitions (from runtime/tools.ts)
    const toolsPath = path.join(domainDir, 'runtime', 'tools.ts');
    const tools = extractToolMeta(toolsPath);

    domains.push({
      domain: domainName,
      exposure,
      agentId: agentId || agentNameFromRuntime,
      layers,
      agentDescription,
      agentExamples,
      tools,
    });
  }
}

// ---------- parse general-agent (not in domains/) ----------

const generalAgentPath = path.join(SRC, 'agents', 'general', 'index.ts');
let generalAgent = null;
if (fs.existsSync(generalAgentPath)) {
  const src = fs.readFileSync(generalAgentPath, 'utf-8');
  generalAgent = {
    agentId: extractString(src, 'name'),
    description: extractDescription(src, 'description'),
    examples: extractExamples(src),
  };
}

// ---------- parse shared tools (not in any domain) ----------

const sharedToolFiles = [
  path.join(SRC, 'tools', 'maps.ts'),
  path.join(SRC, 'tools', 'user-config.ts'),
];
const sharedTools = [];
for (const f of sharedToolFiles) {
  sharedTools.push(...extractToolMeta(f));
}

// ---------- parse cross-domain dependencies ----------

const crossDomainDeps = new Map(); // domainName -> [{to, via}]
if (fs.existsSync(BOUNDARIES_PATH)) {
  const boundaries = JSON.parse(fs.readFileSync(BOUNDARIES_PATH, 'utf-8'));
  for (const rule of (boundaries.crossDomainRules?.allowed || [])) {
    const fromMatch = rule.from.match(/domains\/([^/]+)/);
    const toMatch = rule.to.match(/domains\/([^/]+)/);
    if (fromMatch && toMatch) {
      const fromDomain = fromMatch[1];
      if (!crossDomainDeps.has(fromDomain)) crossDomainDeps.set(fromDomain, []);
      crossDomainDeps.get(fromDomain).push({
        to: toMatch[1],
        via: rule.via,
        reason: rule.reason || '',
      });
    }
  }
}

// ---------- parse registry order ----------

const registryOrder = [];
if (fs.existsSync(REGISTRY_PATH)) {
  const registrySrc = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  const importRe = /import\s+\{[^}]*capability\s+as\s+(\w+).*?\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(registrySrc)) !== null) {
    const importPath = m[2];
    const agentsMatch = importPath.match(/agents\/(\w+)\//);
    const domainsMatch = importPath.match(/domains\/([^/]+)\//);
    registryOrder.push(agentsMatch?.[1] || domainsMatch?.[1] || 'unknown');
  }
}

// ---------- generate markdown ----------

const lines = [];

lines.push('# Domain & Agent Catalog');
lines.push('');
lines.push('> Auto-generated by `npm run docs:agents`. Do not edit manually.');
lines.push('');
lines.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
lines.push('');

// Summary table
lines.push('## Summary');
lines.push('');
lines.push('| Domain | Exposure | Agent | Tools | Layers |');
lines.push('|--------|----------|-------|-------|--------|');

for (const d of domains) {
  const agent = d.agentId || '\u2014';
  const toolCount = d.tools.length > 0 ? `${d.tools.length}` : '\u2014';
  const layerList = d.layers.join(', ');
  lines.push(`| ${d.domain} | ${d.exposure} | ${agent} | ${toolCount} | ${layerList} |`);
}
if (generalAgent) {
  lines.push(`| general *(top-level)* | agent | ${generalAgent.agentId} | all | \u2014 |`);
}
lines.push('');

// Per-domain sections
lines.push('---');
lines.push('');

for (const d of domains) {
  lines.push(`## ${d.domain} (\`${d.exposure}\`)`);
  lines.push('');

  // Agent info
  if (d.exposure === 'agent' && (d.agentId || d.agentDescription)) {
    lines.push(`**Agent:** \`${d.agentId}\``);
    lines.push(`**Description:** ${d.agentDescription}`);
    lines.push(`**Source:** \`src/domains/${d.domain}/runtime/agent.ts\``);
    lines.push('');
  } else if (d.exposure === 'tool-only') {
    lines.push('*No agent \u2014 tools are attached to other agents.*');
    lines.push('');
  } else if (d.exposure === 'internal') {
    lines.push('*Internal infrastructure \u2014 no agent or tools exposed.*');
    lines.push('');
  }

  // Examples
  if (d.agentExamples.length > 0) {
    lines.push('**Example prompts:**');
    for (const ex of d.agentExamples) {
      lines.push(`- "${ex}"`);
    }
    lines.push('');
  }

  // Layers
  lines.push(`**Layers:** ${d.layers.join(' \u2192 ')}`);
  lines.push('');

  // Cross-domain deps
  const deps = crossDomainDeps.get(d.domain);
  if (deps && deps.length > 0) {
    lines.push('**Cross-domain dependencies:**');
    for (const dep of deps) {
      lines.push(`- \u2192 **${dep.to}** via \`${dep.via}\` \u2014 ${dep.reason}`);
    }
    lines.push('');
  }

  // Tools
  if (d.tools.length > 0) {
    lines.push('**Tools:**');
    lines.push('');
    lines.push('| Tool | Description |');
    lines.push('|------|-------------|');
    for (const t of d.tools) {
      // Truncate description to first sentence or 120 chars
      let desc = t.description;
      const sentenceEnd = desc.indexOf('. ');
      if (sentenceEnd > 0 && sentenceEnd < 120) {
        desc = desc.slice(0, sentenceEnd + 1);
      } else if (desc.length > 120) {
        desc = desc.slice(0, 117) + '...';
      }
      lines.push(`| \`${t.name}\` | ${desc} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
}

// General agent (not in domains/)
if (generalAgent) {
  lines.push('## general *(top-level fallback)*');
  lines.push('');
  lines.push(`**Agent:** \`${generalAgent.agentId}\``);
  lines.push(`**Description:** ${generalAgent.description}`);
  lines.push(`**Source:** \`src/agents/general/index.ts\``);
  lines.push(`**Tools:** all (\`*\`)`);
  lines.push('');
  if (generalAgent.examples.length > 0) {
    lines.push('**Example prompts:**');
    for (const ex of generalAgent.examples) {
      lines.push(`- "${ex}"`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
}

// Shared tools (not in any domain)
if (sharedTools.length > 0) {
  lines.push('## Shared Tools *(top-level, no domain)*');
  lines.push('');
  lines.push('These tools live in `src/tools/` and are not owned by any domain.');
  lines.push('');
  lines.push('| Tool | Description |');
  lines.push('|------|-------------|');
  for (const t of sharedTools) {
    let desc = t.description;
    const sentenceEnd = desc.indexOf('. ');
    if (sentenceEnd > 0 && sentenceEnd < 120) {
      desc = desc.slice(0, sentenceEnd + 1);
    } else if (desc.length > 120) {
      desc = desc.slice(0, 117) + '...';
    }
    lines.push(`| \`${t.name}\` | ${desc} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
}

// Agent registry order
if (registryOrder.length > 0) {
  lines.push('## Agent Registry Order');
  lines.push('');
  lines.push('Order in `src/registry/agents.ts` (planner sees agents in this order):');
  lines.push('');
  for (let i = 0; i < registryOrder.length; i++) {
    lines.push(`${i + 1}. ${registryOrder[i]}`);
  }
  lines.push('');
}

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n');

const domainCount = domains.length;
const agentCount = domains.filter(d => d.exposure === 'agent').length + (generalAgent ? 1 : 0);
const toolCount = domains.reduce((sum, d) => sum + d.tools.length, 0) + sharedTools.length;
console.log(`Domain catalog written to ${path.relative(ROOT, OUTPUT_PATH)} (${domainCount} domains, ${agentCount} agents, ${toolCount} tools)`);
