/**
 * @fileoverview In-memory credential store for testing.
 *
 * No encryption - stores credentials in plain memory.
 * Data is lost on process restart. Use only for tests.
 */

import type { CredentialStore, StoredCredential } from './types.js';

/**
 * In-memory credential store for testing.
 */
export class MemoryCredentialStore implements CredentialStore {
  private store = new Map<string, StoredCredential>();

  private key(phoneNumber: string, provider: string): string {
    return `${phoneNumber}:${provider}`;
  }

  async get(
    phoneNumber: string,
    provider: string
  ): Promise<StoredCredential | null> {
    return this.store.get(this.key(phoneNumber, provider)) ?? null;
  }

  async set(
    phoneNumber: string,
    provider: string,
    credential: StoredCredential
  ): Promise<void> {
    this.store.set(this.key(phoneNumber, provider), credential);
  }

  async delete(phoneNumber: string, provider: string): Promise<void> {
    this.store.delete(this.key(phoneNumber, provider));
  }

  /** Clear all credentials. Useful for test cleanup. */
  clear(): void {
    this.store.clear();
  }
}
