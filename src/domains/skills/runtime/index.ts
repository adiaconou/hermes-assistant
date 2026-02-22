/**
 * Skills domain runtime entry point.
 * Exposes init/get/list APIs for the skill registry.
 */
import { getSkillsConfig } from '../config.js';
import { buildRegistry } from '../service/registry.js';
import { executeFilesystemSkill } from '../service/executor.js';
import type { LoadedSkill, SkillLoadError, SkillExecutionResult } from '../types.js';
import type { AgentExecutionContext } from '../../../executor/types.js';

let _skills: LoadedSkill[] = [];
let _errors: SkillLoadError[] = [];
let _initialized = false;

/**
 * Initialize the filesystem skills registry.
 * Loads skills from bundled and imported directories.
 * Must be called once at startup, after config validation.
 */
export function initFilesystemSkills(): void {
  const config = getSkillsConfig();

  if (!config.enabled) {
    console.log(JSON.stringify({
      level: 'info',
      message: 'Filesystem skills disabled (SKILLS_ENABLED=false)',
      timestamp: new Date().toISOString(),
    }));
    _initialized = true;
    return;
  }

  const state = buildRegistry(config.bundledDir, config.importedDir);
  _skills = state.skills;
  _errors = state.errors;
  _initialized = true;

  console.log(JSON.stringify({
    level: 'info',
    message: 'Filesystem skills loaded',
    skillCount: _skills.length,
    errorCount: _errors.length,
    skills: _skills.map(s => s.name),
    timestamp: new Date().toISOString(),
  }));

  if (_errors.length > 0) {
    for (const err of _errors) {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Skill load error',
        skillDir: err.skillDir,
        error: err.error,
        source: err.source,
        timestamp: new Date().toISOString(),
      }));
    }
  }
}

/**
 * List all successfully loaded skills.
 */
export function listFilesystemSkills(): LoadedSkill[] {
  return _skills;
}

/**
 * List all skill load errors.
 */
export function listFilesystemSkillErrors(): SkillLoadError[] {
  return _errors;
}

/**
 * Find a loaded skill by name.
 */
export function findFilesystemSkill(name: string): LoadedSkill | null {
  return _skills.find(s => s.name === name) ?? null;
}

/**
 * Execute a filesystem skill by name.
 */
export async function executeFilesystemSkillByName(
  skillName: string,
  userMessage: string,
  context: AgentExecutionContext
): Promise<SkillExecutionResult> {
  const skill = findFilesystemSkill(skillName);
  if (!skill) {
    return {
      success: false,
      output: null,
      error: `Skill not found: ${skillName}`,
    };
  }

  if (!skill.enabled) {
    return {
      success: false,
      output: null,
      error: `Skill is disabled: ${skillName}`,
    };
  }

  return executeFilesystemSkill(skill, userMessage, context);
}

/**
 * Check if the skills registry has been initialized.
 */
export function isSkillsInitialized(): boolean {
  return _initialized;
}
