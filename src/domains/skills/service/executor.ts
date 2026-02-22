/**
 * Skill executor — runs a filesystem skill through the LLM tool loop.
 */
import { loadSkillBody } from '../repo/filesystem.js';
import { safeReadFile, listSkillResources } from '../repo/filesystem.js';
import { getSkillsExecuteWithTools } from '../providers/executor.js';
import type { LoadedSkill, SkillExecutionResult } from '../types.js';
import type { AgentExecutionContext } from '../../../executor/types.js';

/**
 * Build a system prompt for skill execution.
 * Includes the skill body and any resource files.
 */
function buildSkillPrompt(skill: LoadedSkill): string {
  const body = loadSkillBody(skill.markdownPath);

  const sections: string[] = [
    `You are executing the "${skill.name}" skill.`,
    '',
    '## Skill Instructions',
    '',
    body,
  ];

  // Include resource files as context
  const resourceDirs = ['references', 'scripts', 'assets'];
  for (const dir of resourceDirs) {
    const resources = listSkillResources(skill.rootDir, dir);
    for (const resourcePath of resources) {
      try {
        const content = safeReadFile(
          `${skill.rootDir}/${resourcePath}`,
          skill.rootDir
        );
        sections.push('');
        sections.push(`## Resource: ${resourcePath}`);
        sections.push('');
        sections.push(content);
      } catch {
        // Skip unreadable resources
      }
    }
  }

  return sections.join('\n');
}

/**
 * Execute a loaded filesystem skill.
 */
export async function executeFilesystemSkill(
  skill: LoadedSkill,
  userMessage: string,
  context: AgentExecutionContext
): Promise<SkillExecutionResult> {
  try {
    const systemPrompt = buildSkillPrompt(skill);
    const executeWithTools = getSkillsExecuteWithTools();

    const toolNames = skill.tools.length > 0 ? skill.tools : [];

    const result = await executeWithTools(
      systemPrompt,
      userMessage,
      toolNames,
      context
    );

    return {
      success: result.success,
      output: typeof result.output === 'string'
        ? result.output
        : result.output != null
          ? JSON.stringify(result.output)
          : null,
      error: result.error,
    };
  } catch (err) {
    return {
      success: false,
      output: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
