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

    // Idempotent column additions for email watcher
    try {
      this.db.exec('ALTER TABLE user_config ADD COLUMN email_watcher_history_id TEXT');
    } catch { /* column already exists */ }
    try {
      this.db.exec('ALTER TABLE user_config ADD COLUMN email_watcher_enabled INTEGER DEFAULT 0');
    } catch { /* column already exists */ }
  }

  async get(phoneNumber: string): Promise<UserConfig | null> {
    const row = this.db
      .prepare(
        `SELECT phone_number, name, timezone, email_watcher_history_id,
                email_watcher_enabled, created_at, updated_at
         FROM user_config WHERE phone_number = ?`
      )
      .get(phoneNumber) as
      | { phone_number: string; name: string | null; timezone: string | null;
          email_watcher_history_id: string | null; email_watcher_enabled: number | null;
          created_at: number; updated_at: number }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      phoneNumber: row.phone_number,
      name: row.name ?? undefined,
      timezone: row.timezone ?? undefined,
      emailWatcherHistoryId: row.email_watcher_history_id ?? undefined,
      emailWatcherEnabled: row.email_watcher_enabled === 1,
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
      if (config.emailWatcherHistoryId !== undefined) {
        updates.push('email_watcher_history_id = ?');
        values.push(config.emailWatcherHistoryId ?? null);
      }
      if (config.emailWatcherEnabled !== undefined) {
        updates.push('email_watcher_enabled = ?');
        values.push(config.emailWatcherEnabled ? 1 : 0);
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
          `INSERT INTO user_config (phone_number, name, timezone, email_watcher_history_id,
           email_watcher_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          phoneNumber,
          config.name ?? null,
          config.timezone ?? null,
          config.emailWatcherHistoryId ?? null,
          config.emailWatcherEnabled ? 1 : 0,
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

  async getEmailWatcherUsers(): Promise<UserConfig[]> {
    const rows = this.db
      .prepare(
        `SELECT uc.phone_number, uc.name, uc.timezone, uc.email_watcher_history_id,
                uc.email_watcher_enabled, uc.created_at, uc.updated_at
         FROM user_config uc
         INNER JOIN credentials c ON c.phone_number = uc.phone_number AND c.provider = 'google'
         WHERE uc.email_watcher_enabled = 1`
      )
      .all() as Array<{
        phone_number: string; name: string | null; timezone: string | null;
        email_watcher_history_id: string | null; email_watcher_enabled: number | null;
        created_at: number; updated_at: number;
      }>;

    return rows.map(row => ({
      phoneNumber: row.phone_number,
      name: row.name ?? undefined,
      timezone: row.timezone ?? undefined,
      emailWatcherHistoryId: row.email_watcher_history_id ?? undefined,
      emailWatcherEnabled: row.email_watcher_enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async updateEmailWatcherState(phoneNumber: string, historyId: string): Promise<void> {
    this.db
      .prepare('UPDATE user_config SET email_watcher_history_id = ?, updated_at = ? WHERE phone_number = ?')
      .run(historyId, Date.now(), phoneNumber);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
