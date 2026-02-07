/**
 * Unit tests for email watcher sync module.
 *
 * Tests prepareEmailForClassification (normalization) and syncNewEmails (Gmail History API).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prepareEmailForClassification } from '../../../../src/services/email-watcher/sync.js';
import type { gmail_v1 } from 'googleapis';

// Mock dependencies for syncNewEmails
vi.mock('../../../../src/services/google/auth.js', () => ({
  getAuthenticatedClient: vi.fn(),
}));

vi.mock('../../../../src/services/user-config/index.js', () => ({
  getUserConfigStore: vi.fn(),
}));

vi.mock('googleapis', () => {
  const mockGmail = {
    users: {
      getProfile: vi.fn(),
      messages: { get: vi.fn() },
      history: { list: vi.fn() },
    },
  };
  return {
    google: {
      gmail: vi.fn(() => mockGmail),
    },
    gmail_v1: {},
  };
});

vi.mock('../../../../src/config.js', () => ({
  default: {
    emailWatcher: {
      batchSize: 20,
      confidenceThreshold: 0.6,
      maxNotificationsPerHour: 10,
    },
  },
}));

/**
 * Helper to create a base64url-encoded string (Gmail API encoding).
 */
function toBase64Url(text: string): string {
  return Buffer.from(text).toString('base64url');
}

/**
 * Helper to build a Gmail message payload.
 */
function buildGmailMessage(opts: {
  id?: string;
  from?: string;
  subject?: string;
  date?: string;
  bodyPlain?: string;
  bodyHtml?: string;
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
}): gmail_v1.Schema$Message {
  const headers = [
    { name: 'From', value: opts.from ?? 'sender@example.com' },
    { name: 'Subject', value: opts.subject ?? 'Test Subject' },
    { name: 'Date', value: opts.date ?? 'Mon, 20 Jan 2025 10:00:00 -0800' },
  ];

  const parts: gmail_v1.Schema$MessagePart[] = [];

  if (opts.bodyPlain !== undefined) {
    parts.push({
      mimeType: 'text/plain',
      filename: '',
      body: { data: toBase64Url(opts.bodyPlain), size: opts.bodyPlain.length },
    });
  }

  if (opts.bodyHtml !== undefined) {
    parts.push({
      mimeType: 'text/html',
      filename: '',
      body: { data: toBase64Url(opts.bodyHtml), size: opts.bodyHtml.length },
    });
  }

  if (opts.attachments) {
    for (const att of opts.attachments) {
      parts.push({
        mimeType: att.mimeType,
        filename: att.filename,
        body: { attachmentId: 'att_id', size: att.size },
      });
    }
  }

  // If only a single body part with no attachments, use simple payload
  if (parts.length === 1 && !opts.attachments?.length) {
    return {
      id: opts.id ?? 'msg_1',
      payload: {
        headers,
        mimeType: parts[0].mimeType!,
        body: parts[0].body,
      },
    };
  }

  // Multipart payload
  return {
    id: opts.id ?? 'msg_1',
    payload: {
      headers,
      mimeType: 'multipart/mixed',
      parts,
    },
  };
}

