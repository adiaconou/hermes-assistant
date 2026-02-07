/**
 * @fileoverview Email skills admin API handlers.
 *
 * Provides endpoints for viewing and managing email watcher skills.
 * This is an internal admin tool - no authentication required.
 */

import type { Request, Response } from 'express';
import Database from 'better-sqlite3';
import config from '../config.js';
import { getEmailSkillStore } from '../services/email-watcher/sqlite.js';
import { getUserConfigStore } from '../services/user-config/index.js';

function getStore() {
  try {
    return getEmailSkillStore();
  } catch {
    // First call — initialize with credentials db
    const db = new Database(config.credentials.sqlitePath);
    return getEmailSkillStore(db);
  }
}

/**
 * GET /admin/api/email-skills
 * Returns skills, optionally filtered by ?phone= query param.
 */
export async function listSkills(req: Request, res: Response): Promise<void> {
  try {
    const store = getStore();
    const phone = req.query.phone as string | undefined;

    if (phone) {
      const skills = store.getSkillsForUser(phone);
      res.json({ skills });
      return;
    }

    // No phone filter — get all users with email watcher config, then collect skills
    const configStore = getUserConfigStore();
    const users = await configStore.getEmailWatcherUsers();
    const allSkills = users.flatMap((u) => store.getSkillsForUser(u.phoneNumber));

    res.json({ skills: allSkills });
  } catch (error) {
    console.error('Error listing email skills:', error);
    res.status(500).json({ error: 'Failed to list email skills' });
  }
}

/**
 * POST /admin/api/email-skills
 * Creates a new email skill.
 */
export async function createSkill(req: Request, res: Response): Promise<void> {
  try {
    const store = getStore();
    const { phoneNumber, name, description, matchCriteria, extractFields, actionType, actionPrompt, tools, enabled } = req.body;

    if (!phoneNumber || !name || !matchCriteria || !actionType || !actionPrompt) {
      res.status(400).json({ error: 'Missing required fields: phoneNumber, name, matchCriteria, actionType, actionPrompt' });
      return;
    }

    if (actionType !== 'execute_with_tools' && actionType !== 'notify') {
      res.status(400).json({ error: 'actionType must be "execute_with_tools" or "notify"' });
      return;
    }

    const skill = store.createSkill({
      phoneNumber,
      name,
      description: description || '',
      matchCriteria,
      extractFields: extractFields || [],
      actionType,
      actionPrompt,
      tools: tools || [],
      enabled: enabled !== false,
    });

    res.status(201).json({ skill });
  } catch (error) {
    console.error('Error creating email skill:', error);
    const message = error instanceof Error && error.message.includes('UNIQUE')
      ? 'A skill with that name already exists for this user'
      : 'Failed to create email skill';
    res.status(500).json({ error: message });
  }
}

/**
 * PUT /admin/api/email-skills/:id
 * Updates an existing email skill.
 */
export async function updateSkill(req: Request<{ id: string }>, res: Response): Promise<void> {
  try {
    const store = getStore();
    const { id } = req.params;

    const existing = store.getSkillById(id);
    if (!existing) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    const skill = store.updateSkill(id, req.body);
    res.json({ skill });
  } catch (error) {
    console.error('Error updating email skill:', error);
    res.status(500).json({ error: 'Failed to update email skill' });
  }
}

/**
 * DELETE /admin/api/email-skills/:id
 * Deletes an email skill by ID.
 */
export async function deleteSkill(req: Request<{ id: string }>, res: Response): Promise<void> {
  try {
    const store = getStore();
    const { id } = req.params;

    const existing = store.getSkillById(id);
    if (!existing) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    store.deleteSkill(id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting email skill:', error);
    res.status(500).json({ error: 'Failed to delete email skill' });
  }
}

/**
 * PATCH /admin/api/email-skills/:id/toggle
 * Toggles a skill's enabled state.
 */
export async function toggleSkill(req: Request<{ id: string }>, res: Response): Promise<void> {
  try {
    const store = getStore();
    const { id } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    const existing = store.getSkillById(id);
    if (!existing) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    store.toggleSkill(id, enabled);
    res.json({ skill: { ...existing, enabled, updatedAt: Date.now() } });
  } catch (error) {
    console.error('Error toggling email skill:', error);
    res.status(500).json({ error: 'Failed to toggle email skill' });
  }
}

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
