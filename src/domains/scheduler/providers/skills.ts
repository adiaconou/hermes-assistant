/**
 * Skills domain bridge — re-exports skill APIs for scheduler use.
 */
import {
  findFilesystemSkill,
  executeFilesystemSkillByName,
} from '../../skills/runtime/index.js';
import type { SkillExecutionResult, LoadedSkill } from '../../skills/types.js';

export { findFilesystemSkill, executeFilesystemSkillByName };
export type { SkillExecutionResult, LoadedSkill };
