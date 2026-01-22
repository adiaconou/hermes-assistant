/**
 * @fileoverview Scheduled job executor.
 *
 * Executes a single scheduled job by calling the LLM with the job's prompt
 * and sending the response via SMS/WhatsApp.
 */

import { Cron } from 'croner';
import type Database from 'better-sqlite3';
import { generateResponse, READ_ONLY_TOOLS } from '../../llm.js';
import { getUserConfigStore } from '../user-config/index.js';
import { sendSms, sendWhatsApp } from '../../twilio.js';
import { updateJob, deleteJob } from './sqlite.js';
import type { ScheduledJob, ExecutionResult } from './types.js';

/**
 * System prompt for scheduled job execution.
 * Simpler than interactive prompt - just generate the requested content.
 */
const JOB_SYSTEM_PROMPT = `You are generating a scheduled message for the user.
Be concise and helpful. This message will be sent via SMS.
You have access to read-only tools to gather information (calendar events, etc).
Generate the content the user requested, then stop.
Do not ask questions or request more information - just generate the best response you can.`;

/**
 * Execute a single scheduled job.
 *
 * 1. Load user config for context
 * 2. Call LLM with job prompt and read-only tools
 * 3. Send response via SMS/WhatsApp
 * 4. Update next_run_at for next execution
 */
export async function executeJob(
  db: Database.Database,
  job: ScheduledJob
): Promise<ExecutionResult> {
  const startTime = Date.now();
  logJobStart(job);

  try {
    // Load user config for context
    const userConfigStore = getUserConfigStore();
    const userConfig = await userConfigStore.get(job.phoneNumber);

    // Build time context for the prompt
    const now = new Date();
    const timezone = userConfig?.timezone ?? job.timezone;
    const timeContext = timezone
      ? now.toLocaleString('en-US', {
          timeZone: timezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : now.toISOString();

    const systemPrompt = `**Current time: ${timeContext}**\n\n${JOB_SYSTEM_PROMPT}`;

    // Call LLM with job prompt and restricted tools
    const response = await generateResponse(
      job.prompt,
      [], // No conversation history
      job.phoneNumber,
      userConfig,
      {
        systemPrompt,
        tools: READ_ONLY_TOOLS,
      }
    );

    // Send the response via appropriate channel (stored in job)
    if (job.channel === 'whatsapp') {
      await sendWhatsApp(job.phoneNumber, response);
    } else {
      await sendSms(job.phoneNumber, response);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (job.isRecurring) {
      // Recurring job: calculate next run time and update
      const nextRunAt = calculateNextRun(job.cronExpression, job.timezone);
      await updateJob(db, job.id, {
        nextRunAt,
        lastRunAt: nowSeconds,
      });
      logJobSuccess(job, Date.now() - startTime, nextRunAt);
    } else {
      // One-time reminder: delete after execution
      deleteJob(db, job.id);
      logOneTimeComplete(job, Date.now() - startTime);
    }

    return { success: true };

  } catch (error) {
    logJobError(job, error as Error, Date.now() - startTime);

    // For recurring jobs, update next_run_at so job continues on schedule
    // For one-time jobs, delete them even on failure (they won't retry)
    try {
      if (job.isRecurring) {
        const nextRunAt = calculateNextRun(job.cronExpression, job.timezone);
        const nowSeconds = Math.floor(Date.now() / 1000);
        await updateJob(db, job.id, {
          nextRunAt,
          lastRunAt: nowSeconds,
        });
      } else {
        // One-time reminder: delete even on failure
        deleteJob(db, job.id);
      }
    } catch (updateError) {
      console.error(JSON.stringify({
        event: 'job_update_error',
        jobId: job.id,
        error: (updateError as Error).message,
        timestamp: new Date().toISOString(),
      }));
    }

    return { success: false, error: error as Error };
  }
}

/**
 * Calculate the next run time for a cron expression.
 * Returns Unix timestamp in seconds.
 */
function calculateNextRun(cronExpression: string, timezone: string): number {
  const cron = new Cron(cronExpression, { timezone });
  const nextRun = cron.nextRun();
  if (!nextRun) {
    throw new Error(`Could not calculate next run for cron: ${cronExpression}`);
  }
  return Math.floor(nextRun.getTime() / 1000);
}

/**
 * Log job execution start.
 */
function logJobStart(job: ScheduledJob): void {
  console.log(JSON.stringify({
    event: 'job_execution_start',
    jobId: job.id,
    phoneNumber: job.phoneNumber.slice(-4),
    cronExpression: job.cronExpression,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Log job execution success.
 */
function logJobSuccess(job: ScheduledJob, durationMs: number, nextRunAt: number): void {
  console.log(JSON.stringify({
    event: 'job_execution_success',
    jobId: job.id,
    durationMs,
    nextRunAt: new Date(nextRunAt * 1000).toISOString(),
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Log one-time reminder completion (deleted after execution).
 */
function logOneTimeComplete(job: ScheduledJob, durationMs: number): void {
  console.log(JSON.stringify({
    event: 'one_time_reminder_completed',
    jobId: job.id,
    durationMs,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Log job execution error.
 */
function logJobError(job: ScheduledJob, error: Error, durationMs: number): void {
  console.error(JSON.stringify({
    event: 'job_execution_error',
    jobId: job.id,
    error: error.message,
    durationMs,
    timestamp: new Date().toISOString(),
  }));
}
