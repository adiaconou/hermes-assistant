#!/usr/bin/env node

/**
 * Architecture boundary checker.
 *
 * Walks all .ts files under src/, extracts import edges, and checks them
 * against rules in config/architecture-boundaries.json.
 *
 * Usage:
 *   node scripts/check-layer-deps.mjs            # default mode
 *   node scripts/check-layer-deps.mjs --strict    # strict mode (warnings become violations)
 *   node scripts/check-layer-deps.mjs --report    # print full edge report before violations
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CONFIG_PATH = path.join(ROOT, 'config', 'architecture-boundaries.json');

const args = process.argv.slice(2);
const strictMode = args.includes('--strict');
const reportMode = args.includes('--report');

// ---------- helpers ----------

function walkTs(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** Extract import targets from a TS file (static + dynamic, skipping type-only). */
function extractImports(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const imports = [];

  // Static: import ... from '...' or export ... from '...'
  // Skip lines that start with "import type" (type-only imports)
  const staticRe = /(?:^|\n)\s*(?:import|export)\s+(?!type\s).*?\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = staticRe.exec(src)) !== null) {
    imports.push(m[1]);
  }

  // Also match: import type { ... } from '...' — but SKIP these (type-only)
  // Already handled by the negative lookahead above.

  // Dynamic: import('...')
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRe.exec(src)) !== null) {
    imports.push(m[1]);
  }

  return imports;
}

/** Resolve a relative import specifier to a src-relative path. */
function resolveImport(fromFile, specifier) {
  // Only handle relative imports
  if (!specifier.startsWith('.')) return null;

  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(fromDir, specifier);

  // Strip .js extension (TS source uses .js in imports)
  if (resolved.endsWith('.js')) {
    resolved = resolved.slice(0, -3);
  }

  // Convert to src-relative with forward slashes
  const rel = path.relative(ROOT, resolved).replace(/\\/g, '/');
  // Only care about src/ imports
  if (!rel.startsWith('src/')) return null;
  return rel;
}

/** Get the top-level directory under src/ for a path (e.g., "services", "tools"). */
function topDir(srcRelPath) {
  // srcRelPath is like "src/services/scheduler/index"
  const parts = srcRelPath.split('/');
  return parts[1]; // e.g., "services"
}

/** Parse domain and layer from a src-relative path inside src/domains/. */
function parseDomainLayer(srcRelPath) {
  // srcRelPath like "src/domains/scheduler/repo/sqlite"
  const parts = srcRelPath.split('/');
  if (parts[1] !== 'domains' || parts.length < 4) return null;
  const domain = parts[2];
  // Layer is the next segment. Files directly in the domain root (types.ts, capability.ts)
  // are considered their own "layer" by name.
  const layerOrFile = parts[3];
  return { domain, layer: layerOrFile };
}

// ---------- load config ----------

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

// Build exception lookup (from -> to)
const exceptionSet = new Set();
for (const exc of config.exceptions) {
  // Normalize: strip .ts extension if present for matching
  const from = exc.from.replace(/\.ts$/, '');
  const to = exc.to.replace(/\.ts$/, '');
  exceptionSet.add(`${from}|${to}`);
}

function isException(fromRel, toRel) {
  const fromNorm = fromRel.replace(/\.ts$/, '');
  const toNorm = toRel.replace(/\.ts$/, '');
  return exceptionSet.has(`${fromNorm}|${toNorm}`);
}

// ---------- scan ----------

const files = walkTs(SRC);
const allEdges = []; // { from, to }
const violations = [];
const warnings = [];

