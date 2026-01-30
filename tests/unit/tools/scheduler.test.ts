/**
 * Unit tests for scheduler tools.
 *
 * Tests the scheduler tool handlers (create, list, update, delete).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(() => ({
    get: vi.fn(async () => ({ timezone: 'America/New_York' })),
  })),
}));

vi.mock('../../../src/services/scheduler/index.js', () => ({
  createJob: vi.fn(() => ({ id: 'job_123' })),
  getJobById: vi.fn(),
  getJobsByPhone: vi.fn(() => []),
  updateJob: vi.fn((db, id, updates) => ({ ...updates, id })),
  deleteJob: vi.fn(),
  parseScheduleToCron: vi.fn((schedule) => {
    if (schedule.includes('daily')) return '0 9 * * *';
    if (schedule.includes('hourly')) return '0 * * * *';
    return null;
  }),
  parseReminderTime: vi.fn(() => Math.floor(Date.now() / 1000) + 3600),
  parseSchedule: vi.fn((schedule) => {
    if (schedule.includes('daily') || schedule.includes('every')) {
      return { type: 'recurring', cronExpression: '0 9 * * *' };
    }
    if (schedule.includes('tomorrow') || schedule.includes('in')) {
      return { type: 'once', runAtTimestamp: Math.floor(Date.now() / 1000) + 3600 };
    }
    return null;
  }),
  cronToHuman: vi.fn(() => 'daily at 9 AM'),
  getSchedulerDb: vi.fn(() => ({})),
}));

import {
  createScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
  deleteScheduledJob,
} from '../../../src/tools/scheduler.js';
import type { ToolContext } from '../../../src/tools/types.js';
import {
  createJob,
  getJobById,
  getJobsByPhone,
  updateJob,
  deleteJob,
} from '../../../src/services/scheduler/index.js';
import { getUserConfigStore } from '../../../src/services/user-config/index.js';

describe('createScheduledJob', () => {
  const baseContext: ToolContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
    userConfig: { name: 'Test', timezone: 'America/New_York' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tool definition', () => {
    it('should have correct name', () => {
      expect(createScheduledJob.tool.name).toBe('create_scheduled_job');
    });

    it('should require prompt and schedule', () => {
      expect(createScheduledJob.tool.input_schema.required).toContain('prompt');
      expect(createScheduledJob.tool.input_schema.required).toContain('schedule');
    });
  });

  describe('handler', () => {
    it('should create a recurring job', async () => {
      const result = await createScheduledJob.handler(
        {
          prompt: 'Send morning summary',
          schedule: 'daily at 9am',
        },
        baseContext
      );

      expect(result).toMatchObject({
        success: true,
        job_id: 'job_123',
        type: 'recurring',
      });
      expect(createJob).toHaveBeenCalled();
    });

    it('should create a one-time reminder', async () => {
      const result = await createScheduledJob.handler(
        {
          prompt: 'Remind me to call mom',
          schedule: 'tomorrow at 3pm',
        },
        baseContext
      );

      expect(result).toMatchObject({
        success: true,
        job_id: 'job_123',
        type: 'once',
      });
    });

    it('should fail if prompt is empty', async () => {
      const result = await createScheduledJob.handler(
        {
          prompt: '',
          schedule: 'daily at 9am',
        },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Prompt is required');
    });

    it('should fail if prompt is too long', async () => {
      const result = await createScheduledJob.handler(
        {
          prompt: 'a'.repeat(1001),
          schedule: 'daily at 9am',
        },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should fail if timezone not set', async () => {
      const mockStore = getUserConfigStore as ReturnType<typeof vi.fn>;
      mockStore.mockReturnValueOnce({
        get: vi.fn(async () => null),
      });

      const result = await createScheduledJob.handler(
        {
          prompt: 'Test prompt',
          schedule: 'daily at 9am',
        },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Timezone not set');
    });

    it('should fail if schedule cannot be parsed', async () => {
      const { parseSchedule } = await import('../../../src/services/scheduler/index.js');
      (parseSchedule as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const result = await createScheduledJob.handler(
        {
          prompt: 'Test prompt',
          schedule: 'invalid schedule',
        },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not parse schedule');
    });

    it('should fail without phone number', async () => {
      await expect(
        createScheduledJob.handler(
          { prompt: 'Test', schedule: 'daily at 9am' },
          { ...baseContext, phoneNumber: undefined as unknown as string }
        )
      ).rejects.toThrow('Phone number not available');
    });
  });
});

describe('listScheduledJobs', () => {
  const baseContext: ToolContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
    userConfig: { name: 'Test', timezone: 'America/New_York' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tool definition', () => {
    it('should have correct name', () => {
      expect(listScheduledJobs.tool.name).toBe('list_scheduled_jobs');
    });
  });

  describe('handler', () => {
    it('should return empty list when no jobs', async () => {
      (getJobsByPhone as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);

      const result = await listScheduledJobs.handler({}, baseContext);

      expect(result).toMatchObject({
        success: true,
        jobs: [],
        message: 'No scheduled jobs found',
      });
    });

    it('should return list of jobs', async () => {
      (getJobsByPhone as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        {
          id: 'job_1',
          userRequest: 'Morning summary',
          prompt: 'Send morning summary',
          isRecurring: true,
          cronExpression: '0 9 * * *',
          enabled: true,
          nextRunAt: Math.floor(Date.now() / 1000) + 3600,
          timezone: 'America/New_York',
        },
        {
          id: 'job_2',
          userRequest: 'Call mom',
          prompt: 'Remind to call mom',
          isRecurring: false,
          cronExpression: '@once',
          enabled: true,
          nextRunAt: Math.floor(Date.now() / 1000) + 7200,
          timezone: 'America/New_York',
        },
      ]);

      const result = await listScheduledJobs.handler({}, baseContext);

      expect(result.success).toBe(true);
      expect(result.jobs).toHaveLength(2);
      expect(result.jobs[0].job_id).toBe('job_1');
      expect(result.jobs[0].type).toBe('recurring');
      expect(result.jobs[1].type).toBe('one-time');
    });

    it('should show paused status for disabled jobs', async () => {
      (getJobsByPhone as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        {
          id: 'job_1',
          prompt: 'Test',
          isRecurring: true,
          cronExpression: '0 9 * * *',
          enabled: false,
          nextRunAt: null,
          timezone: 'America/New_York',
        },
      ]);

      const result = await listScheduledJobs.handler({}, baseContext);

      expect(result.jobs[0].next_run).toBe('paused');
    });
  });
});

describe('updateScheduledJob', () => {
  const baseContext: ToolContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
    userConfig: { name: 'Test', timezone: 'America/New_York' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getJobById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'job_123',
      phoneNumber: '+1234567890',
      prompt: 'Original prompt',
      isRecurring: true,
      cronExpression: '0 9 * * *',
      enabled: true,
      nextRunAt: Math.floor(Date.now() / 1000) + 3600,
      timezone: 'America/New_York',
    });
  });

  describe('tool definition', () => {
    it('should have correct name', () => {
      expect(updateScheduledJob.tool.name).toBe('update_scheduled_job');
    });

    it('should require job_id', () => {
      expect(updateScheduledJob.tool.input_schema.required).toContain('job_id');
    });
  });

  describe('handler', () => {
    it('should update prompt', async () => {
      const result = await updateScheduledJob.handler(
        {
          job_id: 'job_123',
          prompt: 'New prompt',
        },
        baseContext
      );

      expect(result.success).toBe(true);
      expect(updateJob).toHaveBeenCalledWith(
        expect.anything(),
        'job_123',
        expect.objectContaining({ prompt: 'New prompt' })
      );
    });

    it('should pause job when enabled=false', async () => {
      const result = await updateScheduledJob.handler(
        {
          job_id: 'job_123',
          enabled: false,
        },
        baseContext
      );

      expect(result.success).toBe(true);
      expect(updateJob).toHaveBeenCalledWith(
        expect.anything(),
        'job_123',
        expect.objectContaining({ enabled: false })
      );
    });

    it('should fail if job not found', async () => {
      (getJobById as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const result = await updateScheduledJob.handler(
        {
          job_id: 'nonexistent',
        },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job not found');
    });

    it('should fail if job belongs to different user', async () => {
      (getJobById as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id: 'job_123',
        phoneNumber: '+9999999999', // Different user
        prompt: 'Test',
        isRecurring: true,
        cronExpression: '0 9 * * *',
        enabled: true,
        timezone: 'America/New_York',
      });

      const result = await updateScheduledJob.handler(
        {
          job_id: 'job_123',
        },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job not found');
    });
  });
});

describe('deleteScheduledJob', () => {
  const baseContext: ToolContext = {
    phoneNumber: '+1234567890',
    channel: 'sms',
    userConfig: { name: 'Test', timezone: 'America/New_York' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getJobById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'job_123',
      phoneNumber: '+1234567890',
      prompt: 'Test',
      isRecurring: true,
      cronExpression: '0 9 * * *',
      enabled: true,
      timezone: 'America/New_York',
    });
  });

  describe('tool definition', () => {
    it('should have correct name', () => {
      expect(deleteScheduledJob.tool.name).toBe('delete_scheduled_job');
    });

    it('should require job_id', () => {
      expect(deleteScheduledJob.tool.input_schema.required).toContain('job_id');
    });
  });

  describe('handler', () => {
    it('should delete job successfully', async () => {
      const result = await deleteScheduledJob.handler(
        {
          job_id: 'job_123',
        },
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Job deleted successfully');
      expect(deleteJob).toHaveBeenCalledWith(expect.anything(), 'job_123');
    });

    it('should fail if job not found', async () => {
      (getJobById as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const result = await deleteScheduledJob.handler(
        {
          job_id: 'nonexistent',
        },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job not found');
    });

    it('should fail if job belongs to different user', async () => {
      (getJobById as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id: 'job_123',
        phoneNumber: '+9999999999', // Different user
        prompt: 'Test',
        isRecurring: true,
        cronExpression: '0 9 * * *',
        enabled: true,
        timezone: 'America/New_York',
      });

      const result = await deleteScheduledJob.handler(
        {
          job_id: 'job_123',
        },
        baseContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job not found');
      expect(deleteJob).not.toHaveBeenCalled();
    });
  });
});
