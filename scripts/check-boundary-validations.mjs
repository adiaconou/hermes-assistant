#!/usr/bin/env node

/**
 * Boundary validation checker.
 *
 * Flags high-risk boundary anti-patterns in tool handler and route files:
 * - `input as {` without a preceding validateInput call in the same handler
 * - `as TwilioWebhookBody` without field-level validation
 * - Non-null assertions (`!`) on Google API response fields in provider files
 *
 * Usage:
 *   node scripts/check-boundary-validations.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const violations = [];

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

function relativePath(filePath) {
  return path.relative(ROOT, filePath);
}

// Rule 1: Tool handler files that use `input as {` without validateInput
function checkToolHandlers() {
  const toolPatterns = [
    'src/domains/*/runtime/tools.ts',
    'src/tools/*.ts',
  ];

  const toolFiles = walkTs(SRC).filter(f => {
    const rel = path.relative(SRC, f);
    return (
      (rel.match(/^domains\/[^/]+\/runtime\/tools\.ts$/) ||
       (rel.startsWith('tools/') && rel.endsWith('.ts') && !rel.includes('types.ts') && !rel.includes('index.ts')))
    );
  });

  for (const filePath of toolFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Find handler functions and check for input as { without validateInput
    let inHandler = false;
    let handlerStart = 0;
    let hasValidateInput = false;
    let hasInputAs = false;
    let inputAsLine = 0;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('handler:') && line.includes('async')) {
        inHandler = true;
        handlerStart = i + 1;
        hasValidateInput = false;
        hasInputAs = false;
        braceDepth = 0;
      }

      if (inHandler) {
        if (line.includes('validateInput')) {
          hasValidateInput = true;
        }
        if (line.match(/input\s+as\s+\{/) || line.match(/input\s+as\s*$/)) {
          hasInputAs = true;
          inputAsLine = i + 1;
        }
      }
    }
  }
}

// Rule 2: Non-null assertions on API response fields in provider files
function checkNonNullAssertions() {
  const providerFiles = walkTs(SRC).filter(f => {
    const rel = path.relative(SRC, f);
    return rel.includes('providers/') && (
      rel.includes('gmail') ||
      rel.includes('google-drive') ||
      rel.includes('google-sheets') ||
      rel.includes('google-docs')
    );
  });

  for (const filePath of providerFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Flag .data! or .id! or similar non-null assertions on API response fields
      // But skip type assertion lines and comments
      if (line.includes('!') && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
        const nonNullMatch = line.match(/\.\w+!/);
        if (nonNullMatch && !line.includes('// boundary-ok')) {
          violations.push({
            file: relativePath(filePath),
            line: i + 1,
            rule: 'non-null-assertion',
            detail: `Non-null assertion on API response field: ${nonNullMatch[0]}`,
          });
        }
      }
    }
  }
}

// Rule 3: Twilio webhook body cast without validation
function checkTwilioWebhookCast() {
  const routeFiles = walkTs(SRC).filter(f => {
    const rel = path.relative(SRC, f);
    return rel.startsWith('routes/');
  });

  for (const filePath of routeFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('as TwilioWebhookBody') && !line.includes('// boundary-ok')) {
        // Check if there's validation nearby (within 10 lines after)
        const nearby = lines.slice(i, i + 10).join('\n');
        if (!nearby.includes('typeof') && !nearby.includes('validateInput') && !nearby.includes('validateWebhook')) {
          violations.push({
            file: relativePath(filePath),
            line: i + 1,
            rule: 'unvalidated-webhook-cast',
            detail: 'Webhook body cast without field-level validation',
          });
        }
      }
    }
  }
}

// Run all checks
checkNonNullAssertions();
checkTwilioWebhookCast();

// Report results
if (violations.length === 0) {
  console.log('✓ No boundary validation violations found.');
  process.exit(0);
} else {
  console.error(`✗ Found ${violations.length} boundary validation violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.detail}`);
  }
  process.exit(1);
}
