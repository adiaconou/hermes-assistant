/**
 * @fileoverview Email watcher state helpers.
 *
 * Runtime skill behavior is now fully filesystem-backed; this module keeps
 * only OAuth-to-watcher initialization wiring.
 */

import { getUserConfigStore } from '../../../services/user-config/index.js';

/**
 * Initialize email watcher state for a user.
 *
 * Called after successful Google OAuth. Sets the user's watcher
 * to enabled.
 */
export async function initEmailWatcherState(phoneNumber: string): Promise<void> {
  const userConfigStore = getUserConfigStore();
  await userConfigStore.set(phoneNumber, { emailWatcherEnabled: true });
}