for (const file of files) {
  const fromRel = path.relative(ROOT, file).replace(/\\/g, '/');
  const imports = extractImports(file);

  for (const spec of imports) {
    const toRel = resolveImport(file, spec);
    if (!toRel) continue;

    allEdges.push({ from: fromRel, to: toRel });

    // Skip exceptions
    if (isException(fromRel, toRel)) continue;

    // --- Rule checks ---

    // 1. Top-level forbidden rules
    let matched = false;
    for (const rule of config.forbidden) {
      const fromPrefix = rule.from;
      const toPrefix = rule.to;
      if (fromRel.startsWith(`src/${fromPrefix.replace(/^src\//, '')}`) &&
          toRel.startsWith(`src/${toPrefix.replace(/^src\//, '')}`)) {
        violations.push({
          from: fromRel,
          to: toRel,
          rule: `${fromPrefix} cannot import from ${toPrefix}`,
          fix: rule.message,
        });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 2. Domain layer rules (same domain)
    const fromDomain = parseDomainLayer(fromRel);
    const toDomain = parseDomainLayer(toRel);

    if (fromDomain && toDomain && fromDomain.domain === toDomain.domain) {
      const layers = config.domainLayerRules.layers;
      const allowed = config.domainLayerRules.allowedImports;
      const fromLayer = fromDomain.layer;
      const toLayer = toDomain.layer;

      // Only check if both are recognized layers
      // Same-layer imports are always allowed (files within a layer can import each other)
      if (layers.includes(fromLayer) && layers.includes(toLayer) && fromLayer !== toLayer) {
        if (!allowed[fromLayer] || !allowed[fromLayer].includes(toLayer)) {
          violations.push({
            from: fromRel,
            to: toRel,
            rule: `${fromLayer} may not import ${toLayer} (domain: ${fromDomain.domain})`,
            fix: `Move shared logic to a layer that ${fromLayer} is allowed to import: [${(allowed[fromLayer] || []).join(', ')}]`,
          });
        }
      }
      // Files at domain root (types.ts, capability.ts) importing recognized layers is fine
      continue;
    }

    // 3. Cross-domain rules (different domains)
    if (fromDomain && toDomain && fromDomain.domain !== toDomain.domain) {
      let crossAllowed = false;
      for (const rule of config.crossDomainRules.allowed) {
        const ruleFrom = rule.from.replace(/\/$/, '');
        const ruleTo = rule.to.replace(/\/$/, '');
        if (fromRel.startsWith(`src/domains/${fromDomain.domain}/`) &&
            toRel.startsWith(`src/domains/${toDomain.domain}/`) &&
            `src/domains/${fromDomain.domain}` === ruleFrom.replace(/^src\//, 'src/') &&
            `src/domains/${toDomain.domain}` === ruleTo.replace(/^src\//, 'src/')) {
          // Check via constraint
          const viaPath = `src/domains/${fromDomain.domain}/${rule.via}`;
          const fromFileNorm = fromRel.replace(/\.ts$/, '');
          if (fromFileNorm === viaPath.replace(/\.ts$/, '')) {
            crossAllowed = true;
          } else {
            violations.push({
              from: fromRel,
              to: toRel,
              rule: `cross-domain import must go through ${rule.via}`,
              fix: `Import from ${rule.via} instead of importing ${toDomain.domain} directly.`,
            });
            matched = true;
          }
          break;
        }
      }
      if (!matched && !crossAllowed) {
        violations.push({
          from: fromRel,
          to: toRel,
          rule: `cross-domain import denied by default (${fromDomain.domain} -> ${toDomain.domain})`,
          fix: `Add an allowed entry in crossDomainRules or re-export through a providers/ file.`,
        });
      }
      continue;
    }

    // 4. Domain external rules (domain -> top-level)
    if (fromDomain && !toDomain) {
      // Check forbidden first
      let isForbidden = false;
      for (const rule of config.domainExternalRules.forbidden) {
        const toPrefix = rule.to.replace(/^src\//, '');
        if (toRel.startsWith(`src/${toPrefix}`)) {
          // Check if it's a type-only import (re-read source to check)
          // For simplicity, we already filtered type-only imports in extractImports
          violations.push({
            from: fromRel,
            to: toRel,
            rule: `domains cannot import ${rule.to}`,
            fix: rule.message,
          });
          isForbidden = true;
          break;
        }
      }
      if (isForbidden) continue;

      // Check allowed
      let isAllowed = false;
      for (const allowedPath of config.domainExternalRules.allowed) {
        const norm = allowedPath.replace(/^src\//, '');
        if (toRel.startsWith(`src/${norm}`)) {
          isAllowed = true;
          break;
        }
      }
      if (!isAllowed) {
        if (strictMode) {
          violations.push({
            from: fromRel,
            to: toRel,
            rule: `domain external import not in allowed list (strict mode)`,
            fix: `Add ${toRel} to domainExternalRules.allowed or move dependency to a provider.`,
          });
        } else {
          warnings.push({
            from: fromRel,
            to: toRel,
            message: `domain external import not in allowed list (warning in default mode, violation in --strict)`,
          });
        }
      }
      continue;
    }
  }
}

// ---------- report ----------

if (reportMode) {
  console.log('=== Architecture Edge Report ===\n');

  // Group edges by from directory -> to directory
  const edgeGroups = new Map();
  for (const edge of allEdges) {
    const fromDir = path.dirname(edge.from);
    const toDir = path.dirname(edge.to);
    const key = `${fromDir} -> ${toDir}`;
    if (!edgeGroups.has(key)) edgeGroups.set(key, []);
    edgeGroups.get(key).push(edge);
  }

  const sortedKeys = [...edgeGroups.keys()].sort();
  for (const key of sortedKeys) {
    console.log(`${key} (${edgeGroups.get(key).length} edges)`);
    for (const edge of edgeGroups.get(key)) {
      console.log(`  ${path.basename(edge.from)} -> ${path.basename(edge.to)}`);
    }
  }
  console.log(`\nTotal: ${allEdges.length} edges\n`);
}

// ---------- output ----------

if (violations.length > 0) {
  console.log(`\n${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.log(`VIOLATION: ${v.from} -> ${v.to}`);
    console.log(`Rule: ${v.rule}`);
    console.log(`Fix: ${v.fix}\n`);
  }
}

if (warnings.length > 0) {
  console.log(`${warnings.length} warning(s):\n`);
  for (const w of warnings) {
    console.log(`WARNING: ${w.from} -> ${w.to}`);
    console.log(`  ${w.message}\n`);
  }
}

const exceptionCount = config.exceptions.length;
if (exceptionCount > 0) {
  console.log(`${exceptionCount} known exception(s) (see config/architecture-boundaries.json)`);
}

if (violations.length === 0) {
  console.log(`0 violations`);
  process.exit(0);
} else {
  process.exit(1);
}
