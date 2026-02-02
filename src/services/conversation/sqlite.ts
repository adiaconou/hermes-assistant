/**
 * @fileoverview SQLite conversation store.
 *
 * Stores conversation messages with memory processing tracking.
 * Follows the pattern established in src/services/memory/sqlite.ts.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { ConversationStore, ConversationMessage, GetHistoryOptions } from './types.js';

/**
 * SQLite implementation of conversation store.
 */
export class SqliteConversationStore implements ConversationStore {
  private db: Database.Database;

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
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        phone_number TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'sms',
        created_at INTEGER NOT NULL,
        memory_processed INTEGER NOT NULL DEFAULT 0,
        memory_processed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_messages_phone
        ON conversation_messages(phone_number, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_messages_unprocessed
        ON conversation_messages(memory_processed, created_at)
        WHERE memory_processed = 0;
    `);
  }

  async addMessage(
    phoneNumber: string,
    role: 'user' | 'assistant',
    content: string,
    channel: 'sms' | 'whatsapp' = 'sms'
  ): Promise<ConversationMessage> {
    const id = randomUUID();
    const createdAt = Date.now();

    this.db
      .prepare(
        `INSERT INTO conversation_messages
         (id, phone_number, role, content, channel, created_at, memory_processed)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, phoneNumber, role, content, channel, createdAt);

    return {
      id,
      phoneNumber,
      role,
      content,
      channel,
      createdAt,
      memoryProcessed: false,
    };
  }

  async getHistory(
    phoneNumber?: string,
    options: GetHistoryOptions = {}
  ): Promise<ConversationMessage[]> {
    const { limit = 50, memoryProcessed, since, until, role } = options;

    // Build dynamic WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (phoneNumber) {
      conditions.push('phone_number = ?');
      params.push(phoneNumber);
    }

    if (memoryProcessed !== undefined) {
      conditions.push('memory_processed = ?');
      params.push(memoryProcessed ? 1 : 0);
    }

    if (since !== undefined) {
      conditions.push('created_at >= ?');
      params.push(since);
    }

    if (until !== undefined) {
      conditions.push('created_at <= ?');
      params.push(until);
    }

    if (role) {
      conditions.push('role = ?');
      params.push(role);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Order by newest first so LIMIT returns the most recent messages
    // We'll reverse after fetching to return chronological order to callers
    const orderBy = 'ORDER BY created_at DESC';

    const query = `
      SELECT id, phone_number, role, content, channel, created_at,
             memory_processed, memory_processed_at
      FROM conversation_messages
      ${whereClause}
      ${orderBy}
      LIMIT ?
    `;

    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      phone_number: string;
      role: string;
      content: string;
      channel: string;
      created_at: number;
      memory_processed: number;
      memory_processed_at: number | null;
    }>;

    // Reverse to chronological order (oldest → newest) for downstream consumers
    const chronologicalRows = rows.reverse();

    return chronologicalRows.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      channel: row.channel as 'sms' | 'whatsapp',
      createdAt: row.created_at,
      memoryProcessed: row.memory_processed === 1,
      memoryProcessedAt: row.memory_processed_at ?? undefined,
    }));
  }

  async getUnprocessedMessages(options?: {
    limit?: number;
    perUserLimit?: number;
    includeAssistant?: boolean;
  }): Promise<ConversationMessage[]> {
    const limit = options?.limit ?? 100;
    const perUserLimit = options?.perUserLimit ?? 25;
    const includeAssistant = options?.includeAssistant ?? false;

    // FIFO across all users, optionally including assistant role, with per-user cap
    const roleFilter = includeAssistant ? '' : `AND role = 'user'`;
    const rows = this.db.prepare(
      `
      SELECT id, phone_number, role, content, channel, created_at,
             memory_processed, memory_processed_at
      FROM conversation_messages
      WHERE memory_processed = 0 ${roleFilter}
      ORDER BY created_at ASC
      `
    ).all() as Array<{
      id: string;
      phone_number: string;
      role: string;
      content: string;
      channel: string;
      created_at: number;
      memory_processed: number;
      memory_processed_at: number | null;
    }>;

    // Apply per-user limit in-memory to maintain FIFO ordering
    const byUserCount = new Map<string, number>();
    const limited: typeof rows = [];
    for (const row of rows) {
      const count = byUserCount.get(row.phone_number) ?? 0;
      if (count >= perUserLimit) continue;
      if (limited.length >= limit) break;
      byUserCount.set(row.phone_number, count + 1);
      limited.push(row);
    }

    return limited.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      channel: row.channel as 'sms' | 'whatsapp',
      createdAt: row.created_at,
      memoryProcessed: row.memory_processed === 1,
      memoryProcessedAt: row.memory_processed_at ?? undefined,
    }));
  }

  async markAsProcessed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    const now = Date.now();
    const placeholders = messageIds.map(() => '?').join(', ');

    this.db
      .prepare(
        `UPDATE conversation_messages
         SET memory_processed = 1, memory_processed_at = ?
         WHERE id IN (${placeholders})`
      )
      .run(now, ...messageIds);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
