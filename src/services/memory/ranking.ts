/**
 * @fileoverview Shared helpers for ranking and selecting facts under a char cap.
 */

import type { UserFact } from './types.js';

export const DEFAULT_FACT_CHAR_CAP = 4000;
export const ESTABLISHED_CONFIDENCE_THRESHOLD = 0.6;

export function clampConfidence(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return ESTABLISHED_CONFIDENCE_THRESHOLD;
  }
  return Math.min(1, Math.max(0.3, value));
}

function getRecencyMs(fact: UserFact): number {
  return fact.lastReinforcedAt ?? fact.extractedAt;
}

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
