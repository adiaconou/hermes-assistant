/**
 * Scheduler tools for creating and managing scheduled messages.
 */

import type { ToolDefinition } from '../../../tools/types.js';
import { requirePhoneNumber, validateInput } from '../../../tools/utils.js';
import { getUserConfigStore } from '../../../services/user-config/index.js';
import { Cron } from 'croner';
import {
  createJob,
  getJobById,
  getJobsByPhone,
  updateJob,
  deleteJob,
} from '../repo/sqlite.js';
import {
  parseScheduleToCron,
  parseReminderTime,
  parseSchedule,
  cronToHuman,
} from '../service/parser.js';
import { getSchedulerDb } from './index.js';
import { findFilesystemSkill } from '../providers/skills.js';

export const createScheduledJob: ToolDefinition = {
  tool: {
    name: 'create_scheduled_job',
    description: `Create a scheduled message that will be generated and sent to the user.
Works for both one-time and recurring schedules - the system auto-detects based on the schedule.

One-time examples: "tomorrow at 9am", "in 2 hours", "next Friday at 3pm"
Recurring examples: "daily at 9am", "every Monday at noon", "every weekday at 8:30am"

Use this for SMS/text reminders. For calendar events, use create_calendar_event instead.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        user_request: {
          type: 'string',
          description: "The user's original request in their own words. Used for display when listing jobs.",
        },
        prompt: {
          type: 'string',
          description: "What should be generated and sent. Be specific. Example: 'Generate a brief morning summary including today's calendar events'",
        },
        schedule: {
          type: 'string',
          description: "When to run, in natural language. Examples: 'daily at 9am', 'every weekday at 8:30am', 'every Monday at noon', 'every hour'",
        },
        skill_name: {
          type: 'string',
          description: 'Optional filesystem skill name to execute for this job. If provided, prompt is passed as skill input.',
        },
      },
      required: ['prompt', 'schedule'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const validationError = validateInput(input, {
      prompt: { type: 'string', required: true },
      schedule: { type: 'string', required: true },
      user_request: { type: 'string', required: false },
      skill_name: { type: 'string', required: false },
    });
    if (validationError) return validationError;

    const { user_request, prompt, schedule, skill_name } = input as {
      user_request?: string;
      prompt: string;
      schedule: string;
      skill_name?: string;
    };

    const skillName = skill_name?.trim();
    if (skillName) {
      const skill = findFilesystemSkill(skillName);
      if (!skill) {
        return { success: false, error: `Skill not found: ${skillName}` };
      }
      if (!skill.channels.includes('scheduler')) {
        return { success: false, error: `Skill "${skillName}" is not enabled for scheduler channel` };
      }
    }

    // Validate prompt length (max 1000 chars)
    if (!prompt || prompt.length === 0) {
      return { success: false, error: 'Prompt is required' };
    }
    if (prompt.length > 1000) {
      return { success: false, error: 'Prompt is too long (max 1000 characters)' };
    }

    // Get user timezone
    const userConfigStore = getUserConfigStore();
    const userConfig = await userConfigStore.get(phoneNumber);
    const timezone = userConfig?.timezone;
    if (!timezone) {
      return {
        success: false,
        error: 'Timezone not set. Ask the user for their timezone before scheduling reminders.',
      };
    }

    // Parse schedule (auto-detects recurring vs one-time)
    const parsed = parseSchedule(schedule, timezone);
    if (!parsed) {
      return {
        success: false,
        error: `Could not parse schedule: "${schedule}". Try formats like "daily at 9am", "tomorrow at 3pm", "in 2 hours"`,
      };
    }

    // Calculate next run time
    try {
      let nextRun: Date;
      let cronExpression: string;
      let scheduleDescription: string;

      if (parsed.type === 'recurring') {
        cronExpression = parsed.cronExpression!;

        // For interval patterns (every N hours/minutes), the first run should be
        // N units from now, not at the next aligned time
        const hourIntervalMatch = cronExpression.match(/^0 \*\/(\d+) \* \* \*$/);
        const minuteIntervalMatch = cronExpression.match(/^\*\/(\d+) \* \* \* \*$/);

        if (hourIntervalMatch) {
          // Every N hours - first run is N hours from now
          const hours = parseInt(hourIntervalMatch[1], 10);
          nextRun = new Date(Date.now() + hours * 60 * 60 * 1000);
        } else if (minuteIntervalMatch) {
          // Every N minutes - first run is N minutes from now
          const minutes = parseInt(minuteIntervalMatch[1], 10);
          nextRun = new Date(Date.now() + minutes * 60 * 1000);
        } else {
          // Standard cron - use croner to calculate next run
          const cron = new Cron(cronExpression, { timezone });
          const cronNextRun = cron.nextRun();
          if (!cronNextRun) {
            return {
              success: false,
              error: 'Could not calculate next run time for this schedule',
            };
          }
          nextRun = cronNextRun;
        }

        scheduleDescription = cronToHuman(cronExpression);
      } else {
        // One-time reminder
        cronExpression = '@once';
        nextRun = new Date(parsed.runAtTimestamp! * 1000);
        scheduleDescription = 'one-time reminder';
      }

      const nextRunAt = Math.floor(nextRun.getTime() / 1000);
      const db = getSchedulerDb();
      const channel = context.channel ?? 'sms';
      const job = createJob(db, {
        phoneNumber,
        channel,
        userRequest: user_request,
        prompt,
        skillName,
        cronExpression,
        timezone,
        nextRunAt,
        isRecurring: parsed.type === 'recurring',
      });

      const nextRunFormatted = nextRun.toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

      console.log(JSON.stringify({
        level: 'info',
        message: parsed.type === 'recurring' ? 'Scheduled job created' : 'One-time reminder created',
        jobId: job.id,
        type: parsed.type,
        cronExpression,
        timezone,
        nextRunAt: nextRun.toISOString(),
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        job_id: job.id,
        type: parsed.type,
        schedule_description: scheduleDescription,
        next_run: nextRunFormatted,
        timezone,
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to create scheduled job',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const listScheduledJobs: ToolDefinition = {
  tool: {
    name: 'list_scheduled_jobs',
    description: 'List all scheduled jobs for the current user. Shows what recurring tasks are set up.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  handler: async (_input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    try {
      const db = getSchedulerDb();
      const nowSeconds = Math.floor(Date.now() / 1000);
      const jobs = getJobsByPhone(db, phoneNumber, nowSeconds);

      if (jobs.length === 0) {
        return {
          success: true,
          jobs: [],
          message: 'No scheduled jobs found',
        };
      }

      const jobList = jobs.map((job) => ({
        job_id: job.id,
        description: job.userRequest || (job.prompt.length > 50 ? job.prompt.slice(0, 50) + '...' : job.prompt),
        type: job.isRecurring ? 'recurring' : 'one-time',
        schedule: job.isRecurring ? cronToHuman(job.cronExpression) : 'one-time',
        skill_name: job.skillName ?? null,
        enabled: job.enabled,
        next_run: job.enabled && job.nextRunAt
          ? new Date(job.nextRunAt * 1000).toLocaleString('en-US', {
              timeZone: job.timezone,
              weekday: 'short',
              month: 'numeric',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : 'paused',
      }));

      return {
        success: true,
        jobs: jobList,
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to list scheduled jobs',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const updateScheduledJob: ToolDefinition = {
  tool: {
    name: 'update_scheduled_job',
    description: `Update an existing scheduled job. Can change the prompt, schedule, or pause/resume the job.

IMPORTANT: Updates preserve the job type - one-time reminders stay one-time, recurring jobs stay recurring.
When updating the schedule of a one-time reminder, parse the input as a specific date/time (e.g., "Saturday at 4pm" means THIS Saturday, not every Saturday).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        job_id: {
          type: 'string',
          description: 'The job ID to update',
        },
        prompt: {
          type: 'string',
          description: 'New prompt for what to generate (optional)',
        },
        schedule: {
          type: 'string',
          description: 'New schedule in natural language (optional)',
        },
        enabled: {
          type: 'boolean',
          description: 'Set to false to pause, true to resume (optional)',
        },
        skill_name: {
          type: 'string',
          description: 'Optional filesystem skill name for this job (optional)',
        },
      },
      required: ['job_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const validationError = validateInput(input, {
      job_id: { type: 'string', required: true },
      prompt: { type: 'string', required: false },
      schedule: { type: 'string', required: false },
      enabled: { type: 'boolean', required: false },
      skill_name: { type: 'string', required: false },
    });
    if (validationError) return validationError;

    const { job_id, prompt, schedule, enabled, skill_name } = input as {
      job_id: string;
      prompt?: string;
      schedule?: string;
      enabled?: boolean;
      skill_name?: string;
    };

    try {
      const db = getSchedulerDb();
      const job = getJobById(db, job_id);

      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      if (job.phoneNumber !== phoneNumber) {
        return { success: false, error: 'Job not found' };
      }

      const updates: Record<string, unknown> = {};

      if (prompt !== undefined) {
        updates.prompt = prompt;
      }

      if (enabled !== undefined) {
        updates.enabled = enabled;
      }

      if (skill_name !== undefined) {
        const trimmedSkillName = skill_name.trim();
        if (trimmedSkillName.length === 0) {
          return { success: false, error: 'skill_name must not be empty when provided' };
        }
        const skill = findFilesystemSkill(trimmedSkillName);
        if (!skill) {
          return { success: false, error: `Skill not found: ${trimmedSkillName}` };
        }
        if (!skill.channels.includes('scheduler')) {
          return { success: false, error: `Skill "${trimmedSkillName}" is not enabled for scheduler channel` };
        }
        updates.skillName = trimmedSkillName;
      }

      // Recalculate next_run_at when re-enabling a recurring job (unless schedule is also being updated)
      // For one-time reminders, re-enabling keeps the existing nextRunAt
      if (enabled === true && schedule === undefined && job.isRecurring) {
        const cron = new Cron(job.cronExpression, { timezone: job.timezone });
        const nextRun = cron.nextRun();
        if (nextRun) {
          updates.nextRunAt = Math.floor(nextRun.getTime() / 1000);
        }
      }

      if (schedule !== undefined) {
        if (job.isRecurring) {
          // Recurring job - parse to cron expression
          const cronExpression = parseScheduleToCron(schedule);
          if (!cronExpression) {
            return {
              success: false,
              error: `Could not parse schedule: "${schedule}"`,
            };
          }
          updates.cronExpression = cronExpression;

          const cron = new Cron(cronExpression, { timezone: job.timezone });
          const nextRun = cron.nextRun();
          if (nextRun) {
            updates.nextRunAt = Math.floor(nextRun.getTime() / 1000);
          }
        } else {
          // One-time reminder - parse to timestamp
          const timestamp = parseReminderTime(schedule, job.timezone);
          if (!timestamp) {
            return {
              success: false,
              error: `Could not parse time: "${schedule}"`,
            };
          }
          updates.nextRunAt = timestamp;
        }
      }

      const updatedJob = updateJob(db, job_id, updates);

      // Get the final nextRunAt for formatting
      const finalNextRunAt = (updates.nextRunAt as number) ?? job.nextRunAt;
      const nextRunDate = finalNextRunAt ? new Date(finalNextRunAt * 1000) : null;
      const nextRunFormatted = nextRunDate
        ? nextRunDate.toLocaleString('en-US', {
            timeZone: job.timezone,
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : null;

      // Get schedule description
      const scheduleDescription = job.isRecurring
        ? cronToHuman(updatedJob?.cronExpression ?? job.cronExpression)
        : 'one-time reminder';

      console.log(JSON.stringify({
        level: 'info',
        message: 'Scheduled job updated',
        jobId: job_id,
        type: job.isRecurring ? 'recurring' : 'one-time',
        scheduleDescription,
        nextRun: nextRunFormatted,
        updates: Object.keys(updates),
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        job_id,
        type: job.isRecurring ? 'recurring' : 'one-time',
        schedule_description: scheduleDescription,
        next_run: nextRunFormatted,
        updated_fields: Object.keys(updates),
        enabled: updatedJob?.enabled,
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to update scheduled job',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const deleteScheduledJob: ToolDefinition = {
  tool: {
    name: 'delete_scheduled_job',
    description: 'Delete a scheduled job permanently.',
    input_schema: {
      type: 'object' as const,
      properties: {
        job_id: {
          type: 'string',
          description: 'The job ID to delete',
        },
      },
      required: ['job_id'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const validationError = validateInput(input, {
      job_id: { type: 'string', required: true },
    });
    if (validationError) return validationError;

    const { job_id } = input as { job_id: string };

    try {
      const db = getSchedulerDb();
      const job = getJobById(db, job_id);

      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      if (job.phoneNumber !== phoneNumber) {
        return { success: false, error: 'Job not found' };
      }

      deleteJob(db, job_id);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Scheduled job deleted',
        jobId: job_id,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        message: 'Job deleted successfully',
      };
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Failed to delete scheduled job',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
