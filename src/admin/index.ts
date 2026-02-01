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
 */

import { Router, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { listMemories, deleteMemory } from './memory.js';

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

export default router;
