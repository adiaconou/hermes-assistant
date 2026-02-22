/**
 * Unit tests for admin email watcher API endpoints.
 *
 * Email skill CRUD tests have been removed — skills are now managed via filesystem skill packs.
 */

import { describe, it, expect, vi } from 'vitest';
import { watcherStatus, toggleWatcher } from '../../../src/admin/email-skills.js';
import { createMockReqRes } from '../../helpers/mock-http.js';

vi.mock('../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(),
}));

import { getUserConfigStore } from '../../../src/services/user-config/index.js';

describe('Admin Email Watcher API', () => {
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
