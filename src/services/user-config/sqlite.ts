/**
 * @fileoverview SQLite user configuration store.
 *
 * Stores user preferences (name, timezone) in SQLite.
 * No encryption needed - this data isn't sensitive like OAuth tokens.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { UserConfigStore, UserConfig } from './types.js';

/**
 * SQLite user configuration store.
 */
export class SqliteUserConfigStore implements UserConfigStore {
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
      CREATE TABLE IF NOT EXISTS user_config (
        phone_number TEXT PRIMARY KEY,
        name TEXT,
        timezone TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  async get(phoneNumber: string): Promise<UserConfig | null> {
    const row = this.db
      .prepare(
        `SELECT phone_number, name, timezone, created_at, updated_at
         FROM user_config WHERE phone_number = ?`
      )
      .get(phoneNumber) as
      | { phone_number: string; name: string | null; timezone: string | null; created_at: number; updated_at: number }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      phoneNumber: row.phone_number,
      name: row.name ?? undefined,
      timezone: row.timezone ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async set(
    phoneNumber: string,
    config: Partial<Omit<UserConfig, 'phoneNumber'>>
  ): Promise<void> {
    const now = Date.now();
    const existing = await this.get(phoneNumber);

    if (existing) {
      // Update existing record
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (config.name !== undefined) {
        updates.push('name = ?');
        values.push(config.name ?? null);
      }
      if (config.timezone !== undefined) {
        updates.push('timezone = ?');
        values.push(config.timezone ?? null);
      }
      updates.push('updated_at = ?');
      values.push(now);
      values.push(phoneNumber);

      this.db
        .prepare(`UPDATE user_config SET ${updates.join(', ')} WHERE phone_number = ?`)
        .run(...values);
    } else {
      // Insert new record
      this.db
        .prepare(
          `INSERT INTO user_config (phone_number, name, timezone, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          phoneNumber,
          config.name ?? null,
          config.timezone ?? null,
          now,
          now
        );
    }
  }

  async delete(phoneNumber: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM user_config WHERE phone_number = ?`)
      .run(phoneNumber);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
