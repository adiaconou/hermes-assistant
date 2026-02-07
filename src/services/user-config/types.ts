/**
 * @fileoverview User configuration store interface.
 *
 * Stores per-user preferences like name and timezone.
 * Phone number is the primary key (from Twilio SMS).
 */

/**
 * User configuration stored for a phone number.
 */
export interface UserConfig {
  phoneNumber: string;
  name?: string;
  timezone?: string; // IANA timezone (e.g., "America/Los_Angeles")
  emailWatcherHistoryId?: string;
  emailWatcherEnabled?: boolean;
  createdAt: number; // Unix timestamp in milliseconds
  updatedAt: number; // Unix timestamp in milliseconds
}

/**
 * Interface for user configuration storage backends.
 */
export interface UserConfigStore {
  /**
   * Get configuration for a phone number.
   * @returns User config or null if not found.
   */
  get(phoneNumber: string): Promise<UserConfig | null>;

  /**
   * Store or update configuration for a phone number.
   * Creates new record if not exists, updates if exists.
   */
  set(phoneNumber: string, config: Partial<Omit<UserConfig, 'phoneNumber'>>): Promise<void>;

  /**
   * Delete configuration for a phone number.
   * No-op if config doesn't exist.
   */
  delete(phoneNumber: string): Promise<void>;

  /** Get all users with email watcher enabled and Google credentials */
  getEmailWatcherUsers(): Promise<UserConfig[]>;

  /** Update email watcher historyId cursor */
  updateEmailWatcherState(phoneNumber: string, historyId: string): Promise<void>;
}
