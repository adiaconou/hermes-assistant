/**
 * Memory Extraction Prompts
 *
 * Prompts used by the async memory processor to extract facts from conversations.
 *
 * ## Design Decision: Async-Only Extraction
 *
 * Agents do NOT proactively extract facts during conversations. Fact extraction
 * happens in two ways:
 *
 * 1. **Async Background Processing** (this file): The memory processor runs
 *    periodically (default: every 5 minutes) and extracts facts from unprocessed
 *    messages. This is the primary extraction mechanism.
 *
 * 2. **Explicit User Request**: When users explicitly ask to remember something
 *    (e.g., "Remember that I like coffee"), the memory-agent is invoked and uses
 *    the extract_memory tool.
 *
 * This design was chosen because:
 * - Reduces noise: Not every conversation contains memorable facts
 * - Respects user intent: Users control what gets remembered explicitly
 * - Async processing catches facts that slip through without blocking responses
 * - Keeps conversation agents focused on their primary tasks
 */

import type { UserFact } from './types.js';
import type { ConversationMessage } from '../conversation/types.js';

/**
 * Categories for extracted facts.
 * Used to organize and filter user memories.
 */
export const FACT_CATEGORIES = [
  'preferences',   // Food, music, communication style, etc.
  'health',        // Allergies, conditions, medications
  'relationships', // Family, pets, friends, colleagues
  'work',          // Job, company, role, schedule
  'interests',     // Hobbies, activities, topics of interest
  'personal',      // Location, birthday, general personal details
  'other',         // Anything that doesn't fit above categories
] as const;

export type FactCategory = typeof FACT_CATEGORIES[number];

/**
 * Build the extraction prompt for the async memory processor.
 *
 * This prompt instructs the LLM to:
 * - Extract NEW facts only (not duplicates of existing facts)
 * - Focus on persistent information (not temporary states)
 * - Only extract from user messages (not assistant responses)
 * - Return atomic, self-contained facts in third person
 *
 * @param existingFacts Facts already stored for this user (for deduplication)
 * @param messages Recent user messages to analyze
 * @returns Formatted prompt string
 */
export function buildExtractionPrompt(
  existingFacts: UserFact[],
  messages: ConversationMessage[]
): string {
  const existingFactsList = existingFacts.length > 0
    ? existingFacts.map((f) => `- ${f.fact}`).join('\n')
    : '(No existing facts stored)';

  const messagesList = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n');

  return `You are analyzing conversation messages to extract persistent facts about the user for long-term memory storage.

<existing_facts>
${existingFactsList}
</existing_facts>

<messages_to_analyze>
${messagesList}
</messages_to_analyze>

## Your Task

Extract NEW facts from the messages above. Each fact should be:

1. **Persistent** - Information that remains true over time
   - YES: "Has a dog named Max", "Is allergic to peanuts", "Works as a software engineer"
   - NO: "Is busy today", "Has a meeting at 3pm", "Is feeling tired"

2. **From the user** - Only extract facts stated by the user (role: user), not the assistant

3. **Not a duplicate** - Skip facts already in <existing_facts> (even if worded differently)

4. **Atomic** - Each fact should be a single, self-contained piece of information
   - YES: "Prefers morning meetings"
   - NO: "Prefers morning meetings and likes coffee and has two kids"

5. **Third person** - Write facts as statements about "the user"
   - YES: "Likes black coffee", "Has two children"
   - NO: "I like black coffee", "You have two children"

## Categories

Assign each fact to one of these categories:
- preferences: Food, drinks, communication style, general preferences
- health: Allergies, medical conditions, medications, dietary restrictions
- relationships: Family members, pets, friends, colleagues
- work: Job title, company, role, work schedule, professional details
- interests: Hobbies, activities, topics of interest
- personal: Location, birthday, general personal information
- other: Facts that don't fit the above categories

## Output Format

Return ONLY a JSON array. No explanation, no markdown, just the array:

[{"fact": "...", "category": "..."}]

Return an empty array [] if no new facts should be extracted.

## Examples

Good extractions:
- {"fact": "Has a daughter named Emma", "category": "relationships"}
- {"fact": "Is vegetarian", "category": "health"}
- {"fact": "Works at Google as a product manager", "category": "work"}
- {"fact": "Enjoys hiking on weekends", "category": "interests"}

Skip these (don't extract):
- Temporary states: "Is traveling this week"
- Questions from user: "What's the weather like?"
- Assistant statements: Anything the assistant said
- Duplicates: Facts already in existing_facts (even if worded slightly differently)
- Vague statements: "Likes things" (too generic)`;
}

/**
 * Format extracted facts for logging/debugging.
 */
export function formatExtractedFactsForLog(
  facts: Array<{ fact: string; category?: string }>
): string {
  if (facts.length === 0) {
    return '(no facts extracted)';
  }
  return facts
    .map((f) => `[${f.category || 'other'}] ${f.fact}`)
    .join(', ');
}