describe('prepareEmailForClassification', () => {
  it('extracts plain text email', () => {
    const msg = buildGmailMessage({
      id: 'msg_plain',
      from: 'alice@example.com',
      subject: 'Hello',
      bodyPlain: 'This is a test email body.',
    });

    const result = prepareEmailForClassification(msg);

    expect(result.messageId).toBe('msg_plain');
    expect(result.from).toBe('alice@example.com');
    expect(result.subject).toBe('Hello');
    expect(result.body).toBe('This is a test email body.');
  });

  it('strips HTML tags from HTML-only email', () => {
    const msg = buildGmailMessage({
      bodyHtml: '<div><p>Hello <strong>World</strong></p></div>',
    });

    const result = prepareEmailForClassification(msg);

    expect(result.body).toContain('Hello');
    expect(result.body).toContain('World');
    expect(result.body).not.toContain('<div>');
    expect(result.body).not.toContain('<p>');
    expect(result.body).not.toContain('<strong>');
  });

  it('prefers plain text over HTML when both are present', () => {
    const msg = buildGmailMessage({
      bodyPlain: 'Plain text version',
      bodyHtml: '<p>HTML version</p>',
    });

    const result = prepareEmailForClassification(msg);

    expect(result.body).toBe('Plain text version');
  });

  it('returns placeholder for email with no body', () => {
    const msg: gmail_v1.Schema$Message = {
      id: 'msg_nobody',
      payload: {
        headers: [
          { name: 'From', value: 'test@example.com' },
          { name: 'Subject', value: 'Empty' },
          { name: 'Date', value: 'Mon, 20 Jan 2025 10:00:00 -0800' },
        ],
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'application/pdf',
            filename: 'doc.pdf',
            body: { attachmentId: 'att1', size: 1024 },
          },
        ],
      },
    };

    const result = prepareEmailForClassification(msg);

    expect(result.body).toBe('[No body — see attachments]');
  });

  it('extracts attachment metadata', () => {
    const msg = buildGmailMessage({
      bodyPlain: 'See attached files.',
      attachments: [
        { filename: 'invoice.pdf', mimeType: 'application/pdf', size: 50000 },
        { filename: 'photo.jpg', mimeType: 'image/jpeg', size: 200000 },
      ],
    });

    const result = prepareEmailForClassification(msg);

    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0]).toEqual({
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 50000,
    });
    expect(result.attachments[1]).toEqual({
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 200000,
    });
  });

  it('normalizes whitespace', () => {
    const msg = buildGmailMessage({
      bodyPlain: 'Hello    world\r\n\r\nParagraph two\r\n\r\n\r\n\r\nParagraph three',
    });

    const result = prepareEmailForClassification(msg);

    // Consecutive spaces collapsed, \r\n normalized, triple+ newlines collapsed
    expect(result.body).toBe('Hello world\n\nParagraph two\n\nParagraph three');
  });

  it('truncates body at 5000 characters', () => {
    const longBody = 'A'.repeat(6000);
    const msg = buildGmailMessage({
      bodyPlain: longBody,
    });

    const result = prepareEmailForClassification(msg);

    expect(result.body.length).toBe(5000);
  });

  it('strips base64 inline image data', () => {
    const bodyWithInlineImage =
      'Check this image: data:image/png;base64,iVBORw0KGgoAAAANSUhEUg== and more text';
    const msg = buildGmailMessage({
      bodyPlain: bodyWithInlineImage,
    });

    const result = prepareEmailForClassification(msg);

    expect(result.body).not.toContain('iVBORw0KGgo');
    expect(result.body).toContain('[inline image]');
    expect(result.body).toContain('and more text');
  });

  it('handles message with no payload', () => {
    const msg: gmail_v1.Schema$Message = {
      id: 'msg_empty',
    };

    const result = prepareEmailForClassification(msg);

    expect(result.messageId).toBe('msg_empty');
    expect(result.from).toBe('');
    expect(result.subject).toBe('');
    expect(result.body).toBe('[No body — see attachments]');
    expect(result.attachments).toEqual([]);
  });

  it('decodes HTML entities in HTML body', () => {
    const msg = buildGmailMessage({
      bodyHtml: '<p>Price: $100 &amp; tax &lt;included&gt;</p>',
    });

    const result = prepareEmailForClassification(msg);

    expect(result.body).toContain('&');
    expect(result.body).toContain('<included>');
  });

  it('preserves alt text from images in HTML', () => {
    const msg = buildGmailMessage({
      bodyHtml: '<p>Look at this:</p><img src="pic.jpg" alt="A cute cat"> nice!',
    });

    const result = prepareEmailForClassification(msg);

    expect(result.body).toContain('A cute cat');
  });
});

