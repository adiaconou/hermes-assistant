/**
 * Skill registry — loads, validates, and indexes filesystem skills.
 */
import path from 'path';
import { discoverSkillDirs, readSkillMd } from '../repo/filesystem.js';
import { parseSkillMd } from './parser.js';
import { validateSkillFrontmatter } from './validator.js';
import type { LoadedSkill, SkillLoadError, SkillChannel } from '../types.js';

export type RegistryState = {
  skills: LoadedSkill[];
  errors: SkillLoadError[];
};

/**
 * Load skills from a directory (bundled or imported).
 */
export function loadSkillsFromDir(
  rootDir: string,
  source: 'bundled' | 'imported'
): RegistryState {
  const skills: LoadedSkill[] = [];
  const errors: SkillLoadError[] = [];

  const skillDirs = discoverSkillDirs(rootDir);

  for (const skillDir of skillDirs) {
    try {
      const raw = readSkillMd(skillDir);
      const { frontmatter } = parseSkillMd(raw);
      const validationErrors = validateSkillFrontmatter(frontmatter);

      if (validationErrors.length > 0) {
        errors.push({
          skillDir,
          error: validationErrors.map(e => `${e.field}: ${e.message}`).join('; '),
          source,
        });
        continue;
      }

      const hermes = frontmatter.metadata?.hermes;
      const skill: LoadedSkill = {
        name: frontmatter.name,
        description: frontmatter.description,
        markdownPath: path.join(skillDir, 'SKILL.md'),
        rootDir: skillDir,
        channels: (hermes?.channels ?? ['sms', 'whatsapp']) as SkillChannel[],
        tools: hermes?.tools ?? [],
        matchHints: hermes?.match ?? [],
        enabled: hermes?.enabled !== false,
        source,
        delegateAgent: hermes?.delegateAgent ?? null,
      };

      skills.push(skill);
    } catch (err) {
      errors.push({
        skillDir,
        error: err instanceof Error ? err.message : String(err),
        source,
      });
    }
  }

  return { skills, errors };
}

/**
 * Build the full registry from bundled and imported skill directories.
 */
export function buildRegistry(
  bundledDir: string,
  importedDir: string
): RegistryState {
  const bundled = loadSkillsFromDir(bundledDir, 'bundled');
  const imported = loadSkillsFromDir(importedDir, 'imported');

  // Imported skills override bundled skills with the same name
  const skillMap = new Map<string, LoadedSkill>();
  for (const skill of bundled.skills) {
    skillMap.set(skill.name, skill);
  }
  for (const skill of imported.skills) {
    skillMap.set(skill.name, skill);
  }

  return {
    skills: Array.from(skillMap.values()),
    errors: [...bundled.errors, ...imported.errors],
  };
}
