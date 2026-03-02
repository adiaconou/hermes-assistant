/**
 * @fileoverview Auto-scheduled skill reconciliation for the scheduler.
 *
 * Reconciles scheduler jobs from skill metadata so core scheduled skills can be
 * configured declaratively in SKILL.md.
 */

import { Cron } from 'croner';
import type Database from 'better-sqlite3';
import config from '../../../config.js';
import { listFilesystemSkills } from '../providers/skills.js';
import { createJob, getJobByPhoneAndSkillName, updateJob } from '../repo/sqlite.js';
import type { MessageChannel } from '../types.js';

type ReconcileResult = {
  created: number;
  updated: number;
  skipped: number;
};

type UserRow = {
  phone_number: string;
  timezone: string;
};

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1
  `).get(tableName) as { 1: number } | undefined;
  return !!row;
}

function getNextRunAt(cronExpression: string, timezone: string): number | null {
  try {
    const cron = new Cron(cronExpression, { timezone });
    const nextRun = cron.nextRun();
    if (!nextRun) {
      return null;
    }
    return Math.floor(nextRun.getTime() / 1000);
  } catch {
    return null;
  }
}

function getEligibleUsers(db: Database.Database): UserRow[] {
  if (!hasTable(db, 'user_config')) {
    return [];
  }

  if (!hasTable(db, 'credentials')) {
    return db.prepare(`
      SELECT uc.phone_number, uc.timezone
      FROM user_config uc
      WHERE uc.timezone IS NOT NULL AND uc.timezone != ''
    `).all() as UserRow[];
  }

  return db.prepare(`
    SELECT uc.phone_number, uc.timezone
    FROM user_config uc
    INNER JOIN credentials c ON c.phone_number = uc.phone_number AND c.provider = 'google'
    WHERE uc.timezone IS NOT NULL AND uc.timezone != ''
  `).all() as UserRow[];
}

function getUserTimezone(db: Database.Database, phoneNumber: string): string | null {
  if (!hasTable(db, 'user_config')) {
    return null;
  }

  const row = db.prepare(`
    SELECT timezone FROM user_config WHERE phone_number = ?
  `).get(phoneNumber) as { timezone: string | null } | undefined;

  if (!row?.timezone || !row.timezone.trim()) {
    return null;
  }
  return row.timezone;
}

function hasGoogleCredentials(db: Database.Database, phoneNumber: string): boolean {
  if (!hasTable(db, 'credentials')) {
    // In-memory credential provider does not persist to SQLite.
    return true;
  }

  const row = db.prepare(`
    SELECT 1
    FROM credentials
    WHERE phone_number = ? AND provider = 'google'
    LIMIT 1
  `).get(phoneNumber) as { 1: number } | undefined;

  return !!row;
}

function getAutoScheduledSkills() {
  return listFilesystemSkills().filter((skill) =>
    skill.enabled
    && skill.channels.includes('scheduler')
    && skill.autoSchedule?.enabled === true
    && skill.autoSchedule.cron.length > 0
    && skill.autoSchedule.prompt.length > 0
  );
}

/**
 * Reconcile auto-scheduled skills for one user.
 */
export function reconcileAutoScheduledSkillsForUser(
  db: Database.Database,
  phoneNumber: string,
  channel: MessageChannel = 'sms'
): ReconcileResult {
  if (!config.autoSchedule.enabled) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const timezone = getUserTimezone(db, phoneNumber);
  if (!timezone) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  if (!hasGoogleCredentials(db, phoneNumber)) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const skills = getAutoScheduledSkills();
  const summary: ReconcileResult = { created: 0, updated: 0, skipped: 0 };

  for (const skill of skills) {
    const autoSchedule = skill.autoSchedule!;
    const nextRunAt = getNextRunAt(autoSchedule.cron, timezone);
    if (!nextRunAt) {
      summary.skipped += 1;
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Skipping auto-scheduled skill due to invalid cron',
        phone: phoneNumber.slice(-4).padStart(phoneNumber.length, '*'),
        skill: skill.name,
        cronExpression: autoSchedule.cron,
        timezone,
        timestamp: new Date().toISOString(),
      }));
      continue;
    }

    const existing = getJobByPhoneAndSkillName(db, phoneNumber, skill.name);
    if (!existing) {
      createJob(db, {
        phoneNumber,
        channel,
        userRequest: `Auto-scheduled skill: ${skill.name}`,
        prompt: autoSchedule.prompt,
        skillName: skill.name,
        cronExpression: autoSchedule.cron,
        timezone,
        nextRunAt,
        isRecurring: true,
      });
      summary.created += 1;
      continue;
    }

    const needsUpdate =
      existing.channel !== channel
      || existing.prompt !== autoSchedule.prompt
      || existing.cronExpression !== autoSchedule.cron
      || existing.timezone !== timezone
      || !existing.enabled
      || !existing.isRecurring;

    if (!needsUpdate) {
      summary.skipped += 1;
      continue;
    }

    updateJob(db, existing.id, {
      channel,
      prompt: autoSchedule.prompt,
      cronExpression: autoSchedule.cron,
      timezone,
      nextRunAt,
      enabled: true,
    });
    summary.updated += 1;
  }

  return summary;
}

/**
 * Reconcile auto-scheduled skills for all eligible users.
 */
export function reconcileAutoScheduledSkills(
  db: Database.Database,
  defaultChannel: MessageChannel = 'sms'
): ReconcileResult & { usersProcessed: number } {
  if (!config.autoSchedule.enabled) {
    return {
      usersProcessed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
    };
  }

  const users = getEligibleUsers(db);
  const total: ReconcileResult & { usersProcessed: number } = {
    usersProcessed: users.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  for (const user of users) {
    const result = reconcileAutoScheduledSkillsForUser(db, user.phone_number, defaultChannel);
    total.created += result.created;
    total.updated += result.updated;
    total.skipped += result.skipped;
  }

  return total;
}
