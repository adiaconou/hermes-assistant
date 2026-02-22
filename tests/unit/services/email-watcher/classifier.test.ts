/**
 * Unit tests for email watcher classifier.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setMockResponses,
  createTextResponse,
  clearMockState,
  getCreateCalls,
  mockCreate,
} from '../../../mocks/anthropic.js';

// Mock the Anthropic client singleton to return our mock
vi.mock('../../../../src/services/anthropic/client.js', () => ({
  getClient: vi.fn(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

// Mock dependencies
vi.mock('../../../../src/domains/email-watcher/repo/sqlite.js', () => ({
  getEmailSkillStore: vi.fn(),
}));

vi.mock('../../../../src/domains/memory/runtime/index.js', () => ({
  getMemoryStore: vi.fn(() => ({
    getFacts: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../../../src/config.js', () => ({
  default: {
    emailWatcher: {
      modelId: 'claude-haiku-4-5-20251001',
      batchSize: 20,
      confidenceThreshold: 0.6,
      maxNotificationsPerHour: 10,
    },
  },
}));

import { classifyEmails } from '../../../../src/domains/email-watcher/service/classifier.js';
import { getEmailSkillStore } from '../../../../src/domains/email-watcher/repo/sqlite.js';
import type { IncomingEmail, EmailSkill } from '../../../../src/domains/email-watcher/types.js';

function makeEmail(overrides: Partial<IncomingEmail> = {}): IncomingEmail {
  return {
    messageId: 'msg_1',
    from: 'sender@example.com',
    subject: 'Test Email',
    date: 'Mon, 20 Jan 2025 10:00:00 -0800',
    body: 'This is a test email body.',
    attachments: [],
    ...overrides,
  };
}

function makeSkill(overrides: Partial<EmailSkill> = {}): EmailSkill {
  return {
    id: 'skill_1',
    phoneNumber: '+1234567890',
    name: 'invoice-tracker',
    description: 'Track invoices',
    matchCriteria: 'Emails containing invoices',
    extractFields: ['amount', 'vendor'],
    actionType: 'notify',
    actionPrompt: 'Summarize the invoice',
    tools: [],
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('classifyEmails', () => {
  beforeEach(() => {
    clearMockState();
    vi.clearAllMocks();
  });

  it('returns empty array when user has no active skills', async () => {
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([]),
    });

    const result = await classifyEmails('+1234567890', [makeEmail()]);

    expect(result).toEqual([]);
    // No LLM call should have been made
    expect(getCreateCalls()).toHaveLength(0);
  });

  it('classifies a single email with a single matching skill', async () => {
    const skill = makeSkill();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    const llmResponse = JSON.stringify([{
      email_index: 1,
      matches: [{
        skill: 'invoice-tracker',
        confidence: 0.95,
        extracted: { amount: '$100', vendor: 'Acme Corp' },
        summary: 'Invoice from Acme Corp for $100',
      }],
    }]);
    setMockResponses([createTextResponse(llmResponse)]);

    const result = await classifyEmails('+1234567890', [makeEmail()]);

    expect(result).toHaveLength(1);
    expect(result[0].matches).toHaveLength(1);
    expect(result[0].matches[0].skill).toBe('invoice-tracker');
    expect(result[0].matches[0].confidence).toBe(0.95);
    expect(result[0].matches[0].extracted).toEqual({ amount: '$100', vendor: 'Acme Corp' });
    expect(result[0].matches[0].summary).toBe('Invoice from Acme Corp for $100');
  });

  it('classifies a single email with multiple matching skills', async () => {
    const skills = [
      makeSkill({ name: 'invoice-tracker' }),
      makeSkill({ id: 'skill_2', name: 'expense-tracker' }),
    ];
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue(skills),
    });

    const llmResponse = JSON.stringify([{
      email_index: 1,
      matches: [
        { skill: 'invoice-tracker', confidence: 0.9, extracted: { amount: '$50' }, summary: 'Invoice' },
        { skill: 'expense-tracker', confidence: 0.85, extracted: { amount: '$50', category: 'Office' }, summary: 'Expense' },
      ],
    }]);
    setMockResponses([createTextResponse(llmResponse)]);

    const result = await classifyEmails('+1234567890', [makeEmail()]);

    expect(result).toHaveLength(1);
    expect(result[0].matches).toHaveLength(2);
    expect(result[0].matches[0].skill).toBe('invoice-tracker');
    expect(result[0].matches[1].skill).toBe('expense-tracker');
  });

  it('filters matches below confidence threshold', async () => {
    const skill = makeSkill();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    const llmResponse = JSON.stringify([{
      email_index: 1,
      matches: [
        { skill: 'invoice-tracker', confidence: 0.3, extracted: {}, summary: 'Low confidence' },
      ],
    }]);
    setMockResponses([createTextResponse(llmResponse)]);

    const result = await classifyEmails('+1234567890', [makeEmail()]);

    // The match should be filtered out since 0.3 < 0.6 threshold
    expect(result).toHaveLength(1);
    expect(result[0].matches).toHaveLength(0);
  });

  it('retries on JSON parse failure then falls back to null', async () => {
    const skill = makeSkill();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    // Both attempts return invalid JSON
    setMockResponses([
      createTextResponse('not valid json'),
      createTextResponse('still not valid'),
    ]);

    const result = await classifyEmails('+1234567890', [makeEmail()]);

    // Should return empty since batch failed
    expect(result).toEqual([]);
    // Two LLM calls (attempt + retry)
    expect(getCreateCalls()).toHaveLength(2);
  });

  it('handles response wrapped in markdown code block', async () => {
    const skill = makeSkill();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    const jsonContent = JSON.stringify([{
      email_index: 1,
      matches: [
        { skill: 'invoice-tracker', confidence: 0.8, extracted: {}, summary: 'Test' },
      ],
    }]);
    const wrappedResponse = '```json\n' + jsonContent + '\n```';
    setMockResponses([createTextResponse(wrappedResponse)]);

    const result = await classifyEmails('+1234567890', [makeEmail()]);

    expect(result).toHaveLength(1);
    expect(result[0].matches).toHaveLength(1);
  });

  it('uses correct model from config', async () => {
    const skill = makeSkill();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    const llmResponse = JSON.stringify([{
      email_index: 1,
      matches: [],
    }]);
    setMockResponses([createTextResponse(llmResponse)]);

    await classifyEmails('+1234567890', [makeEmail()]);

    const calls = getCreateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('claude-haiku-4-5-20251001');
  });
});
