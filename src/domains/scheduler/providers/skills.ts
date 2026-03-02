/**
 * Skills domain bridge — re-exports skill APIs for scheduler use.
 */
import {
  findFilesystemSkill,
  listFilesystemSkills,
  executeFilesystemSkillByName,
} from '../../skills/runtime/index.js';
import type { SkillExecutionResult, LoadedSkill } from '../../skills/types.js';

export { findFilesystemSkill, listFilesystemSkills, executeFilesystemSkillByName };
export type { SkillExecutionResult, LoadedSkill };
