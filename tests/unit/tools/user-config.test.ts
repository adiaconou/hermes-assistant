/**
 * Boundary validation tests for user config tools.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConfigSet,
  mockConfigDelete,
  mockGetFacts,
  mockDeleteFact,
  mockConversationDeleteAll,
} = vi.hoisted(() => ({
  mockConfigSet: vi.fn(),
  mockConfigDelete: vi.fn(),
  mockGetFacts: vi.fn(),
  mockDeleteFact: vi.fn(),
  mockConversationDeleteAll: vi.fn(),
}));

vi.mock('../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(() => ({
    set: mockConfigSet,
    delete: mockConfigDelete,
  })),
}));

vi.mock('../../../src/domains/memory/runtime/index.js', () => ({
  getMemoryStore: vi.fn(() => ({
    getFacts: mockGetFacts,
    deleteFact: mockDeleteFact,
  })),
}));

vi.mock('../../../src/services/conversation/index.js', () => ({
  getConversationStore: vi.fn(() => ({
    deleteAll: mockConversationDeleteAll,
  })),
}));

import { setUserConfig, deleteUserData } from '../../../src/tools/user-config.js';
import type { ToolContext } from '../../../src/tools/types.js';

describe('user-config tools boundary validation', () => {
  const context: ToolContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigSet.mockResolvedValue({ name: 'Alex', timezone: 'America/New_York' });
    mockConfigDelete.mockResolvedValue(undefined);
    mockGetFacts.mockResolvedValue([]);
    mockDeleteFact.mockResolvedValue(undefined);
    mockConversationDeleteAll.mockResolvedValue(undefined);
  });

  describe('setUserConfig', () => {
    it('rejects non-string name', async () => {
      const result = await setUserConfig.handler({ name: 42 }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('rejects non-string timezone', async () => {
      const result = await setUserConfig.handler({ timezone: 123 }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timezone');
    });

    it('rejects invalid timezone value', async () => {
      const result = await setUserConfig.handler({ timezone: 'Mars/Olympus' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid timezone');
    });
  });

  describe('deleteUserData', () => {
    it('rejects missing confirm field', async () => {
      const result = await deleteUserData.handler({}, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('confirm');
    });

    it('rejects string confirm value', async () => {
      const result = await deleteUserData.handler({ confirm: 'false' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('confirm');
      expect(mockConfigDelete).not.toHaveBeenCalled();
    });

    it('does not delete when confirm is false', async () => {
      const result = await deleteUserData.handler({ confirm: false }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Confirmation required');
      expect(mockConfigDelete).not.toHaveBeenCalled();
    });

    it('deletes data when confirm is true', async () => {
      mockGetFacts.mockResolvedValue([{ id: 'fact_1' }, { id: 'fact_2' }]);
      const result = await deleteUserData.handler({ confirm: true }, context);
      expect(result.success).toBe(true);
      expect(mockConfigDelete).toHaveBeenCalledWith('+1234567890');
      expect(mockDeleteFact).toHaveBeenCalledTimes(2);
      expect(mockConversationDeleteAll).toHaveBeenCalledWith('+1234567890');
    });
  });
});