describe('syncNewEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds historyId on first run and returns empty array', async () => {
    const { getAuthenticatedClient } = await import(
      '../../../../src/services/google/auth.js'
    );
    const { getUserConfigStore } = await import(
      '../../../../src/services/user-config/index.js'
    );
    const { google } = await import('googleapis');

    const mockGmail = google.gmail({ version: 'v1', auth: {} as never });
    (mockGmail.users.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { historyId: '12345' },
    });

    const mockUpdateState = vi.fn();
    (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      updateEmailWatcherState: mockUpdateState,
    });
    (getAuthenticatedClient as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { syncNewEmails } = await import(
      '../../../../src/services/email-watcher/sync.js'
    );
    const result = await syncNewEmails('+1234567890');

    expect(result).toEqual([]);
    expect(mockUpdateState).toHaveBeenCalledWith('+1234567890', '12345');
  });

  it('fetches new messages on subsequent runs', async () => {
    const { getAuthenticatedClient } = await import(
      '../../../../src/services/google/auth.js'
    );
    const { getUserConfigStore } = await import(
      '../../../../src/services/user-config/index.js'
    );
    const { google } = await import('googleapis');

    const mockGmail = google.gmail({ version: 'v1', auth: {} as never });

    // History list returns one new message
    (mockGmail.users.history.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        history: [
          {
            messagesAdded: [
              { message: { id: 'msg_new', labelIds: ['INBOX'] } },
            ],
          },
        ],
        nextPageToken: undefined,
      },
    });

    // getMessage returns full message
    (mockGmail.users.messages.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        id: 'msg_new',
        payload: {
          headers: [
            { name: 'From', value: 'bob@example.com' },
            { name: 'Subject', value: 'New Email' },
            { name: 'Date', value: 'Mon, 20 Jan 2025 10:00:00 -0800' },
          ],
          mimeType: 'text/plain',
          body: { data: toBase64Url('Hello from Bob'), size: 14 },
        },
      },
    });

    // getProfile for cursor update
    (mockGmail.users.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { historyId: '12346' },
    });

    const mockUpdateState = vi.fn();
    (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn().mockResolvedValue({ emailWatcherHistoryId: '12345' }),
      updateEmailWatcherState: mockUpdateState,
    });
    (getAuthenticatedClient as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { syncNewEmails } = await import(
      '../../../../src/services/email-watcher/sync.js'
    );
    const result = await syncNewEmails('+1234567890');

    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('msg_new');
    expect(result[0].from).toBe('bob@example.com');
    expect(result[0].body).toBe('Hello from Bob');
    expect(mockUpdateState).toHaveBeenCalledWith('+1234567890', '12346');
  });

  it('handles pagination in history list', async () => {
    const { getAuthenticatedClient } = await import(
      '../../../../src/services/google/auth.js'
    );
    const { getUserConfigStore } = await import(
      '../../../../src/services/user-config/index.js'
    );
    const { google } = await import('googleapis');

    const mockGmail = google.gmail({ version: 'v1', auth: {} as never });

    // Page 1 of history
    (mockGmail.users.history.list as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: {
          history: [
            {
              messagesAdded: [
                { message: { id: 'msg_1', labelIds: ['INBOX'] } },
              ],
            },
          ],
          nextPageToken: 'page2',
        },
      })
      // Page 2 of history
      .mockResolvedValueOnce({
        data: {
          history: [
            {
              messagesAdded: [
                { message: { id: 'msg_2', labelIds: ['INBOX'] } },
              ],
            },
          ],
          nextPageToken: undefined,
        },
      });

    // getMessage for each
    (mockGmail.users.messages.get as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ id }: { id: string }) => ({
        data: {
          id,
          payload: {
            headers: [
              { name: 'From', value: 'sender@example.com' },
              { name: 'Subject', value: `Email ${id}` },
              { name: 'Date', value: 'Mon, 20 Jan 2025 10:00:00 -0800' },
            ],
            mimeType: 'text/plain',
            body: { data: toBase64Url(`Body of ${id}`), size: 10 },
          },
        },
      })
    );

    (mockGmail.users.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { historyId: '12350' },
    });

    const mockUpdateState = vi.fn();
    (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn().mockResolvedValue({ emailWatcherHistoryId: '12340' }),
      updateEmailWatcherState: mockUpdateState,
    });
    (getAuthenticatedClient as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { syncNewEmails } = await import(
      '../../../../src/services/email-watcher/sync.js'
    );
    const result = await syncNewEmails('+1234567890');

    expect(result).toHaveLength(2);
    expect(mockGmail.users.history.list).toHaveBeenCalledTimes(2);
  });

  it('filters to INBOX-only messages', async () => {
    const { getAuthenticatedClient } = await import(
      '../../../../src/services/google/auth.js'
    );
    const { getUserConfigStore } = await import(
      '../../../../src/services/user-config/index.js'
    );
    const { google } = await import('googleapis');

    const mockGmail = google.gmail({ version: 'v1', auth: {} as never });

    (mockGmail.users.history.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        history: [
          {
            messagesAdded: [
              { message: { id: 'msg_inbox', labelIds: ['INBOX'] } },
              { message: { id: 'msg_spam', labelIds: ['SPAM'] } },
              { message: { id: 'msg_sent', labelIds: ['SENT'] } },
            ],
          },
        ],
        nextPageToken: undefined,
      },
    });

    (mockGmail.users.messages.get as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ id }: { id: string }) => ({
        data: {
          id,
          payload: {
            headers: [
              { name: 'From', value: 'test@example.com' },
              { name: 'Subject', value: 'Test' },
              { name: 'Date', value: 'Mon, 20 Jan 2025 10:00:00 -0800' },
            ],
            mimeType: 'text/plain',
            body: { data: toBase64Url('Body'), size: 4 },
          },
        },
      })
    );

    (mockGmail.users.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { historyId: '12350' },
    });

    (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn().mockResolvedValue({ emailWatcherHistoryId: '12340' }),
      updateEmailWatcherState: vi.fn(),
    });
    (getAuthenticatedClient as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { syncNewEmails } = await import(
      '../../../../src/services/email-watcher/sync.js'
    );
    const result = await syncNewEmails('+1234567890');

    // Only the INBOX message should be fetched
    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe('msg_inbox');
  });

  it('recovers from invalid historyId (404) by resetting cursor', async () => {
    const { getAuthenticatedClient } = await import(
      '../../../../src/services/google/auth.js'
    );
    const { getUserConfigStore } = await import(
      '../../../../src/services/user-config/index.js'
    );
    const { google } = await import('googleapis');

    const mockGmail = google.gmail({ version: 'v1', auth: {} as never });

    // History list throws 404
    (mockGmail.users.history.list as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 404 })
    );

    // getProfile returns new historyId for cursor reset
    (mockGmail.users.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { historyId: '99999' },
    });

    const mockUpdateState = vi.fn();
    (getUserConfigStore as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn().mockResolvedValue({ emailWatcherHistoryId: 'stale_id' }),
      updateEmailWatcherState: mockUpdateState,
    });
    (getAuthenticatedClient as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { syncNewEmails } = await import(
      '../../../../src/services/email-watcher/sync.js'
    );
    const result = await syncNewEmails('+1234567890');

    expect(result).toEqual([]);
    expect(mockUpdateState).toHaveBeenCalledWith('+1234567890', '99999');
  });
});
