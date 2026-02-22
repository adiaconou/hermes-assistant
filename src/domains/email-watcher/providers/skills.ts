/**
 * Skills domain bridge — re-exports skill APIs for email-watcher use.
 */
import {
  findFilesystemSkill,
  listFilesystemSkills,
  executeFilesystemSkillByName,
} from '../../skills/runtime/index.js';
import type { SkillExecutionResult, LoadedSkill, SkillChannel } from '../../skills/types.js';
import { matchSkillForMessage } from '../../skills/service/matcher.js';

export {
  findFilesystemSkill,
  listFilesystemSkills,
  executeFilesystemSkillByName,
  matchSkillForMessage,
};
export type { SkillExecutionResult, LoadedSkill, SkillChannel };
