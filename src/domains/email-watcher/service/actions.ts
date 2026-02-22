/**
 * @fileoverview Filesystem-skill execution and notification throttle for email watcher.
 */

import { getUserConfigStore } from '../../../services/user-config/index.js';
import { getMemoryStore } from '../providers/memory.js';
import { executeFilesystemSkillByName } from '../providers/skills.js';
import { sendSms } from '../../../twilio.js';
import config from '../../../config.js';
import type { ClassificationResult, ThrottleState } from '../types.js';
import type { AgentExecutionContext } from '../../../executor/types.js';

/** Per-user notification throttle state */
const throttleMap = new Map<string, ThrottleState>();

/**
 * Check if a notification can be sent to this user within the hourly limit.
 * Automatically resets the window after one hour.
 */
function canSendNotification(phoneNumber: string): boolean {
  const state = throttleMap.get(phoneNumber);
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;

  if (!state || now - state.windowStart > windowMs) {
    throttleMap.set(phoneNumber, { count: 1, windowStart: now });
    return true;
  }

  if (state.count >= config.emailWatcher.maxNotificationsPerHour) {
    return false;
  }

  state.count++;
  return true;
}

function buildSkillInput(classification: ClassificationResult): string {
  return `<email>
from: ${classification.email.from}
subject: ${classification.email.subject}
date: ${classification.email.date}
messageId: ${classification.email.messageId}
</email>

<email_body>
${classification.email.body}
</email_body>`;
}

/**
 * Execute matched filesystem skills for classified emails and notify user.
 */
export async function executeSkillActions(
  phoneNumber: string,
  classifications: ClassificationResult[]
): Promise<void> {
  for (const classification of classifications) {
    if (classification.matches.length === 0) continue;

    const context = await buildMinimalContext(phoneNumber);
    const notificationParts: string[] = [];

    for (const match of classification.matches) {
      const result = await executeFilesystemSkillByName(
        match.skill,
        buildSkillInput(classification),
        context,
        'email'
      );

      if (result.success && typeof result.output === 'string' && result.output.trim().length > 0) {
        notificationParts.push(result.output);
        continue;
      }

      if (match.summary) {
        notificationParts.push(match.summary);
      }

      if (!result.success && result.error) {
        console.warn(JSON.stringify({
          level: 'warn',
          message: 'Email watcher skill execution failed',
          skill: match.skill,
          error: result.error,
          timestamp: new Date().toISOString(),
        }));
      }
    }

    if (notificationParts.length > 0 && canSendNotification(phoneNumber)) {
      const emailSubject = classification.email.subject || '(no subject)';
      const emailFrom = classification.email.from || 'Unknown sender';
      const body = `Email from ${emailFrom}: "${emailSubject}"\n\n${notificationParts.join('\n\n')}`;

      try {
        await sendSms(phoneNumber, body);
      } catch (err) {
        console.log(JSON.stringify({
          level: 'error',
          message: 'Failed to send email watcher notification',
          phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }));
      }
    }
  }
}

/**
 * Build a minimal AgentExecutionContext for email watcher skill execution.
 */
async function buildMinimalContext(
  phoneNumber: string
): Promise<AgentExecutionContext> {
  const userConfigStore = getUserConfigStore();
  const userConfig = await userConfigStore.get(phoneNumber) ?? null;
  const facts = await getMemoryStore().getFacts(phoneNumber);

  return {
    phoneNumber,
    channel: 'sms',
    userConfig,
    userFacts: facts,
    previousStepResults: {},
  };
}
