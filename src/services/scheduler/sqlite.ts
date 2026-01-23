/**
 * @fileoverview SQLite storage for scheduled jobs.
 *
 * Provides CRUD operations for the scheduled_jobs table.
 * Uses pre-computed next_run_at for efficient polling.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { ScheduledJob, CreateJobInput, JobUpdates } from './types.js';

/**
 * Database row shape for scheduled_jobs table.
 */
interface ScheduledJobRow {
  id: string;
  phone_number: string;
  channel: string;
  user_request: string | null;
  prompt: string;
  cron_expression: string;
  timezone: string;
  next_run_at: number;
  last_run_at: number | null;
  enabled: number;
  is_recurring: number;
  created_at: number;
  updated_at: number;
}

/**
 * Convert database row to ScheduledJob type.
 */
function rowToJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    phoneNumber: row.phone_number,
    channel: row.channel as 'sms' | 'whatsapp',
    userRequest: row.user_request ?? undefined,
    prompt: row.prompt,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at ?? undefined,
    enabled: row.enabled === 1,
    isRecurring: row.is_recurring === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Initialize the scheduled_jobs table.
 * Call this on app startup.
 */
export function initSchedulerDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'sms',
      user_request TEXT,
      prompt TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      timezone TEXT NOT NULL,
      next_run_at INTEGER NOT NULL,
      last_run_at INTEGER,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run
      ON scheduled_jobs(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_phone
      ON scheduled_jobs(phone_number);
  `);

  // Migration: add channel column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE scheduled_jobs ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms'`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: add is_recurring column if it doesn't exist (for existing databases)
  // Default to 1 (true) since all existing jobs are recurring
  try {
    db.exec(`ALTER TABLE scheduled_jobs ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists, ignore
  }
}

/**
 * Create a new scheduled job.
 */
export function createJob(db: Database.Database, input: CreateJobInput): ScheduledJob {
  const now = Math.floor(Date.now() / 1000);
  const id = randomUUID();

  db.prepare(`
    INSERT INTO scheduled_jobs
      (id, phone_number, channel, user_request, prompt, cron_expression, timezone, next_run_at, is_recurring, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    input.phoneNumber,
    input.channel,
    input.userRequest ?? null,
    input.prompt,
    input.cronExpression,
    input.timezone,
    input.nextRunAt,
    input.isRecurring ? 1 : 0,
    now,
    now
  );

  return {
    id,
    phoneNumber: input.phoneNumber,
    channel: input.channel,
    userRequest: input.userRequest,
    prompt: input.prompt,
    cronExpression: input.cronExpression,
    timezone: input.timezone,
    nextRunAt: input.nextRunAt,
    lastRunAt: undefined,
    enabled: true,
    isRecurring: input.isRecurring,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get a job by ID.
 */
export function getJobById(db: Database.Database, id: string): ScheduledJob | null {
  const row = db.prepare(`
    SELECT * FROM scheduled_jobs WHERE id = ?
  `).get(id) as ScheduledJobRow | undefined;

  return row ? rowToJob(row) : null;
}

/**
 * Get active jobs for a phone number.
 * Returns only enabled jobs with future next_run_at, sorted by next execution date.
 */
export function getJobsByPhone(
  db: Database.Database,
  phoneNumber: string,
  nowSeconds: number
): ScheduledJob[] {
  const rows = db.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE phone_number = ?
      AND enabled = 1
      AND next_run_at > ?
    ORDER BY next_run_at ASC
  `).all(phoneNumber, nowSeconds) as ScheduledJobRow[];

  return rows.map(rowToJob);
}

/**
 * Get all jobs that are due for execution.
 * Returns enabled jobs where next_run_at <= now.
 */
export function getDueJobs(db: Database.Database, nowSeconds: number): ScheduledJob[] {
  const rows = db.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE enabled = 1 AND next_run_at <= ?
    ORDER BY next_run_at ASC
  `).all(nowSeconds) as ScheduledJobRow[];

  return rows.map(rowToJob);
}

/**
 * Update a job's fields.
 * Returns updated job or null if not found.
 */
export function updateJob(
  db: Database.Database,
  id: string,
  updates: JobUpdates
): ScheduledJob | null {
  const existing = getJobById(db, id);
  if (!existing) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.prompt !== undefined) {
    setClauses.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.userRequest !== undefined) {
    setClauses.push('user_request = ?');
    values.push(updates.userRequest);
  }
  if (updates.cronExpression !== undefined) {
    setClauses.push('cron_expression = ?');
    values.push(updates.cronExpression);
  }
  if (updates.timezone !== undefined) {
    setClauses.push('timezone = ?');
    values.push(updates.timezone);
  }
  if (updates.nextRunAt !== undefined) {
    setClauses.push('next_run_at = ?');
    values.push(updates.nextRunAt);
  }
  if (updates.lastRunAt !== undefined) {
    setClauses.push('last_run_at = ?');
    values.push(updates.lastRunAt);
  }
  if (updates.enabled !== undefined) {
    setClauses.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }

  if (setClauses.length === 0) {
    return existing;
  }

  setClauses.push('updated_at = ?');
  values.push(now);
  values.push(id);

  db.prepare(`
    UPDATE scheduled_jobs SET ${setClauses.join(', ')} WHERE id = ?
  `).run(...values);

  return getJobById(db, id);
}

/**
 * Delete a job.
 * Returns true if deleted, false if not found.
 */
export function deleteJob(db: Database.Database, id: string): boolean {
  const result = db.prepare(`
    DELETE FROM scheduled_jobs WHERE id = ?
  `).run(id);

  return result.changes > 0;
}
