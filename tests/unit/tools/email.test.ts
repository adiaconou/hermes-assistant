/**
 * Boundary validation tests for email tools.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/domains/email/providers/gmail.js', () => ({
  listEmails: vi.fn(async () => []),
  getEmail: vi.fn(async () => ({ id: 'msg_1', subject: 'Test' })),
  getThread: vi.fn(async () => ({
    id: 'thread_1',
    messages: [{ id: 'msg_1', subject: 'Test' }],
  })),
}));

vi.mock('../../../src/providers/auth.js', () => ({
  AuthRequiredError: class extends Error {},
  generateAuthUrl: vi.fn(() => 'https://example.com/auth'),
}));

import { getEmails, readEmail, getEmailThread } from '../../../src/domains/email/runtime/tools.js';
import type { ToolContext } from '../../../src/tools/types.js';

const baseContext: ToolContext = {
  phoneNumber: '+1234567890',
  channel: 'sms',
};

describe('email boundary validation', () => {
  describe('getEmails', () => {
    it('rejects max_results as string', async () => {
      const result = await getEmails.handler(
        { max_results: 'ten' },
        baseContext
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('max_results');
    });

    it('rejects include_spam as string', async () => {
      const result = await getEmails.handler(
        { include_spam: 'yes' },
        baseContext
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('include_spam');
    });

    it('rejects query as number', async () => {
      const result = await getEmails.handler(
        { query: 123 },
        baseContext
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('query');
    });

    it('passes with valid optional fields', async () => {
      const result = await getEmails.handler(
        { query: 'from:test@example.com', max_results: 5, include_spam: false },
        baseContext
      );
      expect(result.success).toBe(true);
    });
  });

  describe('readEmail', () => {
    it('rejects missing id', async () => {
      const result = await readEmail.handler({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });

    it('rejects empty id', async () => {
      const result = await readEmail.handler({ id: '' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });

    it('rejects id as number', async () => {
      const result = await readEmail.handler({ id: 123 }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    });
  });

  describe('getEmailThread', () => {
    it('rejects missing thread_id', async () => {
      const result = await getEmailThread.handler({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('thread_id');
    });

    it('rejects empty thread_id', async () => {
      const result = await getEmailThread.handler({ thread_id: '' }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('thread_id');
    });

    it('rejects thread_id as number', async () => {
      const result = await getEmailThread.handler({ thread_id: 456 }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('thread_id');
    });
  });
});
