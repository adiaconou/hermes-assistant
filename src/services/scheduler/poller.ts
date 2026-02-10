/**
 * @fileoverview Polling abstraction for scheduled jobs.
 *
 * Provides a simple interface for triggering job execution.
 * Initially uses setInterval, but abstracted for future extensibility
 * (Railway cron, external webhooks, etc).
 */

/**
 * Interface for job polling implementations.
 */
export interface Poller {
  /** Start the polling loop */
  start(): void;
  /** Stop the polling loop and wait for any in-flight operation to complete */
  stop(): Promise<void>;
  /** Check if the poller is running */
  isRunning(): boolean;
}

/**
 * Create an interval-based poller.
 *
 * @param runDueJobs - Function to call on each interval
 * @param intervalMs - Polling interval in milliseconds (default: 60000 = 1 minute)
 */
export function createIntervalPoller(
  runDueJobs: () => Promise<void>,
  intervalMs: number = 60000
): Poller {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isProcessing = false;

  return {
    start(): void {
      if (intervalId !== null) {
        console.log(JSON.stringify({
          event: 'poller_already_running',
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      console.log(JSON.stringify({
        event: 'poller_started',
        intervalMs,
        timestamp: new Date().toISOString(),
      }));

      // Run immediately on start, then on interval
      void runDueJobsSafe();

      intervalId = setInterval(() => {
        void runDueJobsSafe();
      }, intervalMs);
    },

    async stop(): Promise<void> {
      if (intervalId === null) {
        return;
      }

      clearInterval(intervalId);
      intervalId = null;

      // Wait for any in-flight operation to complete
      while (isProcessing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(JSON.stringify({
        event: 'poller_stopped',
        timestamp: new Date().toISOString(),
      }));
    },

    isRunning(): boolean {
      return intervalId !== null;
    },
  };

  /**
   * Wrapper to prevent overlapping executions and catch errors.
   */
  async function runDueJobsSafe(): Promise<void> {
    if (isProcessing) {
      console.log(JSON.stringify({
        event: 'poller_skip_overlap',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    isProcessing = true;
    try {
      await runDueJobs();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'poller_error',
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      }));
    } finally {
      isProcessing = false;
    }
  }
}
