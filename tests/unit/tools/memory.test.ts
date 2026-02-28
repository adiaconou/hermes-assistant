/**
 * Boundary validation tests for memory tools.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/domains/memory/runtime/index.js', () => ({
  getMemoryStore: vi.fn(() => ({
    addFact: vi.fn(async (f: Record<string, unknown>) => ({ id: 'fact_1', ...f })),
    getFacts: vi.fn(async () => [
      { id: 'fact_1', fact: 'Likes coffee', category: 'preferences', confidence: 1.0 },
    ]),
    updateFact: vi.fn(async () => {}),
    deleteFact: vi.fn(async () => {}),
  })),
}));

import {
  extractMemory,
  listMemories,
  updateMemory,
  removeMemory,
} from '../../../src/domains/memory/runtime/tools.js';
import type { ToolContext } from '../../../src/tools/types.js';

const baseContext: ToolContext = {
  phoneNumber: '+1234567890',
  channel: 'sms',
};

describe('memory boundary validation', () => {
  describe('extractMemory', () => {
    it('rejects missing fact', async () => {
      const result = await extractMemory.handler({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('fact');
    });

    it('rejects fact as number', async () => {
      const result = await extractMemory.handler({ fact: 42 }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('fact');
    });

    it('rejects empty fact string', async () => {
      const result = await extractMemory.handler({ fact: '' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('fact');
    });

    it('passes with valid fact', async () => {
      const result = await extractMemory.handler({ fact: 'Likes coffee' }, baseContext);
      expect(result.success).toBe(true);
    });
  });

  describe('listMemories', () => {
    it('rejects limit as string', async () => {
      const result = await listMemories.handler({ limit: 'twenty' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('limit');
    });

    it('passes with valid limit', async () => {
      const result = await listMemories.handler({ limit: 10 }, baseContext);
      expect(result.success).toBe(true);
    });

    it('passes without limit', async () => {
      const result = await listMemories.handler({}, baseContext);
      expect(result.success).toBe(true);
    });
  });

  describe('updateMemory', () => {
    it('rejects missing id', async () => {
      const result = await updateMemory.handler({ fact: 'updated fact' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });

    it('rejects missing fact', async () => {
      const result = await updateMemory.handler({ id: 'fact_1' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('fact');
    });

    it('rejects id as number', async () => {
      const result = await updateMemory.handler({ id: 123, fact: 'test' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });
  });

  describe('removeMemory', () => {
    it('rejects missing id', async () => {
      const result = await removeMemory.handler({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });

    it('rejects id as number', async () => {
      const result = await removeMemory.handler({ id: 456 }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });

    it('rejects empty id', async () => {
      const result = await removeMemory.handler({ id: '' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });
  });
});
