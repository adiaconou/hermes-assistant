/**
 * Unit tests for scheduler SQLite operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  initSchedulerDb,
  createJob,
  getJobById,
  getJobsByPhone,
  getDueJobs,
  updateJob,
  deleteJob,
} from '../../../src/domains/scheduler/repo/sqlite.js';

const TEST_DB_PATH = './data/test-scheduler.db';

describe('scheduler sqlite', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Ensure test directory exists
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Remove test DB if exists
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    db = new Database(TEST_DB_PATH);
    initSchedulerDb(db);
  });

  afterEach(() => {
    db.close();
    // Clean up test DB
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('createJob', () => {
    it('creates a recurring job and returns it with generated ID', () => {
      const job = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        userRequest: 'Send me a daily summary',
        prompt: 'Generate a summary of today',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        nextRunAt: Math.floor(Date.now() / 1000) + 3600,
        isRecurring: true,
      });

      expect(job.id).toBeDefined();
      expect(job.id).toHaveLength(36); // UUID length
      expect(job.phoneNumber).toBe('+1234567890');
      expect(job.userRequest).toBe('Send me a daily summary');
      expect(job.prompt).toBe('Generate a summary of today');
      expect(job.cronExpression).toBe('0 9 * * *');
      expect(job.timezone).toBe('America/New_York');
      expect(job.enabled).toBe(true);
      expect(job.isRecurring).toBe(true);
      expect(job.skillName).toBeUndefined();
    });

    it('creates a one-time reminder with isRecurring=false', () => {
      const job = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        userRequest: 'Remind me to call mom',
        prompt: 'Reminder: Call mom',
        cronExpression: '@once',
        timezone: 'America/New_York',
        nextRunAt: Math.floor(Date.now() / 1000) + 3600,
        isRecurring: false,
      });

      expect(job.id).toBeDefined();
      expect(job.isRecurring).toBe(false);
      expect(job.cronExpression).toBe('@once');
    });

    it('persists optional skillName', () => {
      const created = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Run weekly summary',
        skillName: 'weekly-summary',
        cronExpression: '0 9 * * 1',
        timezone: 'UTC',
        nextRunAt: Math.floor(Date.now() / 1000) + 3600,
        isRecurring: true,
      });

      const retrieved = getJobById(db, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.skillName).toBe('weekly-summary');
    });
  });

  describe('getJobById', () => {
    it('retrieves a job by ID', () => {
      const created = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Test prompt',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: Math.floor(Date.now() / 1000) + 3600,
        isRecurring: true,
      });

      const retrieved = getJobById(db, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.prompt).toBe('Test prompt');
      expect(retrieved?.isRecurring).toBe(true);
    });

    it('returns null for non-existent ID', () => {
      const result = getJobById(db, 'non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getJobsByPhone', () => {
    it('gets active jobs by phone number sorted by next_run_at', () => {
      const now = Math.floor(Date.now() / 1000);

      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Job 1 (runs later)',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: now + 7200, // 2 hours from now
        isRecurring: true,
      });

      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Job 2 (runs sooner)',
        cronExpression: '0 10 * * *',
        timezone: 'UTC',
        nextRunAt: now + 3600, // 1 hour from now
        isRecurring: true,
      });

      createJob(db, {
        phoneNumber: '+9999999999',
        channel: 'whatsapp',
        prompt: 'Other user job',
        cronExpression: '0 11 * * *',
        timezone: 'UTC',
        nextRunAt: now + 10800,
        isRecurring: true,
      });

      const jobs = getJobsByPhone(db, '+1234567890', now);

      expect(jobs).toHaveLength(2);
      // Should be sorted by next_run_at ASC (soonest first)
      expect(jobs[0].prompt).toBe('Job 2 (runs sooner)');
      expect(jobs[1].prompt).toBe('Job 1 (runs later)');
    });

    it('excludes disabled jobs and jobs with past next_run_at', () => {
      const now = Math.floor(Date.now() / 1000);

      // Active future job - should be included
      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Active job',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: now + 3600,
        isRecurring: true,
      });

      // Job with past next_run_at - should be excluded
      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Past job',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: now - 3600, // 1 hour ago
        isRecurring: true,
      });

      // Disabled job - should be excluded
      const disabledJob = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Disabled job',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: now + 7200,
        isRecurring: true,
      });
      updateJob(db, disabledJob.id, { enabled: false });

      const jobs = getJobsByPhone(db, '+1234567890', now);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].prompt).toBe('Active job');
    });

    it('returns empty array when no jobs for phone', () => {
      const now = Math.floor(Date.now() / 1000);
      const jobs = getJobsByPhone(db, '+9999999999', now);
      expect(jobs).toEqual([]);
    });
  });

  describe('getDueJobs', () => {
    it('gets due jobs (next_run_at <= now)', () => {
      const now = Math.floor(Date.now() / 1000);

      // Due job (past)
      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Due job',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: now - 60, // 1 minute ago
        isRecurring: true,
      });

      // Future job
      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Future job',
        cronExpression: '0 10 * * *',
        timezone: 'UTC',
        nextRunAt: now + 3600, // 1 hour from now
        isRecurring: true,
      });

      const dueJobs = getDueJobs(db, now);

      expect(dueJobs).toHaveLength(1);
      expect(dueJobs[0].prompt).toBe('Due job');
    });

    it('excludes disabled jobs', () => {
      const now = Math.floor(Date.now() / 1000);

      const job = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Disabled job',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: now - 60,
        isRecurring: true,
      });

      // Disable the job
      updateJob(db, job.id, { enabled: false });

      const dueJobs = getDueJobs(db, now);
      expect(dueJobs).toHaveLength(0);
    });
  });

  describe('updateJob', () => {
    it('updates job fields (enabled, next_run_at)', () => {
      const job = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Original prompt',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: 1000,
        isRecurring: true,
      });

      const updated = updateJob(db, job.id, {
        enabled: false,
        nextRunAt: 2000,
        prompt: 'Updated prompt',
        skillName: 'updated-skill',
      });

      expect(updated?.enabled).toBe(false);
      expect(updated?.nextRunAt).toBe(2000);
      expect(updated?.prompt).toBe('Updated prompt');
      expect(updated?.skillName).toBe('updated-skill');
    });

    it('returns null when updating non-existent job', () => {
      const result = updateJob(db, 'non-existent-id', { enabled: false });
      expect(result).toBeNull();
    });
  });

  describe('deleteJob', () => {
    it('deletes a job', () => {
      const job = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'To be deleted',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: 1000,
        isRecurring: true,
      });

      const deleted = deleteJob(db, job.id);
      expect(deleted).toBe(true);

      const retrieved = getJobById(db, job.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent job', () => {
      const deleted = deleteJob(db, 'non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('boundary: rowToJob validation', () => {
    it('throws on empty phone_number in scheduled_jobs row', () => {
      // Empty strings pass NOT NULL but are logically invalid — rowToJob catches them
      db.prepare(`
        INSERT INTO scheduled_jobs
          (id, phone_number, channel, prompt, cron_expression, timezone, next_run_at, enabled, is_recurring, created_at, updated_at)
        VALUES ('test-empty-phone', '', 'sms', 'test', '0 9 * * *', 'UTC', 1000, 1, 1, 1000, 1000)
      `).run();

      expect(() => getJobById(db, 'test-empty-phone')).toThrow(/Corrupt scheduled_jobs row/);
    });

    it('throws on empty prompt in scheduled_jobs row', () => {
      db.prepare(`
        INSERT INTO scheduled_jobs
          (id, phone_number, channel, prompt, cron_expression, timezone, next_run_at, enabled, is_recurring, created_at, updated_at)
        VALUES ('test-empty-prompt', '+1234567890', 'sms', '', '0 9 * * *', 'UTC', 1000, 1, 1, 1000, 1000)
      `).run();

      expect(() => getJobById(db, 'test-empty-prompt')).toThrow(/Corrupt scheduled_jobs row/);
    });

    it('throws on NULL enabled in scheduled_jobs row', () => {
      db.prepare(`
        INSERT INTO scheduled_jobs
          (id, phone_number, channel, prompt, cron_expression, timezone, next_run_at, enabled, is_recurring, created_at, updated_at)
        VALUES ('test-null-enabled', '+1234567890', 'sms', 'test', '0 9 * * *', 'UTC', 1000, NULL, 1, 1000, 1000)
      `).run();

      expect(() => getJobById(db, 'test-null-enabled')).toThrow(/null enabled field/);
    });

    it('throws on empty cron_expression in scheduled_jobs row', () => {
      db.prepare(`
        INSERT INTO scheduled_jobs
          (id, phone_number, channel, prompt, cron_expression, timezone, next_run_at, enabled, is_recurring, created_at, updated_at)
        VALUES ('test-empty-cron', '+1234567890', 'sms', 'test', '', 'UTC', 1000, 1, 1, 1000, 1000)
      `).run();

      expect(() => getJobById(db, 'test-empty-cron')).toThrow(/Corrupt scheduled_jobs row/);
    });

    it('throws on empty timezone in scheduled_jobs row', () => {
      db.prepare(`
        INSERT INTO scheduled_jobs
          (id, phone_number, channel, prompt, cron_expression, timezone, next_run_at, enabled, is_recurring, created_at, updated_at)
        VALUES ('test-empty-tz', '+1234567890', 'sms', 'test', '0 9 * * *', '', 1000, 1, 1, 1000, 1000)
      `).run();

      expect(() => getJobById(db, 'test-empty-tz')).toThrow(/Corrupt scheduled_jobs row/);
    });

    it('correctly maps valid rows without throwing', () => {
      const job = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Valid prompt',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        nextRunAt: 1000,
        isRecurring: true,
      });

      const retrieved = getJobById(db, job.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(job.id);
      expect(retrieved!.enabled).toBe(true);
    });
  });
});
