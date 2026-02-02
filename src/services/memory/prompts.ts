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
import {
  DEFAULT_FACT_CHAR_CAP,
  ESTABLISHED_CONFIDENCE_THRESHOLD,
  clampConfidence,
  selectFactsWithCharCap,
} from './ranking.js';

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
  'recurring',     // Bills, subscriptions, recurring appointments
  'behavioral',    // Habits, activity patterns, communication style
  'context',       // Current projects, situations, temporary longer-term context
  'other',         // Anything that doesn't fit above categories
] as const;

export type FactCategory = typeof FACT_CATEGORIES[number];

const OBSERVATION_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

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
  const now = Date.now();
  const recentObservations = existingFacts.filter(
    (fact) =>
      clampConfidence(fact.confidence) < ESTABLISHED_CONFIDENCE_THRESHOLD &&
      now - fact.extractedAt <= OBSERVATION_WINDOW_MS
  );
  const establishedFacts = existingFacts.filter(
    (fact) => clampConfidence(fact.confidence) >= ESTABLISHED_CONFIDENCE_THRESHOLD
  );

  const factRender = (fact: UserFact) => {
    const learnedAt = new Date(fact.extractedAt).toISOString();
    const confidence = clampConfidence(fact.confidence).toFixed(2);
    return `- ${fact.fact} (${confidence}, learned ${learnedAt})`;
  };

  const { selected } = selectFactsWithCharCap(
    [...establishedFacts, ...recentObservations],
    factRender,
    { maxChars: DEFAULT_FACT_CHAR_CAP }
  );

  const selectedEstablished = selected.filter(
    (fact) => clampConfidence(fact.confidence) >= ESTABLISHED_CONFIDENCE_THRESHOLD
  );
  const selectedObservations = selected.filter(
    (fact) => clampConfidence(fact.confidence) < ESTABLISHED_CONFIDENCE_THRESHOLD
  );

  const establishedFactsList = selectedEstablished.length > 0
    ? selectedEstablished.map(factRender).join('\n')
    : '(none)';

  const recentObservationsList = selectedObservations.length > 0
    ? selectedObservations.map(factRender).join('\n')
    : '(none)';

  const messagesList = messages
    .map((m) => `[${m.role} | ${new Date(m.createdAt).toISOString()}]: ${m.content}`)
    .join('\n');

  return `You are a personal memory system that builds a comprehensive understanding of the user from conversations.
Your goal is to identify meaningful facts and patterns that help personalize future interactions.

## What You Are Analyzing

You receive full conversation transcripts including:
- User messages: what the user says directly
- Assistant responses: summaries of tool results (email searches, calendar queries, etc.)

Assistant responses are included only when they look like tool summaries.
Extract facts from both, using your judgment on source_type:
- User explicitly states something -> explicit
- Assistant tool summary -> inferred

## Types of Insights to Extract

### Observations (single occurrences)
First-time observations that may become patterns with more evidence.
- Assign confidence 0.3-0.5
- Mark source_type as inferred unless explicitly stated

### Patterns (confirmed)
Observations backed by multiple data points or strong evidence.
- Assign confidence 0.6-1.0
- Include evidence with specific examples when possible
- Prioritize recurring events, relationships, and behavioral preferences

## Confidence Scoring

Confidence = how certain you are this fact is true and will remain relevant.

- 0.3: weak signal, single inferred observation
- 0.4: single observation with some context
- 0.5: clear single explicit statement
- 0.6: pattern emerging (2-3 data points)
- 0.7: solid pattern, multiple confirmations
- 0.8: strong pattern, consistent over time
- 0.9: very confident, repeatedly confirmed
- 1.0: user explicitly asked to remember this

Guidelines:
- Explicit statements deserve higher confidence than inferences
- When uncertain, lean lower (the system can reinforce later)
- Patterns synthesized from observations should be 0.6+

## Categories

Assign each fact to one of these categories:
- preferences: Food, drinks, communication style, general preferences
- health: Allergies, conditions, medications, dietary restrictions
- relationships: Family members, pets, friends, colleagues
- work: Job title, company, role, work schedule, professional details
- interests: Hobbies, activities, topics of interest
- personal: Location, birthday, general personal information
- recurring: Bills, subscriptions, recurring appointments
- behavioral: Habits, activity patterns, communication preferences
- context: Current projects, situations, ongoing plans
- other: Facts that do not fit above categories

## Privacy Exclusions

NEVER extract these, even if mentioned multiple times:
- Passwords, PINs, security codes
- Full credit card/bank account numbers
- SSNs, government IDs
- API keys, tokens, credentials
- Specific medical diagnoses or test results

## Extraction Rules

- Extract NEW facts only (skip duplicates from existing knowledge)
- Focus on persistent information (not temporary states)
- Each fact must be atomic and self-contained
- Write facts in third person

## Existing Knowledge

<established_facts>
${establishedFactsList}
</established_facts>

<recent_observations>
${recentObservationsList}
</recent_observations>

## Conversation to Analyze

<conversation>
${messagesList}
</conversation>

## Output Format

Return ONLY valid JSON in this exact structure:
{
  "reasoning": "Brief explanation of your analysis: what you looked for, what you found or didn't find, and why you made each extraction decision.",
  "facts": [
    {
      "fact": "Example fact",
      "category": "preferences",
      "confidence": 0.6,
      "source_type": "explicit",
      "evidence": "Short supporting snippet"
    }
  ]
}

The "reasoning" field is REQUIRED even if no facts are extracted. Explain:
- What types of information you looked for in the messages
- Why specific messages did or didn't contain extractable facts
- Any patterns you noticed but chose not to extract (and why)

Return an empty facts array if nothing should be extracted, but still provide reasoning.

## Examples

Example with extractions:
{
  "reasoning": "User mentioned family details and work information. Extracted daughter's name (explicit mention) and job role. Skipped 'busy today' as temporary state.",
  "facts": [
    {"fact": "Has a daughter named Emma", "category": "relationships", "confidence": 0.7, "source_type": "explicit", "evidence": "User said 'my daughter Emma'"},
    {"fact": "Works at Google as a product manager", "category": "work", "confidence": 0.6, "source_type": "explicit"}
  ]
}

Example with no extractions:
{
  "reasoning": "Messages contain only greetings ('Hi', 'Hello') and task commands ('Create a list'). No personal facts, preferences, or persistent information to extract.",
  "facts": []
}

Skip these (don't extract):
- Temporary states: "Is traveling this week"
- Questions from user: "What's the weather like?"
- Duplicates: Facts already in existing knowledge (even if worded slightly differently)
- Vague statements: "Likes things" (too generic)`;
}

/**
 * Format extracted facts for logging/debugging.
 */
export function formatExtractedFactsForLog(
  facts: Array<{ fact: string; category?: string; confidence?: number }>
): string {
  if (facts.length === 0) {
    return '(no facts extracted)';
  }
  return facts
    .map((f) => {
      const confidence = f.confidence !== undefined ? ` ${f.confidence.toFixed(2)}` : '';
      return `[${f.category || 'other'}] ${f.fact}${confidence}`;
    })
    .join(', ');
}
