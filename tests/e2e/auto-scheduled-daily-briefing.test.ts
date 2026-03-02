import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import config from '../../src/config.js';
import { seedGoogleCredentials } from './mocks/google.js';
import { getSentMessages, clearSentMessages } from './mocks/twilio.js';
import { getUserConfigStore } from '../../src/services/user-config/index.js';
import { initFilesystemSkills } from '../../src/domains/skills/runtime/index.js';
import { initScheduler, stopScheduler } from '../../src/domains/scheduler/runtime/index.js';
import { reconcileAutoScheduledSkillsForUser } from '../../src/domains/scheduler/service/auto-schedule.js';
import { getJobByPhoneAndSkillName } from '../../src/domains/scheduler/repo/sqlite.js';
import { executeJob } from '../../src/domains/scheduler/service/executor.js';
import { listEmails, getEmail } from '../../src/domains/email/providers/gmail.js';
import { listEvents } from '../../src/domains/calendar/providers/google-calendar.js';
import { judge } from './judge.js';
import { writeTestReport } from './reporter.js';
import type { Email, EmailDetail } from '../../src/domains/email/types.js';
import type { CalendarEvent } from '../../src/domains/calendar/types.js';
import type { ConversationMessage } from '../../src/services/conversation/types.js';

const hasApiKey = process.env.ANTHROPIC_API_KEY
  && process.env.ANTHROPIC_API_KEY !== 'test-api-key';
const itWithApiKey = hasApiKey ? it : it.skip;

describe('E2E auto-scheduled skills', () => {
  const phoneNumber = '+15551234567';
  const timezone = 'America/Los_Angeles';
  let db: Database.Database;

  beforeAll(async () => {
    initFilesystemSkills();

    db = new Database(config.credentials.sqlitePath);
    initScheduler(db, 60_000, []);

    await seedGoogleCredentials(phoneNumber);
    const userConfigStore = getUserConfigStore();
    await userConfigStore.set(phoneNumber, { timezone });
  });

  afterAll(async () => {
    await stopScheduler();
    db.close();
  });

  beforeEach(() => {
    clearSentMessages();
    vi.mocked(listEmails).mockClear();
    vi.mocked(getEmail).mockClear();
    vi.mocked(listEvents).mockClear();
  });

  it('creates a single daily-briefing job at 6:30 AM local time and keeps it idempotent', () => {
    const first = reconcileAutoScheduledSkillsForUser(db, phoneNumber, 'whatsapp');
    const second = reconcileAutoScheduledSkillsForUser(db, phoneNumber, 'whatsapp');

    const job = getJobByPhoneAndSkillName(db, phoneNumber, 'daily-briefing');
    const rowCount = db.prepare(
      `SELECT COUNT(*) as count FROM scheduled_jobs WHERE phone_number = ? AND skill_name = ?`
    ).get(phoneNumber, 'daily-briefing') as { count: number };

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(rowCount.count).toBe(1);
    expect(job).not.toBeNull();
    expect(job?.channel).toBe('whatsapp');
    expect(job?.cronExpression).toBe('30 6 * * *');

    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).format(new Date((job?.nextRunAt ?? 0) * 1000));

    expect(time).toBe('06:30');
  });

  itWithApiKey('executes daily-briefing skill through the LLM with mocked email/calendar tools', async () => {
    const emails: Email[] = [
      {
        id: 'email-1',
        threadId: 'thread-1',
        from: 'ceo@example.com',
        subject: 'Action needed ALPHA-7842',
        snippet: 'Please review the launch checklist by tomorrow.',
        date: new Date().toISOString(),
        isUnread: true,
      },
      {
        id: 'email-2',
        threadId: 'thread-2',
        from: 'ops@example.com',
        subject: 'Weekly ops digest BETA-913',
        snippet: 'Deployment windows for this week.',
        date: new Date().toISOString(),
        isUnread: false,
      },
    ];
    const emailDetailsById: Record<string, EmailDetail> = {
      'email-1': {
        ...emails[0],
        body: 'ALPHA-7842 deadline is Tuesday 5 PM PT. Owner: Adi.',
      },
      'email-2': {
        ...emails[1],
        body: 'BETA-913 maintenance is Thursday 8 AM PT.',
      },
    };
    const events: CalendarEvent[] = [
      {
        id: 'event-1',
        title: 'Product Launch Review GAMMA-441',
        start: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
        location: 'HQ Room 3',
      },
      {
        id: 'event-2',
        title: 'Engineering Planning DELTA-220',
        start: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString(),
      },
    ];

    vi.mocked(listEmails).mockResolvedValue(emails);
    vi.mocked(getEmail).mockImplementation(async (_phone, id) => emailDetailsById[id] ?? null);
    vi.mocked(listEvents).mockResolvedValue(events);

    reconcileAutoScheduledSkillsForUser(db, phoneNumber, 'whatsapp');
    const job = getJobByPhoneAndSkillName(db, phoneNumber, 'daily-briefing');
    expect(job).not.toBeNull();
    if (!job) {
      throw new Error('daily-briefing job missing');
    }

    const result = await executeJob(db, job, []);
    expect(result.success).toBe(true);

    expect(listEmails).toHaveBeenCalled();
    expect(getEmail).toHaveBeenCalled();
    expect(listEvents).toHaveBeenCalled();

    const sentMessages = getSentMessages();
    expect(sentMessages.length).toBe(1);
    const outbound = sentMessages[0];
    expect(outbound.to).toBe(`whatsapp:${phoneNumber}`);
    expect(outbound.body).not.toContain('I hit an error');
    expect(outbound.body).toContain('Email Summary');
    expect(outbound.body).toContain('Calendar (Next 7 Days)');
    expect(outbound.body).toMatch(/ALPHA-7842|BETA-913/);
    expect(outbound.body).toMatch(/GAMMA-441|DELTA-220/);

    const timestamp = Date.now();
    const transcript: ConversationMessage[] = [
      {
        id: 'scheduled-user-1',
        phoneNumber,
        role: 'user',
        content: 'Generate my daily briefing for this morning.',
        channel: 'whatsapp',
        createdAt: timestamp - 1_000,
        memoryProcessed: true,
      },
      {
        id: 'scheduled-assistant-1',
        phoneNumber,
        role: 'assistant',
        content: outbound.body,
        channel: 'whatsapp',
        createdAt: timestamp,
        memoryProcessed: true,
      },
    ];

    const verdict = await judge({
      messages: transcript,
      instructions: `This scenario validates a scheduled "daily briefing" response generated from mocked email/calendar tools.
Prioritize whether the final summary is useful for a morning digest: concise, scannable, and focused on important actions and upcoming events.
Do not require exact phrasing; evaluate semantic correctness and practical usefulness.`,
      criteria: [
        'The response includes a meaningful email summary section that highlights important updates from the mocked data.',
        'The response includes a meaningful 7-day calendar summary section reflecting upcoming mocked events.',
        'The response is concise and mobile-friendly, not an unstructured wall of text.',
        'The response does not ask unnecessary follow-up questions.',
      ],
    });

    const reportPath = writeTestReport({
      testName: 'auto-scheduled-daily-briefing',
      turns: [{
        userMessage: '[Scheduled] Generate my daily briefing for this morning.',
        response: { syncResponse: '', asyncResponse: outbound.body, finalResponse: outbound.body },
      }],
      verdict,
    });
    console.log(`\n📄 Report: ${reportPath}\n`);

    expect(verdict.overall).toBe('PASS');
  }, 90_000);
});
