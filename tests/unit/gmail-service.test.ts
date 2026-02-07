/**
 * Unit tests for Gmail service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setMockEmails,
  clearMockState,
  setShouldFailRefresh,
  setShouldFailWithInsufficientScopes,
  getGmailCallCounts,
  type MockEmail,
} from '../mocks/google-calendar.js';
import {
  getCredentialStore,
  resetCredentialStore,
} from '../../src/services/credentials/index.js';
import { clearClientCache } from '../../src/services/google/auth.js';

// Import after mocks are set up
import { listEmails, getEmail, getThread } from '../../src/services/google/gmail.js';
import { AuthRequiredError } from '../../src/services/google/calendar.js';

describe('Gmail Service', () => {
  const testPhone = '+1234567890';
  const validCredential = {
    accessToken: 'valid-access-token',
    refreshToken: 'valid-refresh-token',
    expiresAt: Date.now() + 3600000, // 1 hour from now
  };

  beforeEach(() => {
    clearMockState();
    resetCredentialStore();
    clearClientCache();
    vi.clearAllMocks();
  });

  it('lists emails for authenticated user', async () => {
    // Store credentials
    const store = getCredentialStore();
    await store.set(testPhone, 'google', validCredential);

    // Set up mock emails
    const mockEmails: MockEmail[] = [
      {
        id: 'email1',
        threadId: 'thread1',
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'Hey, just wanted to check in...',
        payload: {
          headers: [
            { name: 'From', value: 'John Smith <john@example.com>' },
            { name: 'Subject', value: 'Quick question' },
            { name: 'Date', value: 'Mon, 20 Jan 2025 10:00:00 -0800' },
          ],
        },
      },
      {
        id: 'email2',
        threadId: 'thread2',
        labelIds: ['INBOX'],
        snippet: 'Your order has shipped...',
        payload: {
          headers: [
            { name: 'From', value: 'Amazon <orders@amazon.com>' },
            { name: 'Subject', value: 'Your order shipped' },
            { name: 'Date', value: 'Mon, 20 Jan 2025 09:00:00 -0800' },
          ],
        },
      },
    ];
    setMockEmails(mockEmails);

    // Call listEmails
    const emails = await listEmails(testPhone, { query: 'is:inbox' });

    expect(emails).toHaveLength(2);
    expect(emails[0].from).toBe('John Smith <john@example.com>');
    expect(emails[0].subject).toBe('Quick question');
    expect(emails[0].isUnread).toBe(true);
    expect(emails[1].from).toBe('Amazon <orders@amazon.com>');
    expect(emails[1].isUnread).toBe(false);

    const counts = getGmailCallCounts();
    expect(counts.list).toBe(1);
    expect(counts.get).toBe(2); // One get per email for metadata
  });

  it('throws AuthRequiredError when no credentials', async () => {
    // No credentials stored
    await expect(
      listEmails(testPhone, { query: 'is:unread' })
    ).rejects.toThrow(AuthRequiredError);
  });

  it('handles empty inbox gracefully', async () => {
    // Store credentials
    const store = getCredentialStore();
    await store.set(testPhone, 'google', validCredential);

    // Set up empty inbox
    setMockEmails([]);

    const emails = await listEmails(testPhone);

    expect(emails).toHaveLength(0);
  });

  it('refreshes expired token before API call', async () => {
    // Store expired credentials
    const store = getCredentialStore();
    const expiredCredential = {
      ...validCredential,
      expiresAt: Date.now() - 1000, // Already expired
    };
    await store.set(testPhone, 'google', expiredCredential);

    setMockEmails([]);

    // Call should succeed (token gets refreshed)
    const emails = await listEmails(testPhone);

    expect(emails).toHaveLength(0);

    // Verify credentials were updated with new token
    const updatedCreds = await store.get(testPhone, 'google');
    expect(updatedCreds?.accessToken).toBe('new-access-token');
    expect(updatedCreds?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws AuthRequiredError when token refresh fails', async () => {
    // Store expired credentials
    const store = getCredentialStore();
    const expiredCredential = {
      ...validCredential,
      expiresAt: Date.now() - 1000, // Already expired
    };
    await store.set(testPhone, 'google', expiredCredential);

    // Make refresh fail (simulates revoked token)
    setShouldFailRefresh(true);

    // Call should throw AuthRequiredError
    await expect(
      listEmails(testPhone)
    ).rejects.toThrow(AuthRequiredError);

    // Credentials should be deleted
    const creds = await store.get(testPhone, 'google');
    expect(creds).toBeNull();
  });

  it('throws AuthRequiredError and deletes credentials on insufficient scopes', async () => {
    // Store valid credentials (but missing Gmail scope)
    const store = getCredentialStore();
    await store.set(testPhone, 'google', validCredential);

    // Make Gmail API fail with insufficient scopes
    setShouldFailWithInsufficientScopes(true);

    // Call should throw AuthRequiredError
    await expect(
      listEmails(testPhone)
    ).rejects.toThrow(AuthRequiredError);

    // Credentials should be deleted so user can re-auth with correct scopes
    const creds = await store.get(testPhone, 'google');
    expect(creds).toBeNull();
  });

  describe('getEmail', () => {
    it('returns full email content', async () => {
      const store = getCredentialStore();
      await store.set(testPhone, 'google', validCredential);

      // Base64 encode "Hello, this is the email body."
      const bodyText = 'Hello, this is the email body.';
      const bodyBase64 = Buffer.from(bodyText).toString('base64');

      const mockEmails: MockEmail[] = [
        {
          id: 'email1',
          threadId: 'thread1',
          labelIds: ['INBOX'],
          snippet: 'Hello, this is...',
          payload: {
            headers: [
              { name: 'From', value: 'John <john@example.com>' },
              { name: 'Subject', value: 'Test email' },
              { name: 'Date', value: 'Mon, 20 Jan 2025 10:00:00 -0800' },
            ],
            mimeType: 'text/plain',
            body: { data: bodyBase64 },
          },
        },
      ];
      setMockEmails(mockEmails);

      const email = await getEmail(testPhone, 'email1');

      expect(email).not.toBeNull();
      expect(email!.from).toBe('John <john@example.com>');
      expect(email!.subject).toBe('Test email');
      expect(email!.body).toBe(bodyText);
    });

    it('extracts plain text body from multipart email', async () => {
      const store = getCredentialStore();
      await store.set(testPhone, 'google', validCredential);

      const plainText = 'This is the plain text version.';
      const plainBase64 = Buffer.from(plainText).toString('base64');

      const mockEmails: MockEmail[] = [
        {
          id: 'email1',
          threadId: 'thread1',
          labelIds: ['INBOX'],
          snippet: 'This is the plain...',
          payload: {
            headers: [
              { name: 'From', value: 'John <john@example.com>' },
              { name: 'Subject', value: 'Multipart email' },
              { name: 'Date', value: 'Mon, 20 Jan 2025 10:00:00 -0800' },
            ],
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: plainBase64 },
              },
              {
                mimeType: 'text/html',
                body: { data: Buffer.from('<p>HTML version</p>').toString('base64') },
              },
            ],
          },
        },
      ];
      setMockEmails(mockEmails);

      const email = await getEmail(testPhone, 'email1');

      expect(email).not.toBeNull();
      expect(email!.body).toBe(plainText);
    });

    it('returns null for non-existent email', async () => {
      const store = getCredentialStore();
      await store.set(testPhone, 'google', validCredential);

      setMockEmails([]);

      await expect(getEmail(testPhone, 'nonexistent')).rejects.toThrow('Email not found');
    });

    it('throws AuthRequiredError when no credentials', async () => {
      await expect(
        getEmail(testPhone, 'email1')
      ).rejects.toThrow(AuthRequiredError);
    });
  });

  describe('getThread', () => {
    it('returns all messages in a thread', async () => {
      const store = getCredentialStore();
      await store.set(testPhone, 'google', validCredential);

      const bodyText1 = 'First message in thread.';
      const bodyText2 = 'Reply to first message.';
      const bodyBase64_1 = Buffer.from(bodyText1).toString('base64');
      const bodyBase64_2 = Buffer.from(bodyText2).toString('base64');

      const mockEmails: MockEmail[] = [
        {
          id: 'email1',
          threadId: 'thread1',
          labelIds: ['INBOX'],
          snippet: 'First message...',
          payload: {
            headers: [
              { name: 'From', value: 'John <john@example.com>' },
              { name: 'Subject', value: 'Original subject' },
              { name: 'Date', value: 'Mon, 20 Jan 2025 10:00:00 -0800' },
            ],
            mimeType: 'text/plain',
            body: { data: bodyBase64_1 },
          },
        },
        {
          id: 'email2',
          threadId: 'thread1',
          labelIds: ['INBOX'],
          snippet: 'Reply to first...',
          payload: {
            headers: [
              { name: 'From', value: 'Jane <jane@example.com>' },
              { name: 'Subject', value: 'Re: Original subject' },
              { name: 'Date', value: 'Mon, 20 Jan 2025 11:00:00 -0800' },
            ],
            mimeType: 'text/plain',
            body: { data: bodyBase64_2 },
          },
        },
      ];
      setMockEmails(mockEmails);

      const thread = await getThread(testPhone, 'thread1');

      expect(thread).not.toBeNull();
      expect(thread!.id).toBe('thread1');
      expect(thread!.messages).toHaveLength(2);
      expect(thread!.messages[0].from).toBe('John <john@example.com>');
      expect(thread!.messages[0].body).toBe(bodyText1);
      expect(thread!.messages[1].from).toBe('Jane <jane@example.com>');
      expect(thread!.messages[1].body).toBe(bodyText2);

      const counts = getGmailCallCounts();
      expect(counts.threadGet).toBe(1);
    });

    it('returns null for non-existent thread', async () => {
      const store = getCredentialStore();
      await store.set(testPhone, 'google', validCredential);

      setMockEmails([]);

      await expect(getThread(testPhone, 'nonexistent')).rejects.toThrow('Thread not found');
    });

    it('throws AuthRequiredError when no credentials', async () => {
      await expect(
        getThread(testPhone, 'thread1')
      ).rejects.toThrow(AuthRequiredError);
    });
  });
});
