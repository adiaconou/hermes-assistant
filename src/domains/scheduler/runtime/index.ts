/**
 * @fileoverview Scheduler domain runtime entry point.
 *
 * Provides scheduled job functionality including:
 * - Database CRUD operations
 * - Natural language schedule parsing
 * - Job execution
 * - Polling mechanism
 */

// Re-export all domain public API
export * from '../types.js';
export * from '../repo/sqlite.js';
export * from '../service/parser.js';
export * from '../service/executor.js';
export { createIntervalPoller, type Poller } from '../../../utils/poller.js';

import type Database from 'better-sqlite3';
import { getDueJobs, initSchedulerDb } from '../repo/sqlite.js';
import { executeJob } from '../service/executor.js';
import { createIntervalPoller, type Poller } from '../../../utils/poller.js';
import { createLogger, createRunId, redactPhone, withLogContext } from '../../../utils/observability/index.js';

let pollerInstance: Poller | null = null;
let sharedDb: Database.Database | null = null;
const log = createLogger({ domain: 'scheduler-runtime' });

/**
 * Get the shared scheduler database instance.
 * Must call initScheduler() first.
 */
export function getSchedulerDb(): Database.Database {
  if (!sharedDb) {
    throw new Error('Scheduler not initialized. Call initScheduler() first.');
  }
  return sharedDb;
}

/**
 * Initialize the scheduler system.
 *
 * - Creates database tables if needed
 * - Sets up the polling loop
 *
 * @param db - Database connection
 * @param intervalMs - Polling interval (default: 60000ms = 1 minute)
 */
export function initScheduler(
  db: Database.Database,
  intervalMs?: number,
  readOnlyToolNames: string[] = []
): Poller {
  // Store shared database instance
  sharedDb = db;

  // Initialize database schema
  initSchedulerDb(db);

  // Create the job runner function
  async function runDueJobs(): Promise<void> {
    const runId = createRunId('scheduler');
    await withLogContext({ runId }, async () => {
      const startedAt = Date.now();
      const nowSeconds = Math.floor(Date.now() / 1000);
      const dueJobs = getDueJobs(db, nowSeconds);

      log.info('run_started', { dueJobCount: dueJobs.length });

      if (dueJobs.length === 0) {
        log.debug('run_no_work', { durationMs: Date.now() - startedAt });
        return;
      }

      // Execute jobs sequentially to avoid overwhelming resources
      for (const job of dueJobs) {
        log.info('job_dispatch', {
          jobId: job.id,
          channel: job.channel,
          phone: redactPhone(job.phoneNumber),
          isRecurring: job.isRecurring,
        });
        await executeJob(db, job, readOnlyToolNames);
      }

      log.info('run_completed', {
        dueJobCount: dueJobs.length,
        durationMs: Date.now() - startedAt,
      });
    });
  }

  // Create and return the poller
  pollerInstance = createIntervalPoller(runDueJobs, intervalMs);
  return pollerInstance;
}

/**
 * Get the current poller instance.
 * Returns null if scheduler not initialized.
 */
export function getSchedulerPoller(): Poller | null {
  return pollerInstance;
}

/**
 * Stop the scheduler and clean up.
 * Waits for any in-flight job execution to complete.
 */
export async function stopScheduler(): Promise<void> {
  if (pollerInstance) {
    await pollerInstance.stop();
    pollerInstance = null;
  }
}
