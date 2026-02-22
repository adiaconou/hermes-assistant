/**
 * Unit tests for email watcher filesystem-skill action execution and throttling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../src/domains/email-watcher/providers/skills.js', () => ({
  executeFilesystemSkillByName: vi.fn(),
}));

vi.mock('../../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../../../../src/domains/email-watcher/providers/memory.js', () => ({
  getMemoryStore: vi.fn(() => ({
    getFacts: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../../../src/twilio.js', () => ({
  sendSms: vi.fn().mockResolvedValue('SM123'),
}));

vi.mock('../../../../src/config.js', () => ({
  default: {
    emailWatcher: {
      maxNotificationsPerHour: 3,
      confidenceThreshold: 0.6,
      batchSize: 20,
    },
  },
}));

import { executeSkillActions } from '../../../../src/domains/email-watcher/service/actions.js';
import { executeFilesystemSkillByName } from '../../../../src/domains/email-watcher/providers/skills.js';
import { sendSms } from '../../../../src/twilio.js';
import type { ClassificationResult } from '../../../../src/domains/email-watcher/types.js';

function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    emailIndex: 1,
    email: {
      messageId: 'msg_1',
      from: 'sender@example.com',
      subject: 'Invoice #123',
      date: 'Mon, 20 Jan 2025 10:00:00 -0800',
      body: 'Please find attached invoice.',
      attachments: [],
    },
    matches: [
      {
        skill: 'invoice-tracker',
        confidence: 0.95,
        extracted: {},
        summary: 'Matched hints: invoice',
      },
    ],
    ...overrides,
  };
}

describe('executeSkillActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('executes matched filesystem skill and sends merged notification', async () => {
    vi.mocked(executeFilesystemSkillByName).mockResolvedValue({
      success: true,
      output: 'Logged invoice to tracking sheet.',
      error: undefined,
    });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );
    await freshExecute('+1234567890', [makeClassification()]);

    expect(executeFilesystemSkillByName).toHaveBeenCalledTimes(1);
    const call = vi.mocked(executeFilesystemSkillByName).mock.calls[0];
    expect(call[0]).toBe('invoice-tracker');
    expect(call[3]).toBe('email');

    expect(sendSms).toHaveBeenCalledTimes(1);
    const smsBody = vi.mocked(sendSms).mock.calls[0][1] as string;
    expect(smsBody).toContain('Invoice #123');
    expect(smsBody).toContain('Logged invoice to tracking sheet.');
  });

  it('falls back to match summary when skill execution fails', async () => {
    vi.mocked(executeFilesystemSkillByName).mockResolvedValue({
      success: false,
      output: null,
      error: 'Tool execution failed',
    });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );
    await freshExecute('+1234567890', [makeClassification()]);

    expect(sendSms).toHaveBeenCalledTimes(1);
    const smsBody = vi.mocked(sendSms).mock.calls[0][1] as string;
    expect(smsBody).toContain('Matched hints: invoice');
  });

  it('throttles notifications after max per hour', async () => {
    vi.mocked(executeFilesystemSkillByName).mockResolvedValue({
      success: true,
      output: 'Processed.',
      error: undefined,
    });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );

    for (let i = 0; i < 5; i++) {
      await freshExecute('+1234567890', [makeClassification({
        emailIndex: i + 1,
        matches: [{
          skill: 'invoice-tracker',
          confidence: 0.95,
          extracted: {},
          summary: `Notification ${i + 1}`,
        }],
      })]);
    }

    expect(sendSms).toHaveBeenCalledTimes(3);
  });
});
