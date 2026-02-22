/**
 * @fileoverview Filesystem skills admin API handlers.
 *
 * Provides read-only endpoints for viewing loaded filesystem skills and errors.
 */

import type { Request, Response } from 'express';
import { getSkillsRegistry } from '../registry/skills.js';

/**
 * GET /admin/api/skills
 * Returns all loaded filesystem skills and load errors.
 */
export async function listFilesystemSkills(_req: Request, res: Response): Promise<void> {
  try {
    const registry = getSkillsRegistry();
    const skills = registry.list();
    const errors = registry.listErrors();

    res.json({
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        source: s.source,
        channels: s.channels,
        tools: s.tools,
        matchHints: s.matchHints,
        enabled: s.enabled,
        delegateAgent: s.delegateAgent,
        rootDir: s.rootDir,
      })),
      errors,
      summary: {
        totalLoaded: skills.length,
        totalErrors: errors.length,
        enabledCount: skills.filter(s => s.enabled).length,
      },
    });
  } catch (error) {
    console.error('Error listing filesystem skills:', error);
    res.status(500).json({ error: 'Failed to list filesystem skills' });
  }
}
