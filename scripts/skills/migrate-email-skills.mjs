#!/usr/bin/env node
/**
 * Migration script: Convert email_skills DB rows into filesystem skill packs.
 *
 * Reads email_skills from credentials.db and creates filesystem skill packs
 * under data/skills/imported/<skill-name>/SKILL.md.
 *
 * Usage:
 *   node scripts/skills/migrate-email-skills.mjs [--dry-run]
 *
 * Output:
 *   - Creates skill packs under data/skills/imported/
 *   - Writes audit log to data/skills/migration-audit.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const dryRun = process.argv.includes('--dry-run');
const dbPath = process.env.CREDENTIAL_STORE_SQLITE_PATH ||
  (process.env.NODE_ENV === 'production' ? '/app/data/credentials.db' : './data/credentials.db');

const importedDir = path.join(projectRoot, 'data/skills/imported');
const auditPath = path.join(projectRoot, 'data/skills/migration-audit.json');

console.log(`Email Skills Migration${dryRun ? ' (DRY RUN)' : ''}`);
console.log(`Database: ${dbPath}`);
console.log(`Output: ${importedDir}\n`);

// Open database
const fullDbPath = path.resolve(projectRoot, dbPath);
if (!fs.existsSync(fullDbPath)) {
  console.log('No credentials database found. Nothing to migrate.');
  process.exit(0);
}

const db = new Database(fullDbPath, { readonly: true });

// Check if email_skills table exists
const tableExists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='email_skills'"
).get();

if (!tableExists) {
  console.log('No email_skills table found. Nothing to migrate.');
  db.close();
  process.exit(0);
}

// Read all skills
const rows = db.prepare('SELECT * FROM email_skills ORDER BY phone_number, name').all();
db.close();

if (rows.length === 0) {
  console.log('No email skills found. Nothing to migrate.');
  process.exit(0);
}

console.log(`Found ${rows.length} email skill(s) to migrate.\n`);

const audit = {
  timestamp: new Date().toISOString(),
  dryRun,
  sourceDb: dbPath,
  outputDir: importedDir,
  results: [],
};

let successCount = 0;
let skipCount = 0;

for (const row of rows) {
  const skillName = `email-${row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const skillDir = path.join(importedDir, skillName);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  const entry = {
    originalId: row.id,
    originalName: row.name,
    phoneNumber: row.phone_number,
    migratedName: skillName,
    status: 'pending',
    path: skillMdPath,
  };

  // Build the SKILL.md content
  const tools = row.tools ? JSON.parse(row.tools) : [];
  const extractFields = row.extract_fields ? JSON.parse(row.extract_fields) : [];

  const channels = ['email'];
  if (row.action_type === 'notify') {
    channels.push('sms', 'whatsapp');
  }

  const matchHints = [];
  // Extract keywords from match_criteria for match hints
  const criteriaWords = row.match_criteria.split(/[,;.\n]+/).map(s => s.trim()).filter(Boolean);
  matchHints.push(...criteriaWords.slice(0, 5));

  const frontmatter = {
    name: skillName,
    description: row.description || row.match_criteria,
    metadata: {
      hermes: {
        channels,
        tools: tools.length > 0 ? tools : undefined,
        match: matchHints.length > 0 ? matchHints : undefined,
        enabled: row.enabled === 1,
      },
    },
  };

  // Build YAML manually to avoid adding js-yaml dependency just for migration
  let yaml = '---\n';
  yaml += `name: ${frontmatter.name}\n`;
  yaml += `description: ${JSON.stringify(frontmatter.description)}\n`;
  yaml += 'metadata:\n';
  yaml += '  hermes:\n';
  yaml += `    channels: [${channels.join(', ')}]\n`;
  if (tools.length > 0) {
    yaml += `    tools: [${tools.join(', ')}]\n`;
  }
  if (matchHints.length > 0) {
    yaml += `    match:\n`;
    for (const hint of matchHints) {
      yaml += `      - ${JSON.stringify(hint)}\n`;
    }
  }
  yaml += `    enabled: ${row.enabled === 1}\n`;
  yaml += '---\n\n';

  // Build body
  let body = `# ${row.name}\n\n`;
  body += `${row.match_criteria}\n\n`;

  if (extractFields.length > 0) {
    body += `## Fields to Extract\n\n`;
    for (const field of extractFields) {
      body += `- ${field}\n`;
    }
    body += '\n';
  }

  if (row.action_prompt) {
    body += `## Action\n\n`;
    body += `${row.action_prompt}\n`;
  }

  const content = yaml + body;

  if (dryRun) {
    console.log(`  [DRY RUN] Would create: ${skillMdPath}`);
    console.log(`            Name: ${skillName}`);
    entry.status = 'dry_run';
  } else {
    try {
      if (fs.existsSync(skillMdPath)) {
        console.log(`  SKIP    ${skillName} (already exists)`);
        entry.status = 'skipped_exists';
        skipCount++;
      } else {
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(skillMdPath, content, 'utf-8');
        console.log(`  OK      ${skillName}`);
        entry.status = 'migrated';
        successCount++;
      }
    } catch (err) {
      console.log(`  FAIL    ${skillName}: ${err.message}`);
      entry.status = 'error';
      entry.error = err.message;
    }
  }

  audit.results.push(entry);
}

// Write audit log
if (!dryRun) {
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
  console.log(`\nAudit log: ${auditPath}`);
}

console.log(`\nResults: ${successCount} migrated, ${skipCount} skipped, ${rows.length} total`);
