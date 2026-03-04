/**
 * Unit tests for filesystem skill executor output normalization.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentExecutionContext } from '../../../src/executor/types.js';
import type { LoadedSkill } from '../../../src/domains/skills/types.js';

const executeWithToolsMock = vi.fn();

vi.mock('../../../src/domains/skills/repo/filesystem.js', () => ({
  loadSkillBody: vi.fn(() => '# Skill'),
  safeReadFile: vi.fn(() => ''),
  listSkillResources: vi.fn(() => []),
}));

vi.mock('../../../src/domains/skills/providers/executor.js', () => ({
  getSkillsExecuteWithTools: vi.fn(() => executeWithToolsMock),
}));

import { executeFilesystemSkill } from '../../../src/domains/skills/service/executor.js';

function makeSkill(name: string): LoadedSkill {
  return {
    name,
    description: 'Test skill',
    markdownPath: `/skills/${name}/SKILL.md`,
    rootDir: `/skills/${name}`,
    channels: ['scheduler'],
    tools: ['get_emails', 'read_email', 'get_calendar_events'],
    matchHints: [],
    enabled: true,
    source: 'bundled',
    delegateAgent: null,
    autoSchedule: null,
  };
}

const baseContext: AgentExecutionContext = {
  phoneNumber: '+15551234567',
  channel: 'sms',
  userConfig: {
    phoneNumber: '+15551234567',
    timezone: 'America/Los_Angeles',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  userFacts: [],
  previousStepResults: {},
};

describe('executeFilesystemSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds missing email section for daily-briefing output', async () => {
    executeWithToolsMock.mockResolvedValue({
      success: true,
      output: '### Calendar (Next 7 Days)\n- Team sync',
    });

    const result = await executeFilesystemSkill(
      makeSkill('daily-briefing'),
      'Generate my daily briefing.',
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('### Email Summary');
    expect(result.output).toContain('No important updates.');
    expect(result.output).toContain('### Calendar (Next 7 Days)');
    expect(result.output).toContain('- Team sync');
  });

  it('builds both required sections when daily-briefing output is empty', async () => {
    executeWithToolsMock.mockResolvedValue({
      success: true,
      output: '',
    });

    const result = await executeFilesystemSkill(
      makeSkill('daily-briefing'),
      'Generate my daily briefing.',
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('### Email Summary');
    expect(result.output).toContain('### Calendar (Next 7 Days)');
  });

  it('does not normalize non-daily skills', async () => {
    executeWithToolsMock.mockResolvedValue({
      success: true,
      output: 'Custom output',
    });

    const result = await executeFilesystemSkill(
      makeSkill('sample-reminder-helper'),
      'Run this skill.',
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe('Custom output');
  });
});
