/**
 * @fileoverview Classifier prompt construction for email watcher.
 *
 * Builds a dynamic system prompt for the LLM classifier based on
 * the user's active skills and personal context.
 */

import config from '../../../config.js';
import type { EmailSkill } from '../types.js';

/**
 * Build the classifier system prompt from active skills and user facts.
 *
 * The prompt instructs the LLM to classify incoming emails against
 * the user's skill definitions and return structured JSON results.
 */
export function buildClassifierPrompt(
  skills: EmailSkill[],
  userFacts: string[]
): string {
  const userContext = userFacts.length > 0
    ? userFacts.join('\n')
    : '(No user context available)';

  const skillSections = skills.map(skill => {
    let section = `### ${skill.name}\nMatch when: ${skill.matchCriteria}\nExtract: ${skill.extractFields.join(', ')}`;
    if (skill.actionType === 'notify') {
      section += `\nSummary instructions: ${skill.actionPrompt}`;
    }
    return section;
  }).join('\n\n');

  return `You are classifying incoming emails against the user's active skills.
For each email, determine ALL skills that match. Return confidence scores and extract the data fields each skill requires.

## User Context
${userContext}

## Active Skills

${skillSections}

## Response Format
Return JSON array, one entry per email:
[{
  "email_index": 1,
  "matches": [
    {
      "skill": "skill-name",
      "confidence": 0.92,
      "extracted": { ... },
      "summary": "Brief description"
    }
  ]
}]

Only include matches with confidence >= ${config.emailWatcher.confidenceThreshold}.
If no skills match, return: { "email_index": 1, "matches": [] }`;
}
