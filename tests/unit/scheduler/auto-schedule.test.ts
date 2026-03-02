import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { initSchedulerDb, getJobByPhoneAndSkillName } from '../../../src/domains/scheduler/repo/sqlite.js';
import {
  reconcileAutoScheduledSkills,
  reconcileAutoScheduledSkillsForUser,
} from '../../../src/domains/scheduler/service/auto-schedule.js';
import type { LoadedSkill } from '../../../src/domains/skills/types.js';
import { listFilesystemSkills } from '../../../src/domains/scheduler/providers/skills.js';

vi.mock('../../../src/domains/scheduler/providers/skills.js', () => ({
  listFilesystemSkills: vi.fn(),
}));

const TEST_DB_PATH = './data/test-auto-schedule.db';

function buildSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name: 'daily-briefing',
    description: 'Daily summary',
    markdownPath: '/skills/daily-briefing/SKILL.md',
    rootDir: '/skills/daily-briefing',
    channels: ['scheduler'],
    tools: ['get_emails', 'read_email', 'get_calendar_events'],
    matchHints: [],
    enabled: true,
    source: 'bundled',
    delegateAgent: null,
    autoSchedule: {
      enabled: true,
      cron: '30 6 * * *',
      prompt: 'Generate my daily briefing.',
    },
    ...overrides,
  };
}

describe('auto-schedule reconciliation', () => {
  let db: Database.Database;

  beforeEach(() => {
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    db = new Database(TEST_DB_PATH);
    initSchedulerDb(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_config (
        phone_number TEXT PRIMARY KEY,
        timezone TEXT
      );
      CREATE TABLE IF NOT EXISTS credentials (
        phone_number TEXT NOT NULL,
        provider TEXT NOT NULL,
        encrypted_data TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (phone_number, provider)
      );
    `);

    db.prepare(`INSERT INTO user_config (phone_number, timezone) VALUES (?, ?)`)
      .run('+15551234567', 'America/Los_Angeles');
    db.prepare(`INSERT INTO credentials (phone_number, provider, encrypted_data, created_at, updated_at) VALUES (?, 'google', 'x', 0, 0)`)
      .run('+15551234567');

    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it('creates an auto-scheduled job for an eligible user', () => {
    vi.mocked(listFilesystemSkills).mockReturnValue([buildSkill()]);

    const result = reconcileAutoScheduledSkillsForUser(db, '+15551234567', 'whatsapp');
    const job = getJobByPhoneAndSkillName(db, '+15551234567', 'daily-briefing');

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(job).not.toBeNull();
    expect(job?.channel).toBe('whatsapp');
    expect(job?.cronExpression).toBe('30 6 * * *');
    expect(job?.skillName).toBe('daily-briefing');
    expect(job?.enabled).toBe(true);
  });

  it('is idempotent for existing auto-scheduled job', () => {
    vi.mocked(listFilesystemSkills).mockReturnValue([buildSkill()]);

    const first = reconcileAutoScheduledSkillsForUser(db, '+15551234567', 'sms');
    const second = reconcileAutoScheduledSkillsForUser(db, '+15551234567', 'sms');
    const count = db.prepare(
      `SELECT COUNT(*) as count FROM scheduled_jobs WHERE phone_number = ? AND skill_name = ?`
    ).get('+15551234567', 'daily-briefing') as { count: number };

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(count.count).toBe(1);
  });

  it('reconciles all eligible users', () => {
    vi.mocked(listFilesystemSkills).mockReturnValue([buildSkill()]);

    const result = reconcileAutoScheduledSkills(db);

    expect(result.usersProcessed).toBe(1);
    expect(result.created).toBe(1);
  });
});
