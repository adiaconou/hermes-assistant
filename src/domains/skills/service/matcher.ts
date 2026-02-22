/**
 * Skill matcher for background triggers (scheduler and email watcher).
 * Conversational requests use orchestrator planner, NOT this matcher.
 */
import type { LoadedSkill, SkillMatch, SkillChannel } from '../types.js';
import { getSkillsConfig } from '../config.js';

/**
 * Match a message against loaded skills for a given channel.
 * Uses keyword-based matching against skill matchHints.
 * Returns the best match above confidence threshold, or null.
 */
export function matchSkillForMessage(
  message: string,
  channel: SkillChannel,
  skills: LoadedSkill[]
): SkillMatch | null {
  const config = getSkillsConfig();
  const messageLower = message.toLowerCase();

  let bestMatch: SkillMatch | null = null;

  for (const skill of skills) {
    // Skip disabled skills
    if (!skill.enabled) continue;

    // Skip skills that don't support this channel
    if (!skill.channels.includes(channel)) continue;

    // Check match hints
    if (skill.matchHints.length === 0) continue;

    let matchCount = 0;
    const matchedHints: string[] = [];

    for (const hint of skill.matchHints) {
      if (messageLower.includes(hint.toLowerCase())) {
        matchCount++;
        matchedHints.push(hint);
      }
    }

    if (matchCount === 0) continue;

    const confidence = matchCount / skill.matchHints.length;

    if (confidence >= config.confidenceThreshold) {
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = {
          skill,
          confidence,
          rationale: `Matched hints: ${matchedHints.join(', ')}`,
        };
      }
    }
  }

  return bestMatch;
}
