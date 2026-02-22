/**
 * Unit tests for email watcher classifier (filesystem-skill matching).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../src/domains/email-watcher/providers/skills.js', () => ({
  listFilesystemSkills: vi.fn(),
  matchSkillForMessage: vi.fn(),
}));

import { classifyEmails } from '../../../../src/domains/email-watcher/service/classifier.js';
import { listFilesystemSkills, matchSkillForMessage } from '../../../../src/domains/email-watcher/providers/skills.js';
import type { IncomingEmail } from '../../../../src/domains/email-watcher/types.js';

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

describe('classifyEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no email-channel skills are loaded', async () => {
    vi.mocked(listFilesystemSkills).mockReturnValue([]);

    const result = await classifyEmails('+1234567890', [makeEmail()]);

    expect(result).toEqual([]);
    expect(matchSkillForMessage).not.toHaveBeenCalled();
  });

  it('matches an email to a filesystem skill', async () => {
    vi.mocked(listFilesystemSkills).mockReturnValue([{
      name: 'invoice-tracker',
      description: 'Track invoice emails',
      markdownPath: '/skills/invoice-tracker/SKILL.md',
      rootDir: '/skills/invoice-tracker',
      channels: ['email'],
      tools: [],
      matchHints: ['invoice'],
      enabled: true,
      source: 'bundled',
      delegateAgent: null,
    }]);

    vi.mocked(matchSkillForMessage).mockReturnValue({
      skill: {
        name: 'invoice-tracker',
        description: 'Track invoice emails',
        markdownPath: '/skills/invoice-tracker/SKILL.md',
        rootDir: '/skills/invoice-tracker',
        channels: ['email'],
        tools: [],
        matchHints: ['invoice'],
        enabled: true,
        source: 'bundled',
        delegateAgent: null,
      },
      confidence: 1,
      rationale: 'Matched hints: invoice',
    });

    const result = await classifyEmails('+1234567890', [makeEmail({ subject: 'Invoice #123' })]);

    expect(result).toHaveLength(1);
    expect(result[0].matches).toHaveLength(1);
    expect(result[0].matches[0].skill).toBe('invoice-tracker');
    expect(result[0].matches[0].confidence).toBe(1);
    expect(result[0].matches[0].summary).toContain('Matched hints');
  });

  it('returns empty matches when no skill matches an email', async () => {
    vi.mocked(listFilesystemSkills).mockReturnValue([{
      name: 'invoice-tracker',
      description: 'Track invoice emails',
      markdownPath: '/skills/invoice-tracker/SKILL.md',
      rootDir: '/skills/invoice-tracker',
      channels: ['email'],
      tools: [],
      matchHints: ['invoice'],
      enabled: true,
      source: 'bundled',
      delegateAgent: null,
    }]);
    vi.mocked(matchSkillForMessage).mockReturnValue(null);

    const result = await classifyEmails('+1234567890', [makeEmail({ subject: 'Weekly newsletter' })]);

    expect(result).toHaveLength(1);
    expect(result[0].matches).toEqual([]);
  });
});
