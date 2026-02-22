/**
 * Unit tests for legacy email-watcher skill helpers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(() => ({
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  seedDefaultSkills,
  validateSkillDefinition,
  initEmailWatcherState,
} from '../../../../src/domains/email-watcher/service/skills.js';
import { getUserConfigStore } from '../../../../src/services/user-config/index.js';

describe('seedDefaultSkills', () => {
  it('is a no-op and does not throw', () => {
    expect(() => seedDefaultSkills('+1234567890')).not.toThrow();
  });
});

describe('validateSkillDefinition', () => {
  const validSkill = {
    name: 'my-skill',
    matchCriteria: 'Emails containing important stuff from specific senders',
    actionType: 'notify' as const,
    actionPrompt: 'Summarize the email contents briefly',
    extractFields: ['field1', 'field2'],
    tools: [],
  };

  it('returns no errors for a valid skill', () => {
    const errors = validateSkillDefinition(validSkill);
    expect(errors).toEqual([]);
  });

  it('requires name', () => {
    const errors = validateSkillDefinition({ ...validSkill, name: undefined });
    expect(errors.some(e => e.field === 'name')).toBe(true);
  });

  it('requires matchCriteria', () => {
    const errors = validateSkillDefinition({ ...validSkill, matchCriteria: undefined });
    expect(errors.some(e => e.field === 'matchCriteria')).toBe(true);
  });

  it('rejects invalid actionType', () => {
    const errors = validateSkillDefinition({ ...validSkill, actionType: 'invalid' as never });
    expect(errors.some(e => e.field === 'actionType')).toBe(true);
  });

  it('requires tools for execute_with_tools', () => {
    const errors = validateSkillDefinition({
      ...validSkill,
      actionType: 'execute_with_tools',
      tools: [],
    });
    expect(errors.some(e => e.field === 'tools')).toBe(true);
  });
});

describe('initEmailWatcherState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets emailWatcherEnabled=true', async () => {
    const mockSet = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getUserConfigStore).mockReturnValue({ set: mockSet } as never);

    await initEmailWatcherState('+1234567890');

    expect(mockSet).toHaveBeenCalledWith('+1234567890', { emailWatcherEnabled: true });
  });
});
