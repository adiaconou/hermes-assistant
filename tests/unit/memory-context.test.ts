/**
 * Unit tests for memory context injection helpers.
 */

import { describe, it, expect } from 'vitest';
import { buildFactsXml } from '../../src/services/anthropic/prompts/context.js';

describe('buildFactsXml', () => {
  it('orders facts by confidence and includes learned date', () => {
    const facts = [
      {
        id: 'fact_1',
        phoneNumber: '+15551234567',
        fact: 'High confidence fact',
        category: 'preferences',
        confidence: 0.9,
        sourceType: 'explicit' as const,
        extractedAt: Date.parse('2026-01-01T00:00:00Z'),
      },
      {
        id: 'fact_2',
        phoneNumber: '+15551234567',
        fact: 'Lower confidence fact',
        category: 'personal',
        confidence: 0.5,
        sourceType: 'explicit' as const,
        extractedAt: Date.parse('2026-02-01T00:00:00Z'),
        evidence: 'Should not appear',
      },
      {
        id: 'fact_3',
        phoneNumber: '+15551234567',
        fact: 'Strong confidence fact',
        category: 'work',
        confidence: 0.8,
        sourceType: 'explicit' as const,
        extractedAt: Date.parse('2026-03-01T00:00:00Z'),
      },
    ];

    const xml = buildFactsXml(facts, { maxChars: 2000 });

    expect(xml).toContain('High confidence fact');
    expect(xml).toContain('Strong confidence fact');
    expect(xml).toContain('Lower confidence fact');
    expect(xml).toContain('learned 2026-01-01');
    expect(xml).not.toContain('Should not appear');

    const highIndex = xml.indexOf('High confidence fact');
    const strongIndex = xml.indexOf('Strong confidence fact');
    const lowIndex = xml.indexOf('Lower confidence fact');

    expect(highIndex).toBeLessThan(strongIndex);
    expect(strongIndex).toBeLessThan(lowIndex);
  });

  it('respects char cap when selecting facts', () => {
    const facts = [
      {
        id: 'fact_1',
        phoneNumber: '+15551234567',
        fact: 'High confidence fact',
        category: 'preferences',
        confidence: 0.9,
        sourceType: 'explicit' as const,
        extractedAt: Date.parse('2026-01-01T00:00:00Z'),
      },
      {
        id: 'fact_2',
        phoneNumber: '+15551234567',
        fact: 'Another fact',
        category: 'personal',
        confidence: 0.7,
        sourceType: 'explicit' as const,
        extractedAt: Date.parse('2026-02-01T00:00:00Z'),
      },
    ];

    const firstRendered = 'High confidence fact (learned 2026-01-01)';
    const xml = buildFactsXml(facts, { maxChars: firstRendered.length });

    expect(xml).toContain('High confidence fact');
    expect(xml).not.toContain('Another fact');
  });
});
