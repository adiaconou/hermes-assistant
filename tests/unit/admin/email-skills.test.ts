/**
 * Unit tests for admin email skills API endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EmailSkillStore, resetEmailSkillStore } from '../../../src/domains/email-watcher/repo/sqlite.js';
import {
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  toggleSkill,
  watcherStatus,
  toggleWatcher,
} from '../../../src/admin/email-skills.js';
import { createMockReqRes } from '../../helpers/mock-http.js';

// Mock the store singleton to use our in-memory store
vi.mock('../../../src/domains/email-watcher/repo/sqlite.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    getEmailSkillStore: vi.fn(),
  };
});

vi.mock('../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(),
}));

vi.mock('../../../src/config.js', () => ({
  default: {
    credentials: { sqlitePath: ':memory:' },
  },
}));

import { getEmailSkillStore } from '../../../src/domains/email-watcher/repo/sqlite.js';
import { getUserConfigStore } from '../../../src/services/user-config/index.js';

describe('Admin Email Skills API', () => {
  let db: Database.Database;
  let store: EmailSkillStore;

  const seedSkill = (overrides: Record<string, unknown> = {}) =>
    store.createSkill({
      phoneNumber: '+1234567890',
      name: 'test-skill',
      description: 'A test skill',
      matchCriteria: 'Emails containing test patterns',
      extractFields: ['field1'],
      actionType: 'notify' as const,
      actionPrompt: 'Summarize the matched email',
      tools: [],
      enabled: true,
      ...overrides,
    });

  beforeEach(() => {
    resetEmailSkillStore();
    db = new Database(':memory:');
    store = new EmailSkillStore(db);
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue(store);
    vi.clearAllMocks();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue(store);
  });

  afterEach(() => {
    db.close();
    resetEmailSkillStore();
  });

  describe('GET /admin/api/email-skills', () => {
    it('returns skills filtered by phone number', async () => {
      seedSkill({ name: 'skill-a' });
      seedSkill({ name: 'skill-b' });
      seedSkill({ name: 'skill-c', phoneNumber: '+9999999999' });

      const { req, res } = createMockReqRes({
        query: { phone: '+1234567890' },
      });

      await listSkills(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { skills: unknown[] };
      expect(body.skills).toHaveLength(2);
    });

    it('returns all skills across users when no phone filter', async () => {
      seedSkill({ name: 'skill-a' });
      seedSkill({ name: 'skill-b', phoneNumber: '+9999999999' });

      const mockGetUsers = vi.fn().mockResolvedValue([
        { phoneNumber: '+1234567890' },
        { phoneNumber: '+9999999999' },
      ]);
      (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({
        getEmailWatcherUsers: mockGetUsers,
      });

      const { req, res } = createMockReqRes({});

      await listSkills(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { skills: unknown[] };
      expect(body.skills).toHaveLength(2);
    });

    it('returns empty array when no skills exist', async () => {
      const { req, res } = createMockReqRes({
        query: { phone: '+1234567890' },
      });

      await listSkills(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { skills: unknown[] };
      expect(body.skills).toHaveLength(0);
    });
  });

  describe('POST /admin/api/email-skills', () => {
    it('creates a new skill and returns 201', async () => {
      const { req, res } = createMockReqRes({
        body: {
          phoneNumber: '+1234567890',
          name: 'new-skill',
          description: 'New skill description',
          matchCriteria: 'Match new emails',
          extractFields: ['f1', 'f2'],
          actionType: 'notify',
          actionPrompt: 'Notify about new email',
          tools: [],
        },
      });

      await createSkill(req, res);

      expect(res.statusCode).toBe(201);
      const body = res.body as { skill: { name: string; id: string } };
      expect(body.skill.name).toBe('new-skill');
      expect(body.skill.id).toBeDefined();
    });

    it('returns 400 for missing required fields', async () => {
      const { req, res } = createMockReqRes({
        body: { phoneNumber: '+1234567890', name: 'missing-stuff' },
      });

      await createSkill(req, res);

      expect(res.statusCode).toBe(400);
      const body = res.body as { error: string };
      expect(body.error).toContain('Missing required fields');
    });

    it('returns 400 for invalid actionType', async () => {
      const { req, res } = createMockReqRes({
        body: {
          phoneNumber: '+1234567890',
          name: 'bad-type',
          matchCriteria: 'Match stuff',
          actionType: 'invalid_type',
          actionPrompt: 'Do something',
        },
      });

      await createSkill(req, res);

      expect(res.statusCode).toBe(400);
      const body = res.body as { error: string };
      expect(body.error).toContain('actionType');
    });

    it('returns 500 with duplicate message for UNIQUE constraint violation', async () => {
      seedSkill({ name: 'dup-skill' });

      const { req, res } = createMockReqRes({
        body: {
          phoneNumber: '+1234567890',
          name: 'dup-skill',
          matchCriteria: 'Match duplicate',
          actionType: 'notify',
          actionPrompt: 'Duplicate prompt here',
        },
      });

      await createSkill(req, res);

      expect(res.statusCode).toBe(500);
      const body = res.body as { error: string };
      expect(body.error).toContain('already exists');
    });
  });

  describe('PUT /admin/api/email-skills/:id', () => {
    it('updates an existing skill', async () => {
      const skill = seedSkill();

      const { req, res } = createMockReqRes({
        params: { id: skill.id },
        body: { description: 'Updated description' },
      });

      await updateSkill(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { skill: { description: string } };
      expect(body.skill.description).toBe('Updated description');
    });

    it('returns 404 for non-existent skill', async () => {
      const { req, res } = createMockReqRes({
        params: { id: 'non-existent-id' },
        body: { description: 'Update attempt' },
      });

      await updateSkill(req, res);

      expect(res.statusCode).toBe(404);
      const body = res.body as { error: string };
      expect(body.error).toBe('Skill not found');
    });
  });

  describe('DELETE /admin/api/email-skills/:id', () => {
    it('deletes an existing skill and returns 204', async () => {
      const skill = seedSkill();

      const { req, res } = createMockReqRes({
        params: { id: skill.id },
      });

      await deleteSkill(req, res);

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const retrieved = store.getSkillById(skill.id);
      expect(retrieved).toBeNull();
    });

    it('returns 404 for non-existent skill', async () => {
      const { req, res } = createMockReqRes({
        params: { id: 'non-existent-id' },
      });

      await deleteSkill(req, res);

      expect(res.statusCode).toBe(404);
      const body = res.body as { error: string };
      expect(body.error).toBe('Skill not found');
    });
  });

  describe('PATCH /admin/api/email-skills/:id/toggle', () => {
    it('toggles a skill to disabled', async () => {
      const skill = seedSkill();

      const { req, res } = createMockReqRes({
        params: { id: skill.id },
        body: { enabled: false },
      });

      await toggleSkill(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { skill: { enabled: boolean } };
      expect(body.skill.enabled).toBe(false);

      // Verify in store
      const retrieved = store.getSkillById(skill.id);
      expect(retrieved!.enabled).toBe(false);
    });

    it('toggles a skill to enabled', async () => {
      const skill = seedSkill({ enabled: false });

      const { req, res } = createMockReqRes({
        params: { id: skill.id },
        body: { enabled: true },
      });

      await toggleSkill(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { skill: { enabled: boolean } };
      expect(body.skill.enabled).toBe(true);
    });

    it('returns 400 when enabled is not a boolean', async () => {
      const skill = seedSkill();

      const { req, res } = createMockReqRes({
        params: { id: skill.id },
        body: { enabled: 'yes' },
      });

      await toggleSkill(req, res);

      expect(res.statusCode).toBe(400);
      const body = res.body as { error: string };
      expect(body.error).toContain('boolean');
    });

    it('returns 404 for non-existent skill', async () => {
      const { req, res } = createMockReqRes({
        params: { id: 'non-existent-id' },
        body: { enabled: true },
      });

      await toggleSkill(req, res);

      expect(res.statusCode).toBe(404);
      const body = res.body as { error: string };
      expect(body.error).toBe('Skill not found');
    });
  });

  describe('GET /admin/api/email-watcher/status', () => {
    it('returns per-user watcher status', async () => {
      (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({
        getEmailWatcherUsers: vi.fn().mockResolvedValue([
          {
            phoneNumber: '+1234567890',
            name: 'Test User',
            emailWatcherEnabled: true,
            emailWatcherHistoryId: '12345',
          },
          {
            phoneNumber: '+9999999999',
            name: 'Other User',
            emailWatcherEnabled: false,
            emailWatcherHistoryId: null,
          },
        ]),
      });

      const { req, res } = createMockReqRes({});

      await watcherStatus(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { users: Array<{ phoneNumber: string; enabled: boolean; historyId: string | null }> };
      expect(body.users).toHaveLength(2);
      expect(body.users[0].phoneNumber).toBe('+1234567890');
      expect(body.users[0].enabled).toBe(true);
      expect(body.users[0].historyId).toBe('12345');
      expect(body.users[1].enabled).toBe(false);
      expect(body.users[1].historyId).toBeNull();
    });

    it('returns empty array when no users configured', async () => {
      (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({
        getEmailWatcherUsers: vi.fn().mockResolvedValue([]),
      });

      const { req, res } = createMockReqRes({});

      await watcherStatus(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { users: unknown[] };
      expect(body.users).toHaveLength(0);
    });
  });

  describe('POST /admin/api/email-watcher/toggle', () => {
    it('enables watcher for a user', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockSet });

      const { req, res } = createMockReqRes({
        body: { phoneNumber: '+1234567890', enabled: true },
      });

      await toggleWatcher(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { phoneNumber: string; enabled: boolean };
      expect(body.phoneNumber).toBe('+1234567890');
      expect(body.enabled).toBe(true);
      expect(mockSet).toHaveBeenCalledWith('+1234567890', { emailWatcherEnabled: true });
    });

    it('disables watcher for a user', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockSet });

      const { req, res } = createMockReqRes({
        body: { phoneNumber: '+1234567890', enabled: false },
      });

      await toggleWatcher(req, res);

      expect(res.statusCode).toBe(200);
      const body = res.body as { enabled: boolean };
      expect(body.enabled).toBe(false);
    });

    it('returns 400 when phoneNumber is missing', async () => {
      const { req, res } = createMockReqRes({
        body: { enabled: true },
      });

      await toggleWatcher(req, res);

      expect(res.statusCode).toBe(400);
      const body = res.body as { error: string };
      expect(body.error).toContain('phoneNumber');
    });

    it('returns 400 when enabled is not a boolean', async () => {
      const { req, res } = createMockReqRes({
        body: { phoneNumber: '+1234567890', enabled: 'yes' },
      });

      await toggleWatcher(req, res);

      expect(res.statusCode).toBe(400);
      const body = res.body as { error: string };
      expect(body.error).toContain('boolean');
    });
  });
});
