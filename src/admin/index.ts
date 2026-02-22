/**
 * @fileoverview Admin routes for internal tools.
 *
 * Provides web interfaces for managing the assistant's internal state.
 * These routes are intended for administrative use and have no authentication.
 *
 * Routes:
 * - GET /admin/memory - Memory management UI
 * - GET /admin/api/memories - List all memories
 * - DELETE /admin/api/memories/:id - Delete a memory
 * - GET /admin/email-skills - Email skills management UI
 * - GET /admin/api/email-skills - List email skills
 * - POST /admin/api/email-skills - Create an email skill
 * - PUT /admin/api/email-skills/:id - Update an email skill
 * - DELETE /admin/api/email-skills/:id - Delete an email skill
 * - PATCH /admin/api/email-skills/:id/toggle - Toggle an email skill
 * - GET /admin/api/email-watcher/status - Get watcher status
 * - POST /admin/api/email-watcher/toggle - Toggle watcher for a user
 */

import express, { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { listMemories, deleteMemory } from './memory.js';
import { listSkills, createSkill, updateSkill, deleteSkill, toggleSkill, watcherStatus, toggleWatcher } from './email-skills.js';

const router = Router();

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * GET /admin/memory
 * Serves the memory management UI.
 */
router.get('/admin/memory', (_req: Request, res: Response) => {
  const htmlPath = path.join(__dirname, 'views', 'memory.html');

  fs.readFile(htmlPath, 'utf8', (err, html) => {
    if (err) {
      console.error('Error reading memory.html:', err);
      res.status(500).send('Error loading page');
      return;
    }
    res.type('html').send(html);
  });
});

/**
 * GET /admin/api/memories
 * Returns all memories as JSON.
 */
router.get('/admin/api/memories', listMemories);

/**
 * DELETE /admin/api/memories/:id
 * Deletes a memory by ID.
 */
router.delete('/admin/api/memories/:id', deleteMemory);

/**
 * GET /admin/email-skills
 * Serves the email skills management UI.
 */
router.get('/admin/email-skills', (_req: Request, res: Response) => {
  const htmlPath = path.join(__dirname, 'views', 'email-skills.html');

  fs.readFile(htmlPath, 'utf8', (err, html) => {
    if (err) {
      console.error('Error reading email-skills.html:', err);
      res.status(500).send('Error loading page');
      return;
    }
    res.type('html').send(html);
  });
});

/**
 * GET /admin/api/email-skills
 * Returns all email skills as JSON.
 */
router.get('/admin/api/email-skills', listSkills);

/**
 * POST /admin/api/email-skills
 * Creates a new email skill.
 */
router.post('/admin/api/email-skills', express.json(), createSkill);

/**
 * PUT /admin/api/email-skills/:id
 * Updates an email skill.
 */
router.put('/admin/api/email-skills/:id', express.json(), updateSkill);

/**
 * DELETE /admin/api/email-skills/:id
 * Deletes an email skill.
 */
router.delete('/admin/api/email-skills/:id', deleteSkill);

/**
 * PATCH /admin/api/email-skills/:id/toggle
 * Toggles an email skill's enabled state.
 */
router.patch('/admin/api/email-skills/:id/toggle', express.json(), toggleSkill);

/**
 * GET /admin/api/email-watcher/status
 * Returns per-user watcher status.
 */
router.get('/admin/api/email-watcher/status', watcherStatus);

/**
 * POST /admin/api/email-watcher/toggle
 * Toggles the email watcher for a user.
 */
router.post('/admin/api/email-watcher/toggle', express.json(), toggleWatcher);

export default router;
