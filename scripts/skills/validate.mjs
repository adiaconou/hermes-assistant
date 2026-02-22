#!/usr/bin/env node
/**
 * Skill pack validation script.
 * Validates all SKILL.md files in the bundled and imported skill directories.
 *
 * Usage:
 *   node scripts/skills/validate.mjs
 *   npm run skills:validate
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const VALID_CHANNELS = ['sms', 'whatsapp', 'scheduler', 'email'];

function discoverSkillDirs(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => path.join(rootDir, e.name))
    .filter(d => fs.existsSync(path.join(d, 'SKILL.md')));
}

function validateFrontmatter(fm) {
  const errors = [];

  if (!fm.name || typeof fm.name !== 'string') {
    errors.push('name is required and must be a string');
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(fm.name)) {
    errors.push('name must be lowercase alphanumeric with hyphens');
  }

  if (!fm.description || typeof fm.description !== 'string') {
    errors.push('description is required and must be a string');
  }

  if (fm.metadata?.hermes) {
    const h = fm.metadata.hermes;
    if (h.channels !== undefined) {
      if (!Array.isArray(h.channels)) {
        errors.push('metadata.hermes.channels must be an array');
      } else {
        for (const ch of h.channels) {
          if (!VALID_CHANNELS.includes(ch)) {
            errors.push(`invalid channel: ${ch}`);
          }
        }
      }
    }
    if (h.tools !== undefined && !Array.isArray(h.tools)) {
      errors.push('metadata.hermes.tools must be an array');
    }
    if (h.match !== undefined && !Array.isArray(h.match)) {
      errors.push('metadata.hermes.match must be an array');
    }
    if (h.enabled !== undefined && typeof h.enabled !== 'boolean') {
      errors.push('metadata.hermes.enabled must be a boolean');
    }
    if (h.delegateAgent !== undefined && typeof h.delegateAgent !== 'string') {
      errors.push('metadata.hermes.delegateAgent must be a string');
    }
  }

  return errors;
}

// Validate all skills
const bundledDir = path.join(projectRoot, 'skills');
const importedDir = path.join(projectRoot, 'data/skills/imported');

const dirs = [
  ...discoverSkillDirs(bundledDir).map(d => ({ dir: d, source: 'bundled' })),
  ...discoverSkillDirs(importedDir).map(d => ({ dir: d, source: 'imported' })),
];

let totalErrors = 0;
let totalValid = 0;

console.log(`Validating skill packs...\n`);

if (dirs.length === 0) {
  console.log('No skill packs found.');
  process.exit(0);
}

for (const { dir, source } of dirs) {
  const skillMdPath = path.join(dir, 'SKILL.md');
  const skillName = path.basename(dir);
  const prefix = `[${source}] ${skillName}`;

  try {
    const raw = fs.readFileSync(skillMdPath, 'utf-8');
    const { data } = matter(raw);

    if (!data || typeof data !== 'object') {
      console.log(`  FAIL  ${prefix}: Missing YAML frontmatter`);
      totalErrors++;
      continue;
    }

    const errors = validateFrontmatter(data);
    if (errors.length > 0) {
      console.log(`  FAIL  ${prefix}:`);
      for (const e of errors) {
        console.log(`         - ${e}`);
      }
      totalErrors++;
    } else {
      console.log(`  OK    ${prefix} (${data.name}: ${data.description})`);
      totalValid++;
    }
  } catch (err) {
    console.log(`  FAIL  ${prefix}: ${err.message}`);
    totalErrors++;
  }
}

console.log(`\nResults: ${totalValid} valid, ${totalErrors} errors`);
process.exit(totalErrors > 0 ? 1 : 0);
