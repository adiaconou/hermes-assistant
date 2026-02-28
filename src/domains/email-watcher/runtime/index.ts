/**
 * @fileoverview Email watcher service lifecycle.
 *
 * Polls for new emails across all enabled users, classifies them
 * against active skills, and executes matching actions.
 *
 * Uses the same createIntervalPoller() abstraction as the scheduler
 * and memory processor.
 */

import config from '../../../config.js';
import { createIntervalPoller, type Poller } from '../../../utils/poller.js';
import { getUserConfigStore } from '../../../services/user-config/index.js';
import { syncNewEmails } from '../providers/gmail-sync.js';
import { classifyEmails } from '../service/classifier.js';
import { executeSkillActions } from '../service/actions.js';
import { createLogger, createRunId, redactPhone, withLogContext } from '../../../utils/observability/index.js';

// Re-export domain public API
export { classifyEmails } from '../service/classifier.js';
export { syncNewEmails, prepareEmailForClassification } from '../providers/gmail-sync.js';
export { executeSkillActions } from '../service/actions.js';
export { initEmailWatcherState } from '../service/skills.js';
export { setEmailWatcherExecuteWithTools } from '../providers/executor.js';
export type * from '../types.js';

let poller: Poller | null = null;
const log = createLogger({ domain: 'email-watcher-runtime' });

/**
 * Start the email watcher background service.
 *
 * Polls Gmail for new emails at the configured interval,
 * classifies them against active skills, and executes actions.
 */
export function startEmailWatcher(): void {
  if (!config.emailWatcher.enabled) {
    log.info('watcher_disabled');
    return;
  }

  if (poller) {
    log.info('watcher_already_running');
    return;
  }

  poller = createIntervalPoller(async () => {
    const runId = createRunId('emailwatch');
    await withLogContext({ runId }, async () => {
      const startedAt = Date.now();
      const userConfigStore = getUserConfigStore();
      const users = await userConfigStore.getEmailWatcherUsers();

      log.info('run_started', { usersConfigured: users.length });

      if (users.length === 0) {
        log.debug('run_no_work', { durationMs: Date.now() - startedAt });
        return;
      }

      let totalEmails = 0;
      let totalMatches = 0;
      let usersWithSyncedEmails = 0;

      for (const user of users) {
        const userLog = log.child({ phone: redactPhone(user.phoneNumber) });
        try {
          // Phase 1: Sync new emails
          const emails = await syncNewEmails(user.phoneNumber);
          if (emails.length === 0) {
            userLog.debug('user_no_new_emails');
            continue;
          }

          usersWithSyncedEmails += 1;
          totalEmails += emails.length;

          // Phase 2: Classify
          const classifications = await classifyEmails(user.phoneNumber, emails);
          const matched = classifications.filter(c => c.matches.length > 0);
          totalMatches += matched.length;

          // Phase 3: Execute actions
          if (matched.length > 0) {
            await executeSkillActions(user.phoneNumber, matched);
          }

          userLog.info('user_cycle_completed', {
            emailsSynced: emails.length,
            emailsMatched: matched.length,
          });
        } catch (err) {
          userLog.error('user_cycle_failed', {
            error: err instanceof Error ? err : String(err),
          });
        }
      }

      log.info('run_completed', {
        usersConfigured: users.length,
        usersWithSyncedEmails,
        totalEmails,
        totalMatches,
        durationMs: Date.now() - startedAt,
      });
    });
  }, config.emailWatcher.intervalMs);

  poller.start();

  log.info('watcher_started', {
    intervalMs: config.emailWatcher.intervalMs,
  });
}

/**
 * Stop the email watcher background service.
 * Waits for any in-flight email processing to complete.
 */
export async function stopEmailWatcher(): Promise<void> {
  if (poller) {
    await poller.stop();
    poller = null;
    log.info('watcher_stopped');
  }
}
