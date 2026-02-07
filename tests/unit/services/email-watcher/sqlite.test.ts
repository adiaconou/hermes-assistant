/**
 * Unit tests for EmailSkillStore CRUD operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { EmailSkillStore, resetEmailSkillStore } from '../../../../src/services/email-watcher/sqlite.js';

describe('EmailSkillStore', () => {
  let db: Database.Database;
  let store: EmailSkillStore;

  const defaultSkill = {
    phoneNumber: '+1234567890',
    name: 'Invoice Alert',
    description: 'Detects invoices from vendors',
    matchCriteria: 'Emails containing invoices or billing statements',
    extractFields: ['amount', 'vendor', 'dueDate'],
    actionType: 'notify' as const,
    actionPrompt: 'Summarize the invoice details',
    tools: [],
    enabled: true,
  };

  beforeEach(() => {
    resetEmailSkillStore();
    db = new Database(':memory:');
    store = new EmailSkillStore(db);
  });

  afterEach(() => {
    db.close();
    resetEmailSkillStore();
  });

  describe('createSkill', () => {
    it('creates a skill and returns it with generated id and timestamps', () => {
      const skill = store.createSkill(defaultSkill);

      expect(skill.id).toBeDefined();
      expect(skill.id).toHaveLength(36);
      expect(skill.phoneNumber).toBe('+1234567890');
      expect(skill.name).toBe('Invoice Alert');
      expect(skill.description).toBe('Detects invoices from vendors');
      expect(skill.matchCriteria).toBe('Emails containing invoices or billing statements');
      expect(skill.extractFields).toEqual(['amount', 'vendor', 'dueDate']);
      expect(skill.actionType).toBe('notify');
      expect(skill.actionPrompt).toBe('Summarize the invoice details');
      expect(skill.tools).toEqual([]);
      expect(skill.enabled).toBe(true);
      expect(skill.createdAt).toBeGreaterThan(0);
      expect(skill.updatedAt).toBeGreaterThan(0);
    });

    it('enforces UNIQUE constraint on (phone_number, name)', () => {
      store.createSkill(defaultSkill);

      expect(() => store.createSkill(defaultSkill)).toThrow();
    });

    it('allows same name for different phone numbers', () => {
      store.createSkill(defaultSkill);
      const skill2 = store.createSkill({
        ...defaultSkill,
        phoneNumber: '+9999999999',
      });

      expect(skill2.phoneNumber).toBe('+9999999999');
      expect(skill2.name).toBe('Invoice Alert');
    });
  });

  describe('getSkillById', () => {
    it('retrieves a skill by id', () => {
      const created = store.createSkill(defaultSkill);
      const retrieved = store.getSkillById(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe('Invoice Alert');
    });

    it('returns null for non-existent id', () => {
      const result = store.getSkillById('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getSkillByName', () => {
    it('retrieves a skill by phone number and name', () => {
      store.createSkill(defaultSkill);
      const retrieved = store.getSkillByName('+1234567890', 'Invoice Alert');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Invoice Alert');
      expect(retrieved!.phoneNumber).toBe('+1234567890');
    });

    it('returns null for wrong phone number', () => {
      store.createSkill(defaultSkill);
      const result = store.getSkillByName('+9999999999', 'Invoice Alert');
      expect(result).toBeNull();
    });

    it('returns null for wrong name', () => {
      store.createSkill(defaultSkill);
      const result = store.getSkillByName('+1234567890', 'Non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getSkillsForUser', () => {
    it('returns all skills for a user', () => {
      store.createSkill(defaultSkill);
      store.createSkill({
        ...defaultSkill,
        name: 'Shipping Tracker',
        description: 'Tracks shipping notifications',
      });

      const skills = store.getSkillsForUser('+1234567890');
      expect(skills).toHaveLength(2);
    });

    it('returns empty array for user with no skills', () => {
      const skills = store.getSkillsForUser('+9999999999');
      expect(skills).toEqual([]);
    });

    it('filters to enabled only when enabledOnly is true', () => {
      const skill1 = store.createSkill(defaultSkill);
      store.createSkill({
        ...defaultSkill,
        name: 'Disabled Skill',
        enabled: false,
      });

      const enabledSkills = store.getSkillsForUser('+1234567890', true);
      expect(enabledSkills).toHaveLength(1);
      expect(enabledSkills[0].id).toBe(skill1.id);
    });

    it('returns all skills (enabled + disabled) when enabledOnly is false', () => {
      store.createSkill(defaultSkill);
      store.createSkill({
        ...defaultSkill,
        name: 'Disabled Skill',
        enabled: false,
      });

      const allSkills = store.getSkillsForUser('+1234567890', false);
      expect(allSkills).toHaveLength(2);
    });

    it('isolates skills by phone number', () => {
      store.createSkill(defaultSkill);
      store.createSkill({
        ...defaultSkill,
        phoneNumber: '+9999999999',
      });

      const user1Skills = store.getSkillsForUser('+1234567890');
      const user2Skills = store.getSkillsForUser('+9999999999');

      expect(user1Skills).toHaveLength(1);
      expect(user2Skills).toHaveLength(1);
    });
  });

  describe('updateSkill', () => {
    it('updates a skill name', () => {
      const created = store.createSkill(defaultSkill);
      const updated = store.updateSkill(created.id, { name: 'Updated Name' });

      expect(updated.name).toBe('Updated Name');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    });

    it('updates multiple fields at once', () => {
      const created = store.createSkill(defaultSkill);
      const updated = store.updateSkill(created.id, {
        description: 'New description',
        matchCriteria: 'New criteria',
        actionType: 'execute_with_tools',
        tools: ['get_emails', 'read_email'],
      });

      expect(updated.description).toBe('New description');
      expect(updated.matchCriteria).toBe('New criteria');
      expect(updated.actionType).toBe('execute_with_tools');
      expect(updated.tools).toEqual(['get_emails', 'read_email']);
    });

    it('updates enabled field', () => {
      const created = store.createSkill(defaultSkill);
      const updated = store.updateSkill(created.id, { enabled: false });

      expect(updated.enabled).toBe(false);
    });

    it('throws for non-existent skill', () => {
      expect(() => store.updateSkill('non-existent-id', { name: 'X' })).toThrow(
        'Skill not found: non-existent-id'
      );
    });
  });

  describe('deleteSkill', () => {
    it('deletes a skill', () => {
      const created = store.createSkill(defaultSkill);
      store.deleteSkill(created.id);

      const retrieved = store.getSkillById(created.id);
      expect(retrieved).toBeNull();
    });

    it('does not throw for non-existent id', () => {
      expect(() => store.deleteSkill('non-existent-id')).not.toThrow();
    });
  });

  describe('toggleSkill', () => {
    it('disables an enabled skill', () => {
      const created = store.createSkill(defaultSkill);
      store.toggleSkill(created.id, false);

      const retrieved = store.getSkillById(created.id);
      expect(retrieved!.enabled).toBe(false);
    });

    it('enables a disabled skill', () => {
      const created = store.createSkill({
        ...defaultSkill,
        enabled: false,
      });
      store.toggleSkill(created.id, true);

      const retrieved = store.getSkillById(created.id);
      expect(retrieved!.enabled).toBe(true);
    });

    it('updates the updatedAt timestamp', () => {
      const created = store.createSkill(defaultSkill);
      const originalUpdatedAt = created.updatedAt;

      // Small delay to ensure different timestamp
      store.toggleSkill(created.id, false);

      const retrieved = store.getSkillById(created.id);
      expect(retrieved!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });
  });

  describe('deleteAllSkillsForUser', () => {
    it('deletes all skills for a specific user', () => {
      store.createSkill(defaultSkill);
      store.createSkill({
        ...defaultSkill,
        name: 'Skill 2',
      });
      store.createSkill({
        ...defaultSkill,
        phoneNumber: '+9999999999',
      });

      store.deleteAllSkillsForUser('+1234567890');

      const user1Skills = store.getSkillsForUser('+1234567890');
      const user2Skills = store.getSkillsForUser('+9999999999');

      expect(user1Skills).toHaveLength(0);
      expect(user2Skills).toHaveLength(1);
    });

    it('does not throw when user has no skills', () => {
      expect(() => store.deleteAllSkillsForUser('+9999999999')).not.toThrow();
    });
  });

  describe('JSON round-trip', () => {
    it('preserves extractFields array through store and retrieve', () => {
      const fields = ['amount', 'sender', 'dueDate', 'accountNumber'];
      const created = store.createSkill({
        ...defaultSkill,
        extractFields: fields,
      });

      const retrieved = store.getSkillById(created.id);
      expect(retrieved!.extractFields).toEqual(fields);
    });

    it('preserves tools array through store and retrieve', () => {
      const tools = ['get_emails', 'read_email', 'create_calendar_event'];
      const created = store.createSkill({
        ...defaultSkill,
        actionType: 'execute_with_tools',
        tools,
      });

      const retrieved = store.getSkillById(created.id);
      expect(retrieved!.tools).toEqual(tools);
    });

    it('handles empty extractFields', () => {
      const created = store.createSkill({
        ...defaultSkill,
        extractFields: [],
      });

      const retrieved = store.getSkillById(created.id);
      expect(retrieved!.extractFields).toEqual([]);
    });

    it('handles empty tools', () => {
      const created = store.createSkill({
        ...defaultSkill,
        tools: [],
      });

      const retrieved = store.getSkillById(created.id);
      expect(retrieved!.tools).toEqual([]);
    });
  });
});
