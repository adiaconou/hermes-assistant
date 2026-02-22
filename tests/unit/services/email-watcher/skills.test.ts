/**
 * Unit tests for email skill management and validation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EmailSkillStore, resetEmailSkillStore } from '../../../../src/domains/email-watcher/repo/sqlite.js';

// Mock user config store
vi.mock('../../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(() => ({
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

// We need to provide the store to the singleton before importing skills module
vi.mock('../../../../src/domains/email-watcher/repo/sqlite.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    getEmailSkillStore: vi.fn(),
  };
});

import {
  seedDefaultSkills,
  validateSkillDefinition,
  initEmailWatcherState,
} from '../../../../src/domains/email-watcher/service/skills.js';
import { getEmailSkillStore } from '../../../../src/domains/email-watcher/repo/sqlite.js';
import { getUserConfigStore } from '../../../../src/services/user-config/index.js';

describe('seedDefaultSkills', () => {
  let db: Database.Database;
  let store: EmailSkillStore;

  beforeEach(() => {
    resetEmailSkillStore();
    db = new Database(':memory:');
    store = new EmailSkillStore(db);

    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue(store);
    vi.clearAllMocks();
    // Re-mock after clearAllMocks
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue(store);
  });

  it('creates 3 default skills', () => {
    seedDefaultSkills('+1234567890');

    const skills = store.getSkillsForUser('+1234567890');
    expect(skills).toHaveLength(3);

    const names = skills.map(s => s.name).sort();
    expect(names).toEqual(['expense-tracker', 'invite-detector', 'tax-tracker']);
  });

  it('is idempotent - calling twice does not create duplicates', () => {
    seedDefaultSkills('+1234567890');
    seedDefaultSkills('+1234567890');

    const skills = store.getSkillsForUser('+1234567890');
    expect(skills).toHaveLength(3);
  });

  it('does not overwrite existing skills with same name', () => {
    // Create a custom skill with same name as default
    store.createSkill({
      phoneNumber: '+1234567890',
      name: 'tax-tracker',
      description: 'Custom tax tracker',
      matchCriteria: 'Custom criteria for tax stuff',
      extractFields: ['custom_field'],
      actionType: 'notify',
      actionPrompt: 'Custom prompt for notifications',
      tools: [],
      enabled: false,
    });

    seedDefaultSkills('+1234567890');

    const taxSkill = store.getSkillByName('+1234567890', 'tax-tracker');
    expect(taxSkill!.description).toBe('Custom tax tracker');
    expect(taxSkill!.enabled).toBe(false);
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

  it('rejects name longer than 50 chars', () => {
    const errors = validateSkillDefinition({ ...validSkill, name: 'a'.repeat(51) });
    expect(errors.some(e => e.field === 'name' && e.message.includes('50'))).toBe(true);
  });

  it('rejects name with uppercase or special characters', () => {
    const errors = validateSkillDefinition({ ...validSkill, name: 'My Skill!' });
    expect(errors.some(e => e.field === 'name' && e.message.includes('lowercase'))).toBe(true);
  });

  it('allows slug format names', () => {
    const errors = validateSkillDefinition({ ...validSkill, name: 'my-cool-skill-123' });
    expect(errors.filter(e => e.field === 'name')).toEqual([]);
  });

  it('requires matchCriteria', () => {
    const errors = validateSkillDefinition({ ...validSkill, matchCriteria: undefined });
    expect(errors.some(e => e.field === 'matchCriteria')).toBe(true);
  });

  it('rejects matchCriteria shorter than 10 chars', () => {
    const errors = validateSkillDefinition({ ...validSkill, matchCriteria: 'short' });
    expect(errors.some(e => e.field === 'matchCriteria' && e.message.includes('10'))).toBe(true);
  });

  it('rejects matchCriteria longer than 1000 chars', () => {
    const errors = validateSkillDefinition({ ...validSkill, matchCriteria: 'x'.repeat(1001) });
    expect(errors.some(e => e.field === 'matchCriteria' && e.message.includes('1000'))).toBe(true);
  });

  it('rejects invalid actionType', () => {
    const errors = validateSkillDefinition({ ...validSkill, actionType: 'invalid' as never });
    expect(errors.some(e => e.field === 'actionType')).toBe(true);
  });

  it('requires actionType', () => {
    const errors = validateSkillDefinition({ ...validSkill, actionType: undefined });
    expect(errors.some(e => e.field === 'actionType')).toBe(true);
  });

  it('requires actionPrompt', () => {
    const errors = validateSkillDefinition({ ...validSkill, actionPrompt: undefined });
    expect(errors.some(e => e.field === 'actionPrompt')).toBe(true);
  });

  it('rejects actionPrompt shorter than 10 chars', () => {
    const errors = validateSkillDefinition({ ...validSkill, actionPrompt: 'short' });
    expect(errors.some(e => e.field === 'actionPrompt' && e.message.includes('10'))).toBe(true);
  });

  it('rejects actionPrompt longer than 2000 chars', () => {
    const errors = validateSkillDefinition({ ...validSkill, actionPrompt: 'x'.repeat(2001) });
    expect(errors.some(e => e.field === 'actionPrompt' && e.message.includes('2000'))).toBe(true);
  });

  it('requires at least one tool for execute_with_tools actionType', () => {
    const errors = validateSkillDefinition({
      ...validSkill,
      actionType: 'execute_with_tools',
      tools: [],
    });
    expect(errors.some(e => e.field === 'tools' && e.message.includes('At least one'))).toBe(true);
  });

  it('rejects disallowed tools', () => {
    const errors = validateSkillDefinition({
      ...validSkill,
      actionType: 'execute_with_tools',
      tools: ['find_spreadsheet', 'send_email_not_real'],
    });
    expect(errors.some(e => e.field === 'tools' && e.message.includes('send_email_not_real'))).toBe(true);
  });

  it('allows valid tools for execute_with_tools', () => {
    const errors = validateSkillDefinition({
      ...validSkill,
      actionType: 'execute_with_tools',
      tools: ['find_spreadsheet', 'create_spreadsheet', 'append_to_spreadsheet'],
    });
    expect(errors.filter(e => e.field === 'tools')).toEqual([]);
  });

  it('rejects more than 20 extract fields', () => {
    const errors = validateSkillDefinition({
      ...validSkill,
      extractFields: Array.from({ length: 21 }, (_, i) => `field_${i}`),
    });
    expect(errors.some(e => e.field === 'extractFields' && e.message.includes('20'))).toBe(true);
  });

  it('rejects extract field longer than 50 chars', () => {
    const errors = validateSkillDefinition({
      ...validSkill,
      extractFields: ['a'.repeat(51)],
    });
    expect(errors.some(e => e.field === 'extractFields' && e.message.includes('1-50'))).toBe(true);
  });
});

describe('initEmailWatcherState', () => {
  let db: Database.Database;
  let store: EmailSkillStore;

  beforeEach(() => {
    resetEmailSkillStore();
    db = new Database(':memory:');
    store = new EmailSkillStore(db);

    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue(store);
    vi.clearAllMocks();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue(store);
  });

  it('sets emailWatcherEnabled and seeds default skills', async () => {
    const mockSet = vi.fn().mockResolvedValue(undefined);
    (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockSet });

    await initEmailWatcherState('+1234567890');

    expect(mockSet).toHaveBeenCalledWith('+1234567890', { emailWatcherEnabled: true });

    const skills = store.getSkillsForUser('+1234567890');
    expect(skills).toHaveLength(3);
  });
});
