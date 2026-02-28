/**
 * @fileoverview Twilio inbound webhook idempotency.
 *
 * Prevents replay/duplicate processing by recording inbound MessageSid values.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from '../../config.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface MessageSidStore {
  register(messageSid: string): boolean;
  clear(): void;
  close(): void;
}

class MemoryMessageSidStore implements MessageSidStore {
  private readonly map = new Map<string, number>();

  register(messageSid: string): boolean {
    this.prune();
    if (this.map.has(messageSid)) {
      return false;
    }
    this.map.set(messageSid, Date.now());
    return true;
  }

  clear(): void {
    this.map.clear();
  }

  close(): void {
    this.map.clear();
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [sid, seenAt] of this.map.entries()) {
      if (seenAt < cutoff) {
        this.map.delete(sid);
      }
    }
  }
}

class SqliteMessageSidStore implements MessageSidStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS twilio_webhook_receipts (
        message_sid TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_twilio_receipts_received_at
        ON twilio_webhook_receipts(received_at);
    `);
  }

  register(messageSid: string): boolean {
    const now = Date.now();
    const cutoff = now - RETENTION_MS;
    this.db
      .prepare('DELETE FROM twilio_webhook_receipts WHERE received_at < ?')
      .run(cutoff);

    const result = this.db
      .prepare('INSERT OR IGNORE INTO twilio_webhook_receipts (message_sid, received_at) VALUES (?, ?)')
      .run(messageSid, now);

    return result.changes === 1;
  }

  clear(): void {
    this.db.prepare('DELETE FROM twilio_webhook_receipts').run();
  }

  close(): void {
    this.db.close();
  }
}

let store: MessageSidStore | null = null;

function getStore(): MessageSidStore {
  if (store) {
    return store;
  }

  if (config.nodeEnv === 'test') {
    store = new MemoryMessageSidStore();
    return store;
  }

  store = new SqliteMessageSidStore(config.conversation.sqlitePath);
  return store;
}

/**
 * Register an inbound MessageSid. Returns false if it was already seen.
 */
export function registerInboundMessageSid(messageSid: string): boolean {
  const trimmed = messageSid.trim();
  if (!trimmed) {
    return true;
  }
  return getStore().register(trimmed);
}

/**
 * Test/helper utility to clear tracked MessageSids.
 */
export function clearTwilioWebhookIdempotencyStore(): void {
  getStore().clear();
}

/**
 * Close and reset the idempotency store.
 */
export function closeTwilioWebhookIdempotencyStore(): void {
  if (!store) {
    return;
  }
  store.close();
  store = null;
}
