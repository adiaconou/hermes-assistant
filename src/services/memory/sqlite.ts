/**
 * @fileoverview SQLite memory store.
 *
 * Stores user facts (semantic memory) in SQLite.
 * Facts are atomic sentences like "Likes black coffee" or "Has a dog named Max".
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { MemoryStore, UserFact } from './types.js';

/**
 * SQLite implementation of memory store.
 */
export class SqliteMemoryStore implements MemoryStore {
  private db: Database.Database;

  /**
   * @param dbPath Path to SQLite database file
   */
  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_facts (
        id TEXT PRIMARY KEY,
        phone_number TEXT NOT NULL,
        fact TEXT NOT NULL,
        category TEXT,
        extracted_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_facts_phone ON user_facts(phone_number);
    `);
  }

  async getFacts(phoneNumber: string): Promise<UserFact[]> {
    const rows = this.db
      .prepare(
        `SELECT id, phone_number, fact, category, extracted_at
         FROM user_facts
         WHERE phone_number = ?
         ORDER BY extracted_at DESC`
      )
      .all(phoneNumber) as Array<{
      id: string;
      phone_number: string;
      fact: string;
      category: string | null;
      extracted_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      fact: row.fact,
      category: row.category ?? undefined,
      extractedAt: row.extracted_at,
    }));
  }

  async getAllFacts(): Promise<UserFact[]> {
    const rows = this.db
      .prepare(
        `SELECT id, phone_number, fact, category, extracted_at
         FROM user_facts
         ORDER BY extracted_at DESC`
      )
      .all() as Array<{
      id: string;
      phone_number: string;
      fact: string;
      category: string | null;
      extracted_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      fact: row.fact,
      category: row.category ?? undefined,
      extractedAt: row.extracted_at,
    }));
  }

  async addFact(fact: Omit<UserFact, 'id'>): Promise<UserFact> {
    const id = randomUUID();

    this.db
      .prepare(
        `INSERT INTO user_facts (id, phone_number, fact, category, extracted_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        id,
        fact.phoneNumber,
        fact.fact,
        fact.category ?? null,
        fact.extractedAt
      );

    return {
      id,
      ...fact,
    };
  }

  async updateFact(id: string, updates: Partial<Omit<UserFact, 'id' | 'phoneNumber'>>): Promise<void> {
    const updateFields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.fact !== undefined) {
      updateFields.push('fact = ?');
      values.push(updates.fact);
    }
    if (updates.category !== undefined) {
      updateFields.push('category = ?');
      values.push(updates.category ?? null);
    }
    if (updates.extractedAt !== undefined) {
      updateFields.push('extracted_at = ?');
      values.push(updates.extractedAt);
    }

    if (updateFields.length === 0) {
      return; // Nothing to update
    }

    values.push(id);

    this.db
      .prepare(`UPDATE user_facts SET ${updateFields.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  async deleteFact(id: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM user_facts WHERE id = ?`)
      .run(id);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
