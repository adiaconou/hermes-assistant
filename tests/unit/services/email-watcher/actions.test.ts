/**
 * Unit tests for email watcher action execution and notification throttle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all external dependencies
const mockExecuteWithTools = vi.fn();
vi.mock('../../../../src/domains/email-watcher/providers/executor.js', () => ({
  getEmailWatcherExecuteWithTools: vi.fn(() => mockExecuteWithTools),
}));

vi.mock('../../../../src/domains/email-watcher/repo/sqlite.js', () => ({
  getEmailSkillStore: vi.fn(),
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
import { getEmailSkillStore } from '../../../../src/domains/email-watcher/repo/sqlite.js';
import { sendSms } from '../../../../src/twilio.js';
import type { ClassificationResult, EmailSkill } from '../../../../src/domains/email-watcher/types.js';

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
        extracted: { amount: '$100', vendor: 'Acme Corp' },
        summary: 'Invoice from Acme Corp for $100',
      },
    ],
    ...overrides,
  };
}

describe('executeSkillActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to clear throttle state
    vi.resetModules();
  });

  it('assembles task string with actionPrompt and XML context for execute_with_tools', async () => {
    const skill = makeSkill({
      actionType: 'execute_with_tools',
      actionPrompt: 'Append to spreadsheet',
      tools: ['append_to_spreadsheet'],
    });
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });
    mockExecuteWithTools.mockResolvedValue({
      success: true,
      output: 'Appended row to spreadsheet',
    });

    const classification = makeClassification({
      matches: [{
        skill: 'invoice-tracker',
        confidence: 0.95,
        extracted: { amount: '$100', vendor: 'Acme Corp' },
        summary: 'Invoice from Acme Corp',
      }],
    });

    // Re-import to get fresh module with clean throttle
    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );
    await freshExecute('+1234567890', [classification]);

    expect(mockExecuteWithTools).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteWithTools.mock.calls[0];
    // First arg is system prompt
    expect(callArgs[0]).toContain('invoice-tracker');
    // Second arg is the task string
    expect(callArgs[1]).toContain('Append to spreadsheet');
    expect(callArgs[1]).toContain('<extracted_data>');
    expect(callArgs[1]).toContain('<email_metadata>');
    // Third arg is tools array
    expect(callArgs[2]).toEqual(['append_to_spreadsheet']);
  });

  it('uses match summary directly for notify actions', async () => {
    const skill = makeSkill({ actionType: 'notify' });
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    const classification = makeClassification({
      matches: [{
        skill: 'invoice-tracker',
        confidence: 0.95,
        extracted: {},
        summary: 'Invoice from Acme Corp for $100',
      }],
    });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );
    await freshExecute('+1234567890', [classification]);

    expect(mockExecuteWithTools).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledTimes(1);
    const smsBody = (sendSms as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(smsBody).toContain('Invoice from Acme Corp for $100');
  });

  it('sends merged notification for multi-match on single email', async () => {
    const skills = [
      makeSkill({ name: 'invoice-tracker', actionType: 'notify' }),
      makeSkill({ id: 'skill_2', name: 'expense-tracker', actionType: 'notify' }),
    ];
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue(skills),
    });

    const classification = makeClassification({
      matches: [
        { skill: 'invoice-tracker', confidence: 0.9, extracted: {}, summary: 'Invoice notification' },
        { skill: 'expense-tracker', confidence: 0.85, extracted: {}, summary: 'Expense notification' },
      ],
    });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );
    await freshExecute('+1234567890', [classification]);

    // Should send a single merged SMS, not two
    expect(sendSms).toHaveBeenCalledTimes(1);
    const smsBody = (sendSms as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(smsBody).toContain('Invoice notification');
    expect(smsBody).toContain('Expense notification');
  });

  it('throttles notifications after max per hour', async () => {
    const skill = makeSkill({ actionType: 'notify' });
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );

    // Send max notifications (3 per config mock)
    for (let i = 0; i < 5; i++) {
      const classification = makeClassification({
        emailIndex: i + 1,
        matches: [{
          skill: 'invoice-tracker',
          confidence: 0.95,
          extracted: {},
          summary: `Notification ${i + 1}`,
        }],
      });
      await freshExecute('+1234567890', [classification]);
    }

    // Only 3 should have been sent (the max)
    expect(sendSms).toHaveBeenCalledTimes(3);
  });

  it('does not block other actions when one fails', async () => {
    const skills = [
      makeSkill({
        name: 'failing-skill',
        actionType: 'execute_with_tools',
        tools: ['append_to_spreadsheet'],
      }),
      makeSkill({ id: 'skill_2', name: 'notify-skill', actionType: 'notify' }),
    ];
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue(skills),
    });

    // First tool action fails
    mockExecuteWithTools.mockResolvedValue({
      success: false,
      error: 'Tool execution failed',
    });

    const classification = makeClassification({
      matches: [
        { skill: 'failing-skill', confidence: 0.9, extracted: {}, summary: 'Failed action' },
        { skill: 'notify-skill', confidence: 0.85, extracted: {}, summary: 'Success notification' },
      ],
    });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );
    await freshExecute('+1234567890', [classification]);

    // The notify action should still send SMS even though tool action failed
    expect(sendSms).toHaveBeenCalledTimes(1);
    const smsBody = (sendSms as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(smsBody).toContain('Success notification');
  });

  it('skips classifications with no matches', async () => {
    const skill = makeSkill();
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    const classification = makeClassification({ matches: [] });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );
    await freshExecute('+1234567890', [classification]);

    expect(sendSms).not.toHaveBeenCalled();
    expect(mockExecuteWithTools).not.toHaveBeenCalled();
  });

  it('includes email subject and from in notification SMS', async () => {
    const skill = makeSkill({ actionType: 'notify' });
    (getEmailSkillStore as ReturnType<typeof vi.fn>).mockReturnValue({
      getSkillsForUser: vi.fn().mockReturnValue([skill]),
    });

    const classification = makeClassification({
      email: {
        messageId: 'msg_1',
        from: 'billing@acme.com',
        subject: 'Invoice #456',
        date: 'Mon, 20 Jan 2025 10:00:00 -0800',
        body: 'Invoice body',
        attachments: [],
      },
      matches: [{
        skill: 'invoice-tracker',
        confidence: 0.9,
        extracted: {},
        summary: 'New invoice',
      }],
    });

    const { executeSkillActions: freshExecute } = await import(
      '../../../../src/domains/email-watcher/service/actions.js'
    );
    await freshExecute('+1234567890', [classification]);

    const smsBody = (sendSms as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(smsBody).toContain('billing@acme.com');
    expect(smsBody).toContain('Invoice #456');
  });
});
