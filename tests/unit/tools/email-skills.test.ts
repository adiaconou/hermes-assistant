/**
 * Unit tests for email skill management tools.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EmailSkillStore, resetEmailSkillStore } from '../../../src/domains/email-watcher/repo/sqlite.js';

// Mock the singleton getter
vi.mock('../../../src/domains/email-watcher/repo/sqlite.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    getEmailSkillStore: vi.fn(),
  };
});

vi.mock('../../../src/domains/email-watcher/service/skills.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
  };
});

vi.mock('../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(() => ({
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../../../src/domains/email-watcher/providers/gmail-sync.js', () => ({
  syncNewEmails: vi.fn().mockResolvedValue([]),
  prepareEmailForClassification: vi.fn(),
}));

vi.mock('../../../src/domains/email-watcher/service/classifier.js', () => ({
  classifyEmails: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/domains/email/providers/gmail.js', () => ({
  listEmails: vi.fn().mockResolvedValue([]),
  getEmail: vi.fn(),
}));

vi.mock('../../../src/domains/google-core/providers/auth.js', () => ({
  getAuthenticatedClient: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: { get: vi.fn() },
      },
    })),
  },
}));

import {
  createEmailSkill,
  listEmailSkills,
  updateEmailSkill,
  deleteEmailSkill,
  toggleEmailWatcher,
  testEmailSkill,
} from '../../../src/domains/email-watcher/runtime/tools.js';
import { getEmailSkillStore } from '../../../src/domains/email-watcher/repo/sqlite.js';
import { getUserConfigStore } from '../../../src/services/user-config/index.js';
import type { ToolContext } from '../../../src/tools/types.js';

describe('email skill tools', () => {
  let db: Database.Database;
  let store: EmailSkillStore;

  const context: ToolContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
  };

  beforeEach(() => {
    resetEmailSkillStore();
    db = new Database(':memory:');
    store = new EmailSkillStore(db);
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue(store);
    vi.clearAllMocks();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue(store);
  });

  describe('create_email_skill', () => {
    it('creates a valid skill', async () => {
      const result = await createEmailSkill.handler({
        name: 'test-skill',
        description: 'A test skill',
        match_criteria: 'Emails matching a very specific test pattern',
        extract_fields: ['field1', 'field2'],
        action_type: 'notify',
        action_prompt: 'Summarize the email contents briefly',
      }, context);

      expect(result.success).toBe(true);
      expect((result as { skill: { name: string } }).skill.name).toBe('test-skill');

      const skills = store.getSkillsForUser('+1234567890');
      expect(skills).toHaveLength(1);
    });

    it('returns validation errors for invalid input', async () => {
      const result = await createEmailSkill.handler({
        name: 'INVALID NAME!',
        description: 'A test skill',
        match_criteria: 'short',
        extract_fields: [],
        action_type: 'notify',
        action_prompt: 'short',
      }, context);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect((result.errors as string[]).length).toBeGreaterThan(0);
    });

    it('rejects duplicate skill name', async () => {
      // Create first skill
      await createEmailSkill.handler({
        name: 'my-skill',
        description: 'First skill',
        match_criteria: 'Emails matching a specific pattern here',
        extract_fields: ['f1'],
        action_type: 'notify',
        action_prompt: 'Summarize the email briefly here',
      }, context);

      // Try to create duplicate
      const result = await createEmailSkill.handler({
        name: 'my-skill',
        description: 'Duplicate',
        match_criteria: 'Emails matching a different pattern here',
        extract_fields: ['f1'],
        action_type: 'notify',
        action_prompt: 'Summarize the email briefly here',
      }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('validates tools for execute_with_tools action type', async () => {
      const result = await createEmailSkill.handler({
        name: 'tool-skill',
        description: 'A tool-based skill',
        match_criteria: 'Emails matching a specific tool pattern',
        extract_fields: ['f1'],
        action_type: 'execute_with_tools',
        action_prompt: 'Execute with the available tools here',
        tools: [],
      }, context);

      expect(result.success).toBe(false);
      expect((result.errors as string[]).some((e: string) => e.includes('tool'))).toBe(true);
    });
  });

  describe('list_email_skills', () => {
    it('returns all skills for user', async () => {
      store.createSkill({
        phoneNumber: '+1234567890',
        name: 'skill-a',
        description: 'Skill A',
        matchCriteria: 'Match A criteria that is long enough',
        extractFields: [],
        actionType: 'notify',
        actionPrompt: 'Prompt for skill A that is long enough',
        tools: [],
        enabled: true,
      });
      store.createSkill({
        phoneNumber: '+1234567890',
        name: 'skill-b',
        description: 'Skill B',
        matchCriteria: 'Match B criteria that is long enough',
        extractFields: [],
        actionType: 'notify',
        actionPrompt: 'Prompt for skill B that is long enough',
        tools: [],
        enabled: false,
      });

      const result = await listEmailSkills.handler({}, context);

      expect(result.success).toBe(true);
      expect((result.skills as unknown[]).length).toBe(2);
    });

    it('returns empty array with message when no skills exist', async () => {
      const result = await listEmailSkills.handler({}, context);

      expect(result.success).toBe(true);
      expect((result.skills as unknown[]).length).toBe(0);
      expect(result.message).toContain('No email skills');
    });
  });

  describe('update_email_skill', () => {
    it('updates an existing skill', async () => {
      store.createSkill({
        phoneNumber: '+1234567890',
        name: 'my-skill',
        description: 'Original description',
        matchCriteria: 'Original criteria that is long enough',
        extractFields: ['f1'],
        actionType: 'notify',
        actionPrompt: 'Original prompt that is long enough',
        tools: [],
        enabled: true,
      });

      const result = await updateEmailSkill.handler({
        name: 'my-skill',
        description: 'Updated description',
      }, context);

      expect(result.success).toBe(true);
      expect((result.skill as { description: string }).description).toBe('Updated description');
    });

    it('returns error for non-existent skill', async () => {
      const result = await updateEmailSkill.handler({
        name: 'non-existent',
      }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('delete_email_skill', () => {
    it('deletes an existing skill', async () => {
      store.createSkill({
        phoneNumber: '+1234567890',
        name: 'to-delete',
        description: 'Will be deleted',
        matchCriteria: 'Criteria that is long enough for tests',
        extractFields: [],
        actionType: 'notify',
        actionPrompt: 'Prompt that is long enough for tests',
        tools: [],
        enabled: true,
      });

      const result = await deleteEmailSkill.handler({ name: 'to-delete' }, context);

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');

      const skills = store.getSkillsForUser('+1234567890');
      expect(skills).toHaveLength(0);
    });

    it('returns error for non-existent skill', async () => {
      const result = await deleteEmailSkill.handler({ name: 'non-existent' }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('toggle_email_watcher', () => {
    it('enables email watcher', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockSet });

      const result = await toggleEmailWatcher.handler({ enabled: true }, context);

      expect(result.success).toBe(true);
      expect(result.email_watcher_enabled).toBe(true);
      expect(mockSet).toHaveBeenCalledWith('+1234567890', { emailWatcherEnabled: true });
    });

    it('disables email watcher', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockSet });

      const result = await toggleEmailWatcher.handler({ enabled: false }, context);

      expect(result.success).toBe(true);
      expect(result.email_watcher_enabled).toBe(false);
      expect(mockSet).toHaveBeenCalledWith('+1234567890', { emailWatcherEnabled: false });
    });
  });

  describe('test_email_skill', () => {
    it('returns empty results when no recent emails found', async () => {
      const result = await testEmailSkill.handler({}, context);

      expect(result.success).toBe(true);
      expect(result.message).toContain('No recent emails');
    });

    it('returns error for non-existent skill name', async () => {
      const result = await testEmailSkill.handler({ skill_name: 'non-existent' }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
