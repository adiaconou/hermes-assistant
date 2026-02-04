/**
 * @fileoverview Fact ranking and selection utilities.
 *
 * This module handles sorting and selecting facts for injection into agent prompts,
 * respecting character limits and prioritizing high-confidence facts.
 *
 * ## Confidence Model
 *
 * Facts have a confidence score between 0.3 and 1.0:
 *
 * | Score | Meaning | Example |
 * |-------|---------|---------|
 * | 0.3   | Weak single inference | "Might have a meeting (mentioned calendar)" |
 * | 0.4-0.5 | Single observation | "Mentioned liking coffee once" |
 * | 0.6   | Emerging pattern (2-3 data points) | "Has mentioned coffee twice" |
 * | 0.7-0.8 | Solid pattern | "Consistently orders coffee in conversations" |
 * | 0.9   | Repeatedly confirmed | "Has mentioned coffee preference 5+ times" |
 * | 1.0   | Explicit user request | "Remember that I like black coffee" |
 *
 * ## Established Facts vs Observations
 *
 * The `ESTABLISHED_CONFIDENCE_THRESHOLD` (0.6) separates:
 *
 * - **Established Facts** (≥0.6): Reliable, long-term knowledge. Prioritized in selection.
 * - **Observations** (<0.6): Tentative, may be reinforced or decay. Lower priority.
 *
 * This distinction affects:
 * - Selection order (facts first, then observations fill remaining space)
 * - Cleanup (observations older than 180 days are deleted)
 * - Extraction prompts (shown separately to help LLM avoid duplicates)
 *
 * @see ./processor.ts for how confidence is assigned during extraction
 * @see ./sqlite.ts for cleanup of stale observations
 */

import type { UserFact } from './types.js';

/** Maximum characters of fact text to inject into prompts by default. */
export const DEFAULT_FACT_CHAR_CAP = 4000;

/**
 * Confidence threshold separating established facts from observations.
 * Facts with confidence >= this value are considered established.
 * Facts below this value are observations (tentative, subject to decay).
 */
export const ESTABLISHED_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Normalize confidence to valid range [0.3, 1.0].
 *
 * Invalid values (NaN, non-numbers) default to the established threshold (0.6)
 * to avoid accidentally treating corrupt data as low-confidence.
 *
 * @param value - Raw confidence value
 * @returns Clamped confidence between 0.3 and 1.0
 */
export function clampConfidence(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return ESTABLISHED_CONFIDENCE_THRESHOLD;
  }
  return Math.min(1, Math.max(0.3, value));
}

/**
 * Get the timestamp to use for recency sorting.
 * Prefers lastReinforcedAt (when fact was last confirmed) over extractedAt.
 */
function getRecencyMs(fact: UserFact): number {
  return fact.lastReinforcedAt ?? fact.extractedAt;
}

/**
 * Sort facts by confidence (descending), then by recency (descending).
 *
 * Higher confidence facts appear first. Among facts with equal confidence,
 * more recently reinforced/extracted facts appear first.
 *
 * @param facts - Facts to sort
 * @returns New sorted array (does not mutate input)
 */
export function sortFactsByConfidenceAndRecency(facts: UserFact[]): UserFact[] {
  return [...facts].sort((a, b) => {
    const aConfidence = clampConfidence(a.confidence);
    const bConfidence = clampConfidence(b.confidence);
    if (aConfidence !== bConfidence) {
      return bConfidence - aConfidence;
    }
    return getRecencyMs(b) - getRecencyMs(a);
  });
}

/**
 * Select facts that fit within a character budget.
 *
 * Selection strategy:
 * 1. Add established facts (≥ threshold) first, sorted by confidence then recency
 * 2. Fill remaining space with observations (< threshold), same sort order
 * 3. Stop when adding the next fact would exceed maxChars
 *
 * This ensures high-confidence facts are always included before observations,
 * and within each category, the most confident and recent facts take priority.
 *
 * @param facts - All facts to select from
 * @param render - Function to render a fact as a string (for character counting)
 * @param options - maxChars (default 4000), establishedThreshold (default 0.6)
 * @returns Selected facts and total character count
 */
export function selectFactsWithCharCap(
  facts: UserFact[],
  render: (fact: UserFact) => string,
  options?: { maxChars?: number; establishedThreshold?: number }
): { selected: UserFact[]; totalChars: number } {
  const maxChars = options?.maxChars ?? DEFAULT_FACT_CHAR_CAP;
  const threshold = options?.establishedThreshold ?? ESTABLISHED_CONFIDENCE_THRESHOLD;

  const established = sortFactsByConfidenceAndRecency(
    facts.filter((fact) => clampConfidence(fact.confidence) >= threshold)
  );
  const observations = sortFactsByConfidenceAndRecency(
    facts.filter((fact) => clampConfidence(fact.confidence) < threshold)
  );

  const selected: UserFact[] = [];
  let totalChars = 0;

  const addFacts = (list: UserFact[]) => {
    for (const fact of list) {
      const line = render(fact);
      const addition = (selected.length > 0 ? '\n' : '') + line;
      if (totalChars + addition.length > maxChars) {
        break;
      }
      selected.push(fact);
      totalChars += addition.length;
    }
  };

  addFacts(established);
  addFacts(observations);

  return { selected, totalChars };
}
