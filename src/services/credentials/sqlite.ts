/**
 * @fileoverview SQLite credential store with AES-256-GCM encryption.
 *
 * Tokens are encrypted at rest using the CREDENTIAL_ENCRYPTION_KEY.
 * Each credential is encrypted with a unique IV for security.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import type { CredentialStore, StoredCredential } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * SQLite credential store with AES-256-GCM encryption.
 */
export class SqliteCredentialStore implements CredentialStore {
  private db: Database.Database;
  private encryptionKey: Buffer;

  /**
   * @param dbPath Path to SQLite database file
   * @param encryptionKey 32-byte hex string for AES-256 encryption
   */
  constructor(dbPath: string, encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new Error(
        'CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)'
      );
    }
    this.encryptionKey = Buffer.from(encryptionKey, 'hex');

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
      CREATE TABLE IF NOT EXISTS credentials (
        phone_number TEXT NOT NULL,
        provider TEXT NOT NULL,
        encrypted_data BLOB NOT NULL,
        iv BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (phone_number, provider)
      )
    `);
  }

  private encrypt(data: string): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return { encrypted, iv, authTag };
  }

  private decrypt(encrypted: Buffer, iv: Buffer, authTag: Buffer): string {
    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    // Use Buffer.concat for deterministic encoding (handles multi-byte UTF-8 correctly)
    const decryptedBuffer = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decryptedBuffer.toString('utf8');
  }

  async get(
    phoneNumber: string,
    provider: string
  ): Promise<StoredCredential | null> {
    const row = this.db
      .prepare(
        `SELECT encrypted_data, iv, auth_tag FROM credentials
         WHERE phone_number = ? AND provider = ?`
      )
      .get(phoneNumber, provider) as
      | { encrypted_data: Buffer; iv: Buffer; auth_tag: Buffer }
      | undefined;

    if (!row) {
      return null;
    }

    try {
      const decrypted = this.decrypt(
        row.encrypted_data,
        row.iv,
        row.auth_tag
      );
      return JSON.parse(decrypted) as StoredCredential;
    } catch {
      // Decryption failed - corrupted or wrong key
      return null;
    }
  }

  async set(
    phoneNumber: string,
    provider: string,
    credential: StoredCredential
  ): Promise<void> {
    const data = JSON.stringify(credential);
    const { encrypted, iv, authTag } = this.encrypt(data);
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO credentials (phone_number, provider, encrypted_data, iv, auth_tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (phone_number, provider) DO UPDATE SET
           encrypted_data = excluded.encrypted_data,
           iv = excluded.iv,
           auth_tag = excluded.auth_tag,
           updated_at = excluded.updated_at`
      )
      .run(phoneNumber, provider, encrypted, iv, authTag, now, now);
  }

  async delete(phoneNumber: string, provider: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM credentials WHERE phone_number = ? AND provider = ?`)
      .run(phoneNumber, provider);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
