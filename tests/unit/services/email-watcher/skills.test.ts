/**
 * Unit tests for email watcher state helpers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(() => ({
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  initEmailWatcherState,
} from '../../../../src/domains/email-watcher/service/skills.js';
import { getUserConfigStore } from '../../../../src/services/user-config/index.js';

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
