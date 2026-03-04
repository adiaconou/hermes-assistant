/**
 * Skill executor — runs a filesystem skill through the LLM tool loop.
 */
import { loadSkillBody } from '../repo/filesystem.js';
import { safeReadFile, listSkillResources } from '../repo/filesystem.js';
import { getSkillsExecuteWithTools } from '../providers/executor.js';
import type { LoadedSkill, SkillExecutionResult } from '../types.js';
import type { AgentExecutionContext } from '../../../executor/types.js';

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasMarkdownHeader(output: string, header: string): boolean {
  const pattern = new RegExp(
    `(^|\\n)\\s{0,3}(?:#{1,6}\\s*)?${escapeRegex(header)}\\s*$`,
    'im'
  );
  return pattern.test(output);
}

function normalizeDailyBriefingOutput(output: string | null): string {
  const emailHeader = 'Email Summary';
  const calendarHeader = 'Calendar (Next 7 Days)';

  let normalized = output?.trim() ?? '';
  if (normalized.length === 0) {
    return [
      `### ${emailHeader}`,
      'No important updates.',
      '',
      `### ${calendarHeader}`,
      'No important updates.',
    ].join('\n');
  }

  if (!hasMarkdownHeader(normalized, emailHeader)) {
    normalized += `\n\n### ${emailHeader}\nNo important updates.`;
  }

  if (!hasMarkdownHeader(normalized, calendarHeader)) {
    normalized += `\n\n### ${calendarHeader}\nNo important updates.`;
  }

  return normalized;
}

function normalizeSkillOutput(skill: LoadedSkill, output: string | null): string | null {
  if (skill.name === 'daily-briefing') {
    return normalizeDailyBriefingOutput(output);
  }
  return output;
}

/**
 * Build a system prompt for skill execution.
 * Includes current time context, the skill body, auth instructions, and resource files.
 */
function buildSkillPrompt(skill: LoadedSkill, context: AgentExecutionContext): string {
  const body = loadSkillBody(skill.markdownPath);

  // Build time context so the LLM knows the current date/time
  const now = new Date();
  const timezone = context.userConfig?.timezone;
  const timeContext = timezone
    ? now.toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : now.toISOString();

  const sections: string[] = [
    `**Current time: ${timeContext}**`,
    '',
    `You are executing the "${skill.name}" skill.`,
    '',
    '## Skill Instructions',
    '',
    body,
    '',
    '## Authentication Errors',
    '',
    'If any tool returns auth_required: true with an auth_url, you MUST include the exact auth_url in your response so the user can re-authenticate.',
    'Format: "To access your [calendar/email], tap this link: [paste the exact auth_url here]"',
    'Never paraphrase or omit the URL - the user needs this link to fix the issue.',
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
    const systemPrompt = buildSkillPrompt(skill, context);
    const executeWithTools = getSkillsExecuteWithTools();

    const toolNames = skill.tools.length > 0 ? skill.tools : [];

    const result = await executeWithTools(
      systemPrompt,
      userMessage,
      toolNames,
      context
    );

    const output = typeof result.output === 'string'
      ? result.output
      : result.output != null
        ? JSON.stringify(result.output)
        : null;

    return {
      success: result.success,
      output: normalizeSkillOutput(skill, output),
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
