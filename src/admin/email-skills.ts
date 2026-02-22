/**
 * @fileoverview Email watcher admin API handlers.
 *
 * Provides endpoints for viewing and toggling the email watcher.
 * Email skill CRUD has been removed — skills are now managed via filesystem skill packs.
 */

import type { Request, Response } from 'express';
import { getUserConfigStore } from '../services/user-config/index.js';

/**
 * GET /admin/api/email-watcher/status
 * Returns per-user watcher status.
 */
export async function watcherStatus(_req: Request, res: Response): Promise<void> {
  try {
    const configStore = getUserConfigStore();
    const users = await configStore.getEmailWatcherUsers();

    const statuses = users.map((u) => ({
      phoneNumber: u.phoneNumber,
      name: u.name,
      enabled: u.emailWatcherEnabled ?? false,
      historyId: u.emailWatcherHistoryId ?? null,
    }));

    res.json({ users: statuses });
  } catch (error) {
    console.error('Error fetching watcher status:', error);
    res.status(500).json({ error: 'Failed to fetch watcher status' });
  }
}

/**
 * POST /admin/api/email-watcher/toggle
 * Toggles the email watcher for a user.
 */
export async function toggleWatcher(req: Request, res: Response): Promise<void> {
  try {
    const { phoneNumber, enabled } = req.body;

    if (!phoneNumber || typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'phoneNumber (string) and enabled (boolean) are required' });
      return;
    }

    const configStore = getUserConfigStore();
    await configStore.set(phoneNumber, { emailWatcherEnabled: enabled });

    res.json({ phoneNumber, enabled });
  } catch (error) {
    console.error('Error toggling watcher:', error);
    res.status(500).json({ error: 'Failed to toggle watcher' });
  }
}
