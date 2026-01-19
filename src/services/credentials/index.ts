/**
 * @fileoverview Credential store factory.
 *
 * Returns the appropriate credential store based on configuration.
 * Singleton pattern - returns the same instance on repeated calls.
 */

import config from '../../config.js';
import type { CredentialStore } from './types.js';
import { SqliteCredentialStore } from './sqlite.js';
import { MemoryCredentialStore } from './memory.js';

export type { CredentialStore, StoredCredential } from './types.js';

let instance: CredentialStore | null = null;

/**
 * Get the credential store instance.
 *
 * Returns a singleton based on CREDENTIAL_STORE_PROVIDER config:
 * - 'sqlite': SQLite with encryption (default, for dev and production)
 * - 'memory': In-memory store (for tests only)
 */
export function getCredentialStore(): CredentialStore {
  if (instance) {
    return instance;
  }

  switch (config.credentials.provider) {
    case 'sqlite': {
      if (!config.credentials.encryptionKey) {
        throw new Error(
          'CREDENTIAL_ENCRYPTION_KEY is required for sqlite credential store'
        );
      }
      instance = new SqliteCredentialStore(
        config.credentials.sqlitePath,
        config.credentials.encryptionKey
      );
      break;
    }
    case 'memory':
      instance = new MemoryCredentialStore();
      break;
    default:
      // Default to memory for safety (e.g., in tests without config)
      instance = new MemoryCredentialStore();
  }

  return instance;
}

/**
 * Reset the credential store instance.
 * Useful for tests to get a fresh store.
 */
export function resetCredentialStore(): void {
  instance = null;
}
