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
import type { ConversationStore, ConversationMessage, GetHistoryOptions, StoredMediaAttachment, MessageMetadataKind } from './types.js';

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
        memory_processed_at INTEGER,
        media_attachments TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_phone
        ON conversation_messages(phone_number, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_messages_unprocessed
        ON conversation_messages(memory_processed, created_at)
        WHERE memory_processed = 0;

      -- Message metadata table for storing hidden data (e.g., image analysis)
      CREATE TABLE IF NOT EXISTS conversation_message_metadata (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_message_metadata_message
        ON conversation_message_metadata(message_id);

      CREATE INDEX IF NOT EXISTS idx_message_metadata_phone_kind
        ON conversation_message_metadata(phone_number, kind, created_at DESC);
    `);

    // Migration: add media_attachments column if it doesn't exist
    const columns = this.db.prepare(`PRAGMA table_info(conversation_messages)`).all() as Array<{ name: string }>;
    const hasMediaColumn = columns.some((col) => col.name === 'media_attachments');
    if (!hasMediaColumn) {
      this.db.exec(`ALTER TABLE conversation_messages ADD COLUMN media_attachments TEXT`);
    }
  }

  async addMessage(
    phoneNumber: string,
    role: 'user' | 'assistant',
    content: string,
    channel: 'sms' | 'whatsapp' = 'sms',
    mediaAttachments?: StoredMediaAttachment[]
  ): Promise<ConversationMessage> {
    const id = randomUUID();
    const createdAt = Date.now();
    const mediaJson = mediaAttachments && mediaAttachments.length > 0
      ? JSON.stringify(mediaAttachments)
      : null;

    this.db
      .prepare(
        `INSERT INTO conversation_messages
         (id, phone_number, role, content, channel, created_at, memory_processed, media_attachments)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(id, phoneNumber, role, content, channel, createdAt, mediaJson);

    return {
      id,
      phoneNumber,
      role,
      content,
      channel,
      createdAt,
      memoryProcessed: false,
      mediaAttachments,
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
    const orderBy = 'ORDER BY created_at DESC, rowid DESC';

    const query = `
      SELECT id, phone_number, role, content, channel, created_at,
             memory_processed, memory_processed_at, media_attachments
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
      media_attachments: string | null;
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
      mediaAttachments: row.media_attachments
        ? JSON.parse(row.media_attachments) as StoredMediaAttachment[]
        : undefined,
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

    // Use a window function to apply per-user cap in SQL rather than
    // loading all rows and filtering in JS. This scales with table size.
    const roleFilter = includeAssistant ? '' : `AND role = 'user'`;
    const rows = this.db.prepare(
      `
      WITH ranked AS (
        SELECT id, phone_number, role, content, channel, created_at,
               memory_processed, memory_processed_at, media_attachments,
               ROW_NUMBER() OVER (PARTITION BY phone_number ORDER BY created_at ASC, rowid ASC) AS rn
        FROM conversation_messages
        WHERE memory_processed = 0 ${roleFilter}
      )
      SELECT id, phone_number, role, content, channel, created_at,
             memory_processed, memory_processed_at, media_attachments
      FROM ranked
      WHERE rn <= ?
      ORDER BY created_at ASC, rn ASC
      LIMIT ?
      `
    ).all(perUserLimit, limit) as Array<{
      id: string;
      phone_number: string;
      role: string;
      content: string;
      channel: string;
      created_at: number;
      memory_processed: number;
      memory_processed_at: number | null;
      media_attachments: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      phoneNumber: row.phone_number,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      channel: row.channel as 'sms' | 'whatsapp',
      createdAt: row.created_at,
      memoryProcessed: row.memory_processed === 1,
      memoryProcessedAt: row.memory_processed_at ?? undefined,
      mediaAttachments: row.media_attachments
        ? JSON.parse(row.media_attachments) as StoredMediaAttachment[]
        : undefined,
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

  async getRecentMedia(
    phoneNumber: string,
    limit: number = 10
  ): Promise<Array<{
    attachment: StoredMediaAttachment;
    messageId: string;
    createdAt: number;
  }>> {
    // Get recent messages with media attachments
    const rows = this.db.prepare(
      `
      SELECT id, created_at, media_attachments
      FROM conversation_messages
      WHERE phone_number = ? AND media_attachments IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
      `
    ).all(phoneNumber, limit * 2) as Array<{
      id: string;
      created_at: number;
      media_attachments: string;
    }>;

    // Flatten attachments from messages
    const results: Array<{
      attachment: StoredMediaAttachment;
      messageId: string;
      createdAt: number;
    }> = [];

    for (const row of rows) {
      const attachments = JSON.parse(row.media_attachments) as StoredMediaAttachment[];
      for (const attachment of attachments) {
        results.push({
          attachment,
          messageId: row.id,
          createdAt: row.created_at,
        });
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }

    return results;
  }

  async addMessageMetadata<T>(
    messageId: string,
    phoneNumber: string,
    kind: MessageMetadataKind,
    payload: T
  ): Promise<void> {
    const id = randomUUID();
    const createdAt = Date.now();
    const payloadJson = JSON.stringify(payload);

    this.db
      .prepare(
        `INSERT INTO conversation_message_metadata
         (id, message_id, phone_number, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, messageId, phoneNumber, kind, payloadJson, createdAt);
  }

  async getMessageMetadata<T>(
    messageIds: string[],
    kind?: MessageMetadataKind
  ): Promise<Map<string, T[]>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    const placeholders = messageIds.map(() => '?').join(', ');
    const params: (string | number)[] = [...messageIds];

    let query = `
      SELECT message_id, payload_json
      FROM conversation_message_metadata
      WHERE message_id IN (${placeholders})
    `;

    if (kind) {
      query += ' AND kind = ?';
      params.push(kind);
    }

    query += ' ORDER BY created_at ASC';

    const rows = this.db.prepare(query).all(...params) as Array<{
      message_id: string;
      payload_json: string;
    }>;

    const result = new Map<string, T[]>();

    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as T;
      const existing = result.get(row.message_id) ?? [];
      existing.push(payload);
      result.set(row.message_id, existing);
    }

    return result;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
