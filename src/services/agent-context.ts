/**
 * Shared agent context builders.
 *
 * Centralizes the time/user context construction that was duplicated
 * across every agent executor.
 */

import { buildTimeContext } from '../services/anthropic/prompts/context.js';
import type { UserConfig } from '../services/user-config/types.js';

/**
 * Build the time context string for an agent prompt.
 * Returns a formatted current-time string or a fallback asking for timezone.
 */
export function buildAgentTimeContext(userConfig: UserConfig | null): string {
  return userConfig
    ? `Current time: ${buildTimeContext(userConfig)}`
    : 'Timezone: not set (ask user for timezone first)';
}

/**
 * Build the user context string for an agent prompt.
 * Returns the user's name or empty string if not set.
 */
export function buildAgentUserContext(userConfig: UserConfig | null): string {
  return userConfig?.name
    ? `User: ${userConfig.name}`
    : '';
}

/**
 * Apply standard context placeholders to an agent prompt template.
 * Replaces {timeContext} and {userContext} placeholders.
 */
export function applyAgentContext(
  promptTemplate: string,
  userConfig: UserConfig | null
): string {
  return promptTemplate
    .replace('{timeContext}', buildAgentTimeContext(userConfig))
    .replace('{userContext}', buildAgentUserContext(userConfig));
}
