/**
 * @fileoverview SQLite memory store for user facts.
 *
 * Stores user facts (semantic memory) in SQLite. Facts are atomic sentences
 * like "Likes black coffee" or "Has a dog named Max".
 *
 * ## Schema
 *
 * | Column | Type | Description |
 * |--------|------|-------------|
 * | id | TEXT | UUID primary key |
 * | phone_number | TEXT | User identifier |
 * | fact | TEXT | The fact text (atomic, third person) |
 * | category | TEXT | Category (preferences, health, relationships, etc.) |
 * | confidence | REAL | Confidence score 0.3-1.0 (see ranking.ts for meaning) |
 * | source_type | TEXT | 'explicit' (user asked) or 'inferred' (extracted) |
 * | evidence | TEXT | Supporting quote/context (max 120 chars) |
 * | last_reinforced_at | INTEGER | Timestamp when fact was last confirmed |
 * | extracted_at | INTEGER | Timestamp when fact was first extracted |
 *
 * ## Confidence and Cleanup
 *
 * - Facts with confidence < 0.6 are "observations" (tentative)
 * - Observations older than 180 days are deleted by `deleteStaleObservations()`
 * - Established facts (≥ 0.6) are never automatically deleted
 *
 * @see ./ranking.ts for confidence thresholds and selection logic
 * @see ./processor.ts for how facts are extracted and stored
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { MemoryStore, UserFact } from '../types.js';

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
        confidence REAL NOT NULL DEFAULT 0.5,
        source_type TEXT NOT NULL DEFAULT 'explicit',
        evidence TEXT,
        last_reinforced_at INTEGER,
        extracted_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_facts_phone ON user_facts(phone_number);
    `);

    this.applyMigrations();
  }

  private applyMigrations(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(user_facts)`)
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((col) => col.name));

    const missingColumns: Array<{ name: string; sql: string }> = [];
    if (!columnNames.has('confidence')) {
      missingColumns.push({
        name: 'confidence',
        sql: `ALTER TABLE user_facts ADD COLUMN confidence REAL DEFAULT 0.5`,
      });
    }
    if (!columnNames.has('source_type')) {
      missingColumns.push({
        name: 'source_type',
        sql: `ALTER TABLE user_facts ADD COLUMN source_type TEXT DEFAULT 'explicit'`,
      });
    }
    if (!columnNames.has('evidence')) {
      missingColumns.push({
        name: 'evidence',
        sql: `ALTER TABLE user_facts ADD COLUMN evidence TEXT`,
      });
    }
    if (!columnNames.has('last_reinforced_at')) {
      missingColumns.push({
        name: 'last_reinforced_at',
        sql: `ALTER TABLE user_facts ADD COLUMN last_reinforced_at INTEGER`,
      });
    }

    const transaction = this.db.transaction(() => {
      for (const column of missingColumns) {
        this.db.exec(column.sql);
      }

      // Backfill defaults for existing rows
      this.db
        .prepare(`UPDATE user_facts SET confidence = 0.5 WHERE confidence IS NULL`)
        .run();
      this.db
        .prepare(`UPDATE user_facts SET source_type = 'explicit' WHERE source_type IS NULL`)
        .run();
      this.db
        .prepare(`UPDATE user_facts SET last_reinforced_at = extracted_at WHERE last_reinforced_at IS NULL`)
        .run();
    });
    transaction();
  }

  async getFacts(phoneNumber: string): Promise<UserFact[]> {
    const rows = this.db
      .prepare(
        `SELECT id, phone_number, fact, category, confidence, source_type, evidence, last_reinforced_at, extracted_at
         FROM user_facts
         WHERE phone_number = ?
         ORDER BY extracted_at DESC`
      )
      .all(phoneNumber) as Array<{
      id: string;
      phone_number: string;
      fact: string;
      category: string | null;
      confidence: number | null;
      source_type: string | null;
      evidence: string | null;
      last_reinforced_at: number | null;
      extracted_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      fact: row.fact,
      category: row.category ?? undefined,
      confidence: row.confidence ?? 0.5,
      sourceType: (row.source_type as 'explicit' | 'inferred') ?? 'explicit',
      evidence: row.evidence ?? undefined,
      lastReinforcedAt: row.last_reinforced_at ?? undefined,
      extractedAt: row.extracted_at,
    }));
  }

  async getAllFacts(): Promise<UserFact[]> {
    const rows = this.db
      .prepare(
        `SELECT id, phone_number, fact, category, confidence, source_type, evidence, last_reinforced_at, extracted_at
         FROM user_facts
         ORDER BY extracted_at DESC`
      )
      .all() as Array<{
      id: string;
      phone_number: string;
      fact: string;
      category: string | null;
      confidence: number | null;
      source_type: string | null;
      evidence: string | null;
      last_reinforced_at: number | null;
      extracted_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      fact: row.fact,
      category: row.category ?? undefined,
      confidence: row.confidence ?? 0.5,
      sourceType: (row.source_type as 'explicit' | 'inferred') ?? 'explicit',
      evidence: row.evidence ?? undefined,
      lastReinforcedAt: row.last_reinforced_at ?? undefined,
      extractedAt: row.extracted_at,
    }));
  }

  async addFact(fact: Omit<UserFact, 'id'>): Promise<UserFact> {
    const id = randomUUID();
    const confidence = fact.confidence ?? 0.5;
    const sourceType = fact.sourceType ?? 'explicit';
    const evidence = fact.evidence ?? null;
    const lastReinforcedAt = fact.lastReinforcedAt ?? fact.extractedAt;

    this.db
      .prepare(
        `INSERT INTO user_facts (id, phone_number, fact, category, confidence, source_type, evidence, last_reinforced_at, extracted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        fact.phoneNumber,
        fact.fact,
        fact.category ?? null,
        confidence,
        sourceType,
        evidence,
        lastReinforcedAt,
        fact.extractedAt
      );

    return {
      id,
      ...fact,
      confidence,
      sourceType,
      evidence: evidence ?? undefined,
      lastReinforcedAt,
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
    if (updates.confidence !== undefined) {
      updateFields.push('confidence = ?');
      values.push(updates.confidence);
    }
    if (updates.sourceType !== undefined) {
      updateFields.push('source_type = ?');
      values.push(updates.sourceType);
    }
    if (updates.evidence !== undefined) {
      updateFields.push('evidence = ?');
      values.push(updates.evidence ?? null);
    }
    if (updates.lastReinforcedAt !== undefined) {
      updateFields.push('last_reinforced_at = ?');
      values.push(updates.lastReinforcedAt ?? null);
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

  /**
   * Delete stale observations (low-confidence facts older than 180 days).
   *
   * This cleanup prevents the database from accumulating tentative facts
   * that were never reinforced. Established facts (confidence >= 0.6) are
   * never deleted by this method.
   *
   * Should be called periodically (e.g., daily via scheduler).
   *
   * @returns Number of facts deleted
   */
  async deleteStaleObservations(): Promise<number> {
    const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000; // 180 days
    const result = this.db
      .prepare(
        `DELETE FROM user_facts
         WHERE confidence < 0.6
           AND extracted_at < ?`
      )
      .run(cutoff);
    return result.changes;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
