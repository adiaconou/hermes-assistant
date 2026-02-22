/**
 * @fileoverview Memory admin API handlers.
 *
 * Provides endpoints for viewing and managing stored user memories.
 * This is an internal admin tool - no authentication required.
 */

import type { Request, Response } from 'express';
import { getMemoryStore } from '../domains/memory/runtime/index.js';

/**
 * GET /admin/api/memories
 * Returns all memories from all users.
 */
export async function listMemories(_req: Request, res: Response): Promise<void> {
  try {
    const store = getMemoryStore();
    const memories = await store.getAllFacts();

    res.json({ memories });
  } catch (error) {
    console.error('Error listing memories:', error);
    res.status(500).json({ error: 'Failed to list memories' });
  }
}

/**
 * DELETE /admin/api/memories/:id
 * Deletes a memory by ID.
 */
export async function deleteMemory(
  req: Request<{ id: string }>,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;
    const store = getMemoryStore();

    // Check if memory exists first
    const allFacts = await store.getAllFacts();
    const exists = allFacts.some((f) => f.id === id);

    if (!exists) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }

    await store.deleteFact(id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting memory:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
}
