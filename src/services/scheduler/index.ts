/**
 * @fileoverview Scheduler service exports.
 *
 * Provides scheduled job functionality including:
 * - Database CRUD operations
 * - Natural language schedule parsing
 * - Job execution
 * - Polling mechanism
 */

export * from './types.js';
export * from './sqlite.js';
export * from './parser.js';
export * from './executor.js';
export * from './poller.js';

import type Database from 'better-sqlite3';
import { getDueJobs, initSchedulerDb } from './sqlite.js';
import { executeJob } from './executor.js';
import { createIntervalPoller, type Poller } from './poller.js';

let pollerInstance: Poller | null = null;

/**
 * Initialize the scheduler system.
 *
 * - Creates database tables if needed
 * - Sets up the polling loop
 *
 * @param db - Database connection
 * @param intervalMs - Polling interval (default: 60000ms = 1 minute)
 */
export function initScheduler(db: Database.Database, intervalMs?: number): Poller {
  // Initialize database schema
  initSchedulerDb(db);

  // Create the job runner function
  async function runDueJobs(): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const dueJobs = getDueJobs(db, nowSeconds);

    if (dueJobs.length === 0) {
      return;
    }

    console.log(JSON.stringify({
      event: 'scheduler_found_due_jobs',
      count: dueJobs.length,
      timestamp: new Date().toISOString(),
    }));

    // Execute jobs sequentially to avoid overwhelming resources
    for (const job of dueJobs) {
      await executeJob(db, job);
    }
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
 */
export function stopScheduler(): void {
  if (pollerInstance) {
    pollerInstance.stop();
    pollerInstance = null;
  }
}
