/**
 * @fileoverview One-time OAuth state nonce store.
 *
 * Tracks short-lived OAuth state nonces to prevent replay of callback URLs.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from '../../config.js';

interface NonceStore {
  register(nonce: string, expiresAt: number): void;
  hasActive(nonce: string): boolean;
  consume(nonce: string): boolean;
  clear(): void;
  close(): void;
}

class MemoryNonceStore implements NonceStore {
  private readonly map = new Map<string, number>();

  register(nonce: string, expiresAt: number): void {
    this.prune();
    this.map.set(nonce, expiresAt);
  }

  hasActive(nonce: string): boolean {
    this.prune();
    const expiresAt = this.map.get(nonce);
    return expiresAt !== undefined && expiresAt >= Date.now();
  }

  consume(nonce: string): boolean {
    this.prune();
    const expiresAt = this.map.get(nonce);
    if (expiresAt === undefined || expiresAt < Date.now()) {
      this.map.delete(nonce);
      return false;
    }
    this.map.delete(nonce);
    return true;
  }

  clear(): void {
    this.map.clear();
  }

  close(): void {
    this.map.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.map.entries()) {
      if (expiresAt < now) {
        this.map.delete(nonce);
      }
    }
  }
}

class SqliteNonceStore implements NonceStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_state_nonces (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_state_nonces_expires
        ON oauth_state_nonces(expires_at);
    `);
  }

  register(nonce: string, expiresAt: number): void {
    this.prune();
    this.db
      .prepare(
        `INSERT INTO oauth_state_nonces (nonce, expires_at, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(nonce) DO UPDATE SET expires_at = excluded.expires_at`
      )
      .run(nonce, expiresAt, Date.now());
  }

  hasActive(nonce: string): boolean {
    this.prune();
    const row = this.db
      .prepare('SELECT expires_at FROM oauth_state_nonces WHERE nonce = ?')
      .get(nonce) as { expires_at: number } | undefined;

    return row !== undefined && row.expires_at >= Date.now();
  }

  consume(nonce: string): boolean {
    this.prune();
    const now = Date.now();
    const result = this.db
      .prepare('DELETE FROM oauth_state_nonces WHERE nonce = ? AND expires_at >= ?')
      .run(nonce, now);
    return result.changes === 1;
  }

  clear(): void {
    this.db.prepare('DELETE FROM oauth_state_nonces').run();
  }

  close(): void {
    this.db.close();
  }

  private prune(): void {
    this.db
      .prepare('DELETE FROM oauth_state_nonces WHERE expires_at < ?')
      .run(Date.now());
  }
}

let store: NonceStore | null = null;

function getStore(): NonceStore {
  if (store) return store;

  if (config.nodeEnv === 'test') {
    store = new MemoryNonceStore();
    return store;
  }

  store = new SqliteNonceStore(config.credentials.sqlitePath);
  return store;
}

/**
 * Register a state nonce until its state expiry.
 */
export function registerOAuthStateNonce(nonce: string, expiresAt: number): void {
  const trimmed = nonce.trim();
  if (!trimmed) return;
  getStore().register(trimmed, expiresAt);
}

/**
 * Check if a state nonce is known and still active.
 */
export function hasActiveOAuthStateNonce(nonce: string): boolean {
  const trimmed = nonce.trim();
  if (!trimmed) return false;
  return getStore().hasActive(trimmed);
}

/**
 * Consume a state nonce. Returns false if missing/expired/already used.
 */
export function consumeOAuthStateNonce(nonce: string): boolean {
  const trimmed = nonce.trim();
  if (!trimmed) return false;
  return getStore().consume(trimmed);
}

/**
 * Test/helper utility.
 */
export function clearOAuthStateNonceStore(): void {
  getStore().clear();
}

/**
 * Close and reset store.
 */
export function closeOAuthStateNonceStore(): void {
  if (!store) return;
  store.close();
  store = null;
}
