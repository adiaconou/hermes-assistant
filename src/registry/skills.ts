/**
 * App-level skills registry facade.
 *
 * Provides a stable public contract for accessing filesystem skills.
 * Consumed by the orchestrator and provider bridges.
 * Domains must NOT import this directly — use provider bridges instead.
 */
import {
  listFilesystemSkills,
  listFilesystemSkillErrors,
  findFilesystemSkill,
  executeFilesystemSkillByName,
} from '../domains/skills/runtime/index.js';
import type { LoadedSkill, SkillLoadError, SkillExecutionResult, SkillChannel } from '../domains/skills/types.js';
import type { AgentExecutionContext } from '../executor/types.js';

export type SkillsRegistry = {
  list(): LoadedSkill[];
  listErrors(): SkillLoadError[];
  findByName(name: string): LoadedSkill | null;
  executeByName(
    skillName: string,
    userMessage: string,
    context: AgentExecutionContext,
    channelOverride?: SkillChannel
  ): Promise<SkillExecutionResult>;
};

export function getSkillsRegistry(): SkillsRegistry {
  return {
    list: listFilesystemSkills,
    listErrors: listFilesystemSkillErrors,
    findByName: findFilesystemSkill,
    executeByName: executeFilesystemSkillByName,
  };
}

// Re-export types for convenience
export type { LoadedSkill, SkillLoadError, SkillExecutionResult } from '../domains/skills/types.js';
