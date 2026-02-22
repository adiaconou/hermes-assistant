/**
 * @fileoverview SQLite store for email skills.
 *
 * CRUD operations for email skill definitions stored in credentials.db.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { EmailSkill } from '../types.js';

type EmailSkillRow = {
  id: string;
  phone_number: string;
  name: string;
  description: string | null;
  match_criteria: string;
  extract_fields: string | null;
  action_type: string;
  action_prompt: string;
  tools: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
};

function rowToSkill(row: EmailSkillRow): EmailSkill {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    name: row.name,
    description: row.description ?? '',
    matchCriteria: row.match_criteria,
    extractFields: row.extract_fields ? JSON.parse(row.extract_fields) : [],
    actionType: row.action_type as 'execute_with_tools' | 'notify',
    actionPrompt: row.action_prompt,
    tools: row.tools ? JSON.parse(row.tools) : [],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EmailSkillStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_skills (
        id              TEXT PRIMARY KEY,
        phone_number    TEXT NOT NULL,
        name            TEXT NOT NULL,
        description     TEXT,
        match_criteria  TEXT NOT NULL,
        extract_fields  TEXT,
        action_type     TEXT NOT NULL,
        action_prompt   TEXT NOT NULL,
        tools           TEXT,
        enabled         INTEGER DEFAULT 1,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        UNIQUE(phone_number, name)
      )
    `);
  }

  getAllSkills(): EmailSkill[] {
    const rows = this.db.prepare('SELECT * FROM email_skills ORDER BY phone_number, name').all() as EmailSkillRow[];
    return rows.map(rowToSkill);
  }

  getSkillsForUser(phoneNumber: string, enabledOnly = false): EmailSkill[] {
    const query = enabledOnly
      ? 'SELECT * FROM email_skills WHERE phone_number = ? AND enabled = 1'
      : 'SELECT * FROM email_skills WHERE phone_number = ?';

    const rows = this.db.prepare(query).all(phoneNumber) as EmailSkillRow[];
    return rows.map(rowToSkill);
  }

  getSkillById(id: string): EmailSkill | null {
    const row = this.db
      .prepare('SELECT * FROM email_skills WHERE id = ?')
      .get(id) as EmailSkillRow | undefined;
    return row ? rowToSkill(row) : null;
  }

  getSkillByName(phoneNumber: string, name: string): EmailSkill | null {
    const row = this.db
      .prepare('SELECT * FROM email_skills WHERE phone_number = ? AND name = ?')
      .get(phoneNumber, name) as EmailSkillRow | undefined;
    return row ? rowToSkill(row) : null;
  }

  createSkill(skill: Omit<EmailSkill, 'id' | 'createdAt' | 'updatedAt'>): EmailSkill {
    const now = Date.now();
    const id = crypto.randomUUID();

    this.db
      .prepare(
        `INSERT INTO email_skills (id, phone_number, name, description, match_criteria,
         extract_fields, action_type, action_prompt, tools, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        skill.phoneNumber,
        skill.name,
        skill.description || null,
        skill.matchCriteria,
        JSON.stringify(skill.extractFields),
        skill.actionType,
        skill.actionPrompt,
        JSON.stringify(skill.tools),
        skill.enabled ? 1 : 0,
        now,
        now
      );

    return { ...skill, id, createdAt: now, updatedAt: now };
  }

  updateSkill(id: string, updates: Partial<EmailSkill>): EmailSkill {
    const existing = this.getSkillById(id);
    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }

    const now = Date.now();
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      values.push(updates.description || null);
    }
    if (updates.matchCriteria !== undefined) {
      sets.push('match_criteria = ?');
      values.push(updates.matchCriteria);
    }
    if (updates.extractFields !== undefined) {
      sets.push('extract_fields = ?');
      values.push(JSON.stringify(updates.extractFields));
    }
    if (updates.actionType !== undefined) {
      sets.push('action_type = ?');
      values.push(updates.actionType);
    }
    if (updates.actionPrompt !== undefined) {
      sets.push('action_prompt = ?');
      values.push(updates.actionPrompt);
    }
    if (updates.tools !== undefined) {
      sets.push('tools = ?');
      values.push(JSON.stringify(updates.tools));
    }
    if (updates.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }

    sets.push('updated_at = ?');
    values.push(now);
    values.push(id);

    this.db
      .prepare(`UPDATE email_skills SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getSkillById(id)!;
  }

  deleteSkill(id: string): void {
    this.db.prepare('DELETE FROM email_skills WHERE id = ?').run(id);
  }

  toggleSkill(id: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE email_skills SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, Date.now(), id);
  }

  deleteAllSkillsForUser(phoneNumber: string): void {
    this.db
      .prepare('DELETE FROM email_skills WHERE phone_number = ?')
      .run(phoneNumber);
  }
}

let instance: EmailSkillStore | null = null;

export function getEmailSkillStore(db?: Database.Database): EmailSkillStore {
  if (instance) return instance;
  if (!db) throw new Error('EmailSkillStore not initialized. Provide db on first call.');
  instance = new EmailSkillStore(db);
  return instance;
}

export function resetEmailSkillStore(): void {
  instance = null;
}
