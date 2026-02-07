/**
 * @fileoverview Action router and notification throttle for email watcher.
 *
 * Processes classification results by either executing tool-based actions
 * via the agent executor or sending notification summaries via SMS.
 * Includes per-user notification throttling.
 */

import { executeWithTools } from '../../executor/tool-executor.js';
import { getEmailSkillStore } from './sqlite.js';
import { getUserConfigStore } from '../user-config/index.js';
import { getMemoryStore } from '../memory/index.js';
import { sendSms } from '../../twilio.js';
import config from '../../config.js';
import type { ClassificationResult, SkillMatch, ThrottleState } from './types.js';
import type { AgentExecutionContext } from '../../executor/types.js';

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

/**
 * Execute skill actions for all classified emails.
 *
 * For execute_with_tools skills: runs the agent executor with the skill's
 * tools and action prompt, then collects a summary for notification.
 * For notify skills: collects the match summary directly.
 * Merged notifications per email are sent via SMS if within throttle limits.
 */
export async function executeSkillActions(
  phoneNumber: string,
  classifications: ClassificationResult[]
): Promise<void> {
  const skillStore = getEmailSkillStore();
  const allSkills = skillStore.getSkillsForUser(phoneNumber, true);
  const skillMap = new Map(allSkills.map(s => [s.name, s]));

  for (const classification of classifications) {
    if (classification.matches.length === 0) continue;

    const notificationParts: string[] = [];

    for (const match of classification.matches) {
      const skill = skillMap.get(match.skill);
      if (!skill) continue;

      if (skill.actionType === 'execute_with_tools') {
        const summary = await executeToolAction(phoneNumber, skill.name, skill.actionPrompt, skill.tools, match, classification);
        if (summary) {
          notificationParts.push(summary);
        }
      } else {
        // notify action — use the match summary directly
        notificationParts.push(match.summary);
      }
    }

    // Send merged notification for this email
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
 * Execute a tool-based skill action and return a summary string.
 */
async function executeToolAction(
  phoneNumber: string,
  skillName: string,
  actionPrompt: string,
  tools: string[],
  match: SkillMatch,
  classification: ClassificationResult
): Promise<string | null> {
  const task = `${actionPrompt}\n\n<extracted_data>${JSON.stringify(match.extracted)}</extracted_data>\n\n<email_metadata>${JSON.stringify({
    from: classification.email.from,
    subject: classification.email.subject,
    date: classification.email.date,
    messageId: classification.email.messageId,
  })}</email_metadata>`;

  const systemPrompt = `You are an email automation agent executing a skill called "${skillName}".
Use the provided tools to complete the action described in the task.
Be concise and efficient. Return a brief summary of what you did.`;

  const context = await buildMinimalContext(phoneNumber);

  try {
    const result = await executeWithTools(systemPrompt, task, tools, context);
    if (result.success && result.output) {
      return typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output);
    }
    if (result.error) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Email watcher tool action failed',
        skill: skillName,
        error: result.error,
        timestamp: new Date().toISOString(),
      }));
    }
    return null;
  } catch (err) {
    console.log(JSON.stringify({
      level: 'error',
      message: 'Email watcher tool action threw',
      skill: skillName,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    }));
    return null;
  }
}

/**
 * Build a minimal AgentExecutionContext for email watcher actions.
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
