/**
 * @fileoverview Credential store interface for OAuth tokens.
 *
 * Tokens are stored keyed by phone number and provider (e.g., 'google').
 * Implementations handle encryption - callers work with plain credentials.
 */

/**
 * OAuth credential stored for a user.
 */
export interface StoredCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

/**
 * Interface for credential storage backends.
 *
 * Implementations must handle encryption of tokens at rest.
 * The interface uses phone number as user identity (from Twilio).
 *
 * Note: Methods return Promises for interface flexibility, but the current
 * SQLite implementation (better-sqlite3) is synchronous. The async signature
 * allows swapping to an async backend without changing callers.
 */
export interface CredentialStore {
  /**
   * Get credentials for a phone number and provider.
   * @returns Credentials or null if not found.
   */
  get(phoneNumber: string, provider: string): Promise<StoredCredential | null>;

  /**
   * Store credentials for a phone number and provider.
   * Overwrites existing credentials if present.
   */
  set(
    phoneNumber: string,
    provider: string,
    credential: StoredCredential
  ): Promise<void>;

  /**
   * Delete credentials for a phone number and provider.
   * No-op if credentials don't exist.
   */
  delete(phoneNumber: string, provider: string): Promise<void>;
}
