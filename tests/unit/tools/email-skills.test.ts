/**
 * Unit tests for email watcher toggle tool.
 *
 * Email skill CRUD tests have been removed — skills are now managed via filesystem skill packs.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(() => ({
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
  })),
}));

import { toggleEmailWatcher } from '../../../src/domains/email-watcher/runtime/tools.js';
import { getUserConfigStore } from '../../../src/services/user-config/index.js';
import type { ToolContext } from '../../../src/tools/types.js';

describe('email watcher toggle tool', () => {
  const context: ToolContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
  };

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
