/**
 * Unit tests for skill matcher.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/domains/skills/config.js', () => ({
  getSkillsConfig: vi.fn(() => ({
    confidenceThreshold: 0.3,
  })),
}));

import { matchSkillForMessage } from '../../../src/domains/skills/service/matcher.js';
import type { LoadedSkill } from '../../../src/domains/skills/types.js';

function makeSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name: 'test-skill',
    description: 'A test skill',
    markdownPath: '/skills/test-skill/SKILL.md',
    rootDir: '/skills/test-skill',
    channels: ['sms', 'whatsapp'],
    tools: [],
    matchHints: ['receipt', 'summarize'],
    enabled: true,
    source: 'bundled',
    delegateAgent: null,
    ...overrides,
  };
}

describe('matchSkillForMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches a skill when message contains hints', () => {
    const skill = makeSkill({ matchHints: ['receipt', 'summarize'] });

    const result = matchSkillForMessage('please summarize this receipt', 'sms', [skill]);

    expect(result).not.toBeNull();
    expect(result!.skill.name).toBe('test-skill');
    expect(result!.confidence).toBe(1.0);
    expect(result!.rationale).toContain('receipt');
    expect(result!.rationale).toContain('summarize');
  });

  it('returns null when no hints match', () => {
    const skill = makeSkill({ matchHints: ['receipt', 'summarize'] });

    const result = matchSkillForMessage('what is the weather today', 'sms', [skill]);

    expect(result).toBeNull();
  });

  it('filters by channel', () => {
    const skill = makeSkill({
      channels: ['email'],
      matchHints: ['receipt'],
    });

    const result = matchSkillForMessage('receipt', 'sms', [skill]);

    expect(result).toBeNull();
  });

  it('skips disabled skills', () => {
    const skill = makeSkill({
      enabled: false,
      matchHints: ['receipt'],
    });

    const result = matchSkillForMessage('receipt', 'sms', [skill]);

    expect(result).toBeNull();
  });

  it('returns best match when multiple skills match', () => {
    const weakSkill = makeSkill({
      name: 'weak-match',
      matchHints: ['receipt', 'photo', 'scan', 'document'],
    });
    const strongSkill = makeSkill({
      name: 'strong-match',
      matchHints: ['receipt', 'summarize'],
    });

    const result = matchSkillForMessage(
      'summarize this receipt',
      'sms',
      [weakSkill, strongSkill]
    );

    expect(result).not.toBeNull();
    expect(result!.skill.name).toBe('strong-match');
    expect(result!.confidence).toBe(1.0);
  });

  it('returns null when confidence is below threshold', () => {
    // 1 out of 4 hints = 0.25, below 0.3 threshold
    const skill = makeSkill({
      matchHints: ['receipt', 'photo', 'scan', 'document'],
    });

    const result = matchSkillForMessage('receipt', 'sms', [skill]);

    expect(result).toBeNull();
  });

  it('skips skills with no match hints', () => {
    const skill = makeSkill({ matchHints: [] });

    const result = matchSkillForMessage('receipt', 'sms', [skill]);

    expect(result).toBeNull();
  });

  it('matches case-insensitively', () => {
    const skill = makeSkill({ matchHints: ['receipt'] });

    const result = matchSkillForMessage('RECEIPT found', 'sms', [skill]);

    expect(result).not.toBeNull();
    expect(result!.skill.name).toBe('test-skill');
  });
});
