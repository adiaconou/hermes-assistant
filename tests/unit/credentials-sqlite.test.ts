/**
 * Unit tests for SqliteCredentialStore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteCredentialStore } from '../../src/services/credentials/sqlite.js';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = './data/test-credentials.db';
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('SqliteCredentialStore', () => {
  let store: SqliteCredentialStore;

  beforeEach(() => {
    // Ensure test directory exists
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Remove test DB if exists
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    store = new SqliteCredentialStore(TEST_DB_PATH, TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    store.close();
    // Clean up test DB
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it('stores and retrieves credentials', async () => {
    const credential = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    };

    await store.set('+1234567890', 'google', credential);
    const result = await store.get('+1234567890', 'google');

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe(credential.accessToken);
    expect(result?.refreshToken).toBe(credential.refreshToken);
    expect(result?.expiresAt).toBe(credential.expiresAt);
  });

  it('returns null for unknown phone number', async () => {
    const result = await store.get('+9999999999', 'google');
    expect(result).toBeNull();
  });

  it('encrypts tokens in database', async () => {
    const credential = {
      accessToken: 'secret-access-token',
      refreshToken: 'secret-refresh-token',
      expiresAt: Date.now() + 3600000,
    };

    await store.set('+1234567890', 'google', credential);
    store.close();

    // Read raw database file
    const dbContent = fs.readFileSync(TEST_DB_PATH);
    const dbString = dbContent.toString('utf8');

    // Verify plaintext tokens are NOT in the raw database
    expect(dbString).not.toContain('secret-access-token');
    expect(dbString).not.toContain('secret-refresh-token');

    // Recreate store to verify we can still read
    store = new SqliteCredentialStore(TEST_DB_PATH, TEST_ENCRYPTION_KEY);
    const result = await store.get('+1234567890', 'google');
    expect(result?.accessToken).toBe('secret-access-token');
  });

  it('deletes credentials', async () => {
    const credential = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
    };

    await store.set('+1234567890', 'google', credential);

    // Verify it exists
    let result = await store.get('+1234567890', 'google');
    expect(result).not.toBeNull();

    // Delete
    await store.delete('+1234567890', 'google');

    // Verify it's gone
    result = await store.get('+1234567890', 'google');
    expect(result).toBeNull();
  });
});
