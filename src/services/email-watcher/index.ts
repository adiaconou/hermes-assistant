/**
 * @fileoverview Email watcher service lifecycle.
 *
 * Polls for new emails across all enabled users, classifies them
 * against active skills, and executes matching actions.
 *
 * Uses the same createIntervalPoller() abstraction as the scheduler
 * and memory processor.
 */

import config from '../../config.js';
import { createIntervalPoller, type Poller } from '../scheduler/poller.js';
import { getUserConfigStore } from '../user-config/index.js';
import { syncNewEmails } from './sync.js';
import { classifyEmails } from './classifier.js';
import { executeSkillActions } from './actions.js';

let poller: Poller | null = null;

/**
 * Start the email watcher background service.
 *
 * Polls Gmail for new emails at the configured interval,
 * classifies them against active skills, and executes actions.
 */
export function startEmailWatcher(): void {
  if (!config.emailWatcher.enabled) {
    console.log(JSON.stringify({
      event: 'email_watcher_disabled',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if (poller) {
    console.log(JSON.stringify({
      event: 'email_watcher_already_running',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  poller = createIntervalPoller(async () => {
    const userConfigStore = getUserConfigStore();
    const users = await userConfigStore.getEmailWatcherUsers();

    if (users.length === 0) {
      return;
    }

    let totalEmails = 0;
    let totalMatches = 0;

    for (const user of users) {
      try {
        // Phase 1: Sync new emails
        const emails = await syncNewEmails(user.phoneNumber);
        if (emails.length === 0) continue;

        totalEmails += emails.length;

        // Phase 2: Classify
        const classifications = await classifyEmails(user.phoneNumber, emails);
        const matched = classifications.filter(c => c.matches.length > 0);
        totalMatches += matched.length;

        // Phase 3: Execute actions
        if (matched.length > 0) {
          await executeSkillActions(user.phoneNumber, matched);
        }

        console.log(JSON.stringify({
          event: 'email_watcher_user_cycle',
          phone: user.phoneNumber.slice(-4).padStart(user.phoneNumber.length, '*'),
          emailsSynced: emails.length,
          emailsMatched: matched.length,
          timestamp: new Date().toISOString(),
        }));
      } catch (err) {
        console.log(JSON.stringify({
          event: 'email_watcher_user_error',
          phone: user.phoneNumber.slice(-4).padStart(user.phoneNumber.length, '*'),
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }));
      }
    }

    if (totalEmails > 0) {
      console.log(JSON.stringify({
        event: 'email_watcher_cycle_complete',
        usersProcessed: users.length,
        totalEmails,
        totalMatches,
        timestamp: new Date().toISOString(),
      }));
    }
  }, config.emailWatcher.intervalMs);

  poller.start();

  console.log(JSON.stringify({
    event: 'email_watcher_started',
    intervalMs: config.emailWatcher.intervalMs,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Stop the email watcher background service.
 */
export function stopEmailWatcher(): void {
  if (poller) {
    poller.stop();
    poller = null;
    console.log(JSON.stringify({
      event: 'email_watcher_stopped',
      timestamp: new Date().toISOString(),
    }));
  }
}
