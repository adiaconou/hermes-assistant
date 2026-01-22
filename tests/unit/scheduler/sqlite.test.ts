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
} from '../../../src/services/scheduler/sqlite.js';

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
    it('creates a job and returns it with generated ID', () => {
      const job = createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        userRequest: 'Send me a daily summary',
        prompt: 'Generate a summary of today',
        cronExpression: '0 9 * * *',
        timezone: 'America/New_York',
        nextRunAt: Math.floor(Date.now() / 1000) + 3600,
      });

      expect(job.id).toBeDefined();
      expect(job.id).toHaveLength(36); // UUID length
      expect(job.phoneNumber).toBe('+1234567890');
      expect(job.userRequest).toBe('Send me a daily summary');
      expect(job.prompt).toBe('Generate a summary of today');
      expect(job.cronExpression).toBe('0 9 * * *');
      expect(job.timezone).toBe('America/New_York');
      expect(job.enabled).toBe(true);
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
      });

      const retrieved = getJobById(db, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.prompt).toBe('Test prompt');
    });

    it('returns null for non-existent ID', () => {
      const result = getJobById(db, 'non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getJobsByPhone', () => {
    it('gets jobs by phone number', () => {
      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Job 1',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
        nextRunAt: Math.floor(Date.now() / 1000) + 3600,
      });

      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Job 2',
        cronExpression: '0 10 * * *',
        timezone: 'UTC',
        nextRunAt: Math.floor(Date.now() / 1000) + 7200,
      });

      createJob(db, {
        phoneNumber: '+9999999999',
        channel: 'whatsapp',
        prompt: 'Other user job',
        cronExpression: '0 11 * * *',
        timezone: 'UTC',
        nextRunAt: Math.floor(Date.now() / 1000) + 10800,
      });

      const jobs = getJobsByPhone(db, '+1234567890');

      expect(jobs).toHaveLength(2);
      expect(jobs.map((j) => j.prompt)).toContain('Job 1');
      expect(jobs.map((j) => j.prompt)).toContain('Job 2');
    });

    it('returns empty array when no jobs for phone', () => {
      const jobs = getJobsByPhone(db, '+9999999999');
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
      });

      // Future job
      createJob(db, {
        phoneNumber: '+1234567890',
        channel: 'sms',
        prompt: 'Future job',
        cronExpression: '0 10 * * *',
        timezone: 'UTC',
        nextRunAt: now + 3600, // 1 hour from now
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
      });

      const updated = updateJob(db, job.id, {
        enabled: false,
        nextRunAt: 2000,
        prompt: 'Updated prompt',
      });

      expect(updated?.enabled).toBe(false);
      expect(updated?.nextRunAt).toBe(2000);
      expect(updated?.prompt).toBe('Updated prompt');
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
});
