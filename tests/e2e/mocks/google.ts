/**
 * E2E mock for Google APIs.
 *
 * Two layers:
 * 1. Credential seeding — puts fake OAuth tokens into the in-memory credential store
 * 2. Provider-level stubs — mocks provider functions so no real Google API calls are made
 *
 * Mocks at the provider-function layer rather than the googleapis package level,
 * keeping the mock surface small and aligned with how tools consume these dependencies.
 */

import { vi } from 'vitest';

// ─── Layer 1: Credential seeding ────────────────────────────────────────────

/**
 * Seed fake Google OAuth credentials for a phone number.
 * Ensures getAuthenticatedClient() finds credentials and does not throw AuthRequiredError.
 *
 * Uses dynamic import to avoid triggering config.ts loading before env vars are set
 * (ESM static imports are hoisted above module body code).
 */
export async function seedGoogleCredentials(phoneNumber: string): Promise<void> {
  const { getCredentialStore } = await import('../../../src/services/credentials/index.js');
  const store = getCredentialStore();
  await store.set(phoneNumber, 'google', {
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    expiresAt: Date.now() + 3_600_000, // 1 hour from now
  });
}

// ─── Layer 2: Provider-level stubs ──────────────────────────────────────────

// -- Auth provider mock --

const mockOAuth2Client = {
  setCredentials: vi.fn(),
  refreshAccessToken: vi.fn(async () => ({
    credentials: {
      access_token: 'refreshed-fake-access-token',
      expiry_date: Date.now() + 3_600_000,
    },
  })),
  generateAuthUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/auth?fake=true'),
  getToken: vi.fn(async () => ({
    tokens: {
      access_token: 'fake-access-token',
      refresh_token: 'fake-refresh-token',
      expiry_date: Date.now() + 3_600_000,
    },
  })),
};

vi.mock('../../../src/domains/google-core/providers/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/domains/google-core/providers/auth.js')>();
  return {
    ...actual,
    getAuthenticatedClient: vi.fn(async () => mockOAuth2Client),
    refreshAccessToken: vi.fn(async () => ({
      accessToken: 'refreshed-fake-access-token',
      expiresAt: Date.now() + 3_600_000,
    })),
    createOAuth2Client: vi.fn(() => mockOAuth2Client),
  };
});

// -- Drive provider mock --

const mockDriveClient = {
  files: {
    create: vi.fn(async (params: { requestBody?: { name?: string; mimeType?: string } }) => ({
      data: {
        id: `fake-file-${Date.now()}`,
        name: params?.requestBody?.name || 'Untitled',
        mimeType: params?.requestBody?.mimeType || 'application/octet-stream',
        webViewLink: `https://drive.google.com/file/d/fake-file-${Date.now()}/view`,
        parents: ['fake-hermes-folder-id'],
      },
    })),
    list: vi.fn(async () => ({
      data: {
        files: [
          {
            id: 'fake-file-1',
            name: 'Test File',
            mimeType: 'text/plain',
            webViewLink: 'https://drive.google.com/file/d/fake-file-1/view',
            parents: ['fake-hermes-folder-id'],
            createdTime: new Date().toISOString(),
            modifiedTime: new Date().toISOString(),
            size: '1024',
          },
        ],
      },
    })),
    get: vi.fn(async (params: { fileId?: string }) => ({
      data: {
        id: params?.fileId || 'fake-file-1',
        name: 'Test File',
        mimeType: 'text/plain',
        webViewLink: `https://drive.google.com/file/d/${params?.fileId || 'fake-file-1'}/view`,
        parents: ['fake-hermes-folder-id'],
      },
    })),
    update: vi.fn(async (params: { fileId?: string }) => ({
      data: {
        id: params?.fileId || 'fake-file-1',
        name: 'Updated File',
        mimeType: 'text/plain',
        webViewLink: `https://drive.google.com/file/d/${params?.fileId || 'fake-file-1'}/view`,
        parents: ['fake-hermes-folder-id'],
      },
    })),
    delete: vi.fn(async () => ({
      data: {},
    })),
  },
};

vi.mock('../../../src/domains/drive/providers/google-drive.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/domains/drive/providers/google-drive.js')>();
  return {
    ...actual,
    createFolder: vi.fn(async (_phoneNumber: string, name: string) => ({
      id: `fake-folder-${Date.now()}`,
      name,
      webViewLink: `https://drive.google.com/drive/folders/fake-folder`,
    })),
    listFiles: vi.fn(async () => [
      {
        id: 'fake-file-1',
        name: 'Test File',
        mimeType: 'text/plain',
        webViewLink: 'https://drive.google.com/file/d/fake-file-1/view',
      },
    ]),
    uploadFile: vi.fn(async (_phoneNumber: string, options: { name?: string; mimeType?: string }) => ({
      id: `fake-upload-${Date.now()}`,
      name: options?.name || 'Uploaded File',
      mimeType: options?.mimeType || 'application/octet-stream',
      webViewLink: `https://drive.google.com/file/d/fake-upload/view`,
    })),
    downloadFile: vi.fn(async () => Buffer.from('fake file content')),
    findFolder: vi.fn(async () => null),
    readFileContent: vi.fn(async () => 'fake file content'),
    isInHermesFolder: vi.fn(async () => true),
  };
});

// -- Drive folders (google-core) mock --

vi.mock('../../../src/domains/google-core/service/drive-folders.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/domains/google-core/service/drive-folders.js')>();
  return {
    ...actual,
    getOrCreateHermesFolder: vi.fn(async () => 'fake-hermes-folder-id'),
    moveToHermesFolder: vi.fn(async (_phoneNumber: string, fileId: string) => ({
      id: fileId,
      name: 'Moved File',
      mimeType: 'text/plain',
      webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
      parents: ['fake-hermes-folder-id'],
    })),
    searchFiles: vi.fn(async () => []),
  };
});

// -- Sheets provider mock --

vi.mock('../../../src/domains/drive/providers/google-sheets.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/domains/drive/providers/google-sheets.js')>();
  return {
    ...actual,
    createSpreadsheet: vi.fn(async (_phoneNumber: string, title: string) => ({
      id: `fake-spreadsheet-${Date.now()}`,
      title,
      url: `https://docs.google.com/spreadsheets/d/fake-spreadsheet/edit`,
    })),
    readRange: vi.fn(async (_phoneNumber: string, _spreadsheetId: string, range: string) => ({
      range,
      values: [['Header1', 'Header2'], ['Value1', 'Value2']],
    })),
    writeRange: vi.fn(async () => ({
      updatedCells: 4,
      updatedRows: 2,
      updatedColumns: 2,
    })),
    appendRows: vi.fn(async (_phoneNumber: string, _spreadsheetId: string, range: string, rows: unknown[][]) => ({
      updatedRange: range,
      updatedRows: rows.length,
    })),
    findSpreadsheet: vi.fn(async () => null),
    getSpreadsheet: vi.fn(async (_phoneNumber: string, spreadsheetId: string) => ({
      id: spreadsheetId,
      title: 'Test Spreadsheet',
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    })),
  };
});

// -- Docs provider mock --

vi.mock('../../../src/domains/drive/providers/google-docs.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/domains/drive/providers/google-docs.js')>();
  return {
    ...actual,
    createDocument: vi.fn(async (_phoneNumber: string, title: string) => ({
      id: `fake-doc-${Date.now()}`,
      title,
      url: `https://docs.google.com/document/d/fake-doc/edit`,
    })),
    readDocumentContent: vi.fn(async () => ({
      title: 'Test Document',
      body: 'Fake document body content.',
    })),
    appendText: vi.fn(async () => undefined),
    findDocument: vi.fn(async () => null),
  };
});

// -- Calendar provider mock --

const mockCalendarClient = {
  events: {
    list: vi.fn(async () => ({
      data: { items: [] },
    })),
    insert: vi.fn(async (params: { requestBody?: { summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; location?: string } }) => ({
      data: {
        id: `fake-event-${Date.now()}`,
        summary: params?.requestBody?.summary || 'Untitled Event',
        start: params?.requestBody?.start || { dateTime: new Date().toISOString() },
        end: params?.requestBody?.end || { dateTime: new Date().toISOString() },
        location: params?.requestBody?.location,
      },
    })),
    patch: vi.fn(async (params: { eventId?: string; requestBody?: { summary?: string } }) => ({
      data: {
        id: params?.eventId || 'fake-event-1',
        summary: params?.requestBody?.summary || 'Updated Event',
        start: { dateTime: new Date().toISOString() },
        end: { dateTime: new Date().toISOString() },
      },
    })),
    get: vi.fn(async (params: { eventId?: string }) => ({
      data: {
        id: params?.eventId || 'fake-event-1',
        summary: 'Test Event',
        start: { dateTime: new Date().toISOString() },
        end: { dateTime: new Date().toISOString() },
      },
    })),
    delete: vi.fn(async () => ({
      data: {},
    })),
  },
};

vi.mock('../../../src/domains/calendar/providers/google-calendar.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/domains/calendar/providers/google-calendar.js')>();
  return {
    ...actual,
    listEvents: vi.fn(async () => []),
    createEvent: vi.fn(async (_phoneNumber: string, title: string, start: Date, end: Date, location?: string) => ({
      id: `fake-event-${Date.now()}`,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      location,
    })),
    updateEvent: vi.fn(async (_phoneNumber: string, eventId: string, updates: { title?: string }) => ({
      id: eventId,
      title: updates?.title || 'Updated Event',
      start: new Date().toISOString(),
      end: new Date().toISOString(),
    })),
    getEvent: vi.fn(async (_phoneNumber: string, eventId: string) => ({
      id: eventId,
      summary: 'Test Event',
      start: { dateTime: new Date().toISOString() },
      end: { dateTime: new Date().toISOString() },
    })),
    deleteEvent: vi.fn(async () => undefined),
  };
});

// -- Gmail provider mock --

vi.mock('../../../src/domains/email/providers/gmail.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/domains/email/providers/gmail.js')>();
  return {
    ...actual,
    listEmails: vi.fn(async () => []),
    getEmail: vi.fn(async (_phoneNumber: string, emailId: string) => ({
      id: emailId,
      threadId: `thread-${emailId}`,
      from: 'sender@example.com',
      subject: 'Test Email',
      snippet: 'This is a test email snippet.',
      date: new Date().toISOString(),
      isUnread: false,
      body: 'This is the full body of the test email.',
    })),
    getThread: vi.fn(async (_phoneNumber: string, threadId: string) => ({
      id: threadId,
      messages: [
        {
          id: `msg-${threadId}`,
          threadId,
          from: 'sender@example.com',
          subject: 'Test Email',
          snippet: 'This is a test email snippet.',
          date: new Date().toISOString(),
          isUnread: false,
          body: 'This is the full body of the test email.',
        },
      ],
    })),
  };
});

// ─── Mock state management ──────────────────────────────────────────────────

/**
 * Clear all Google mock state and reset vi.fn() call histories.
 */
export function clearGoogleMocks(): void {
  // Reset auth mocks
  mockOAuth2Client.setCredentials.mockClear();
  mockOAuth2Client.refreshAccessToken.mockClear();
  mockOAuth2Client.generateAuthUrl.mockClear();
  mockOAuth2Client.getToken.mockClear();

  // Reset drive client mocks
  mockDriveClient.files.create.mockClear();
  mockDriveClient.files.list.mockClear();
  mockDriveClient.files.get.mockClear();
  mockDriveClient.files.update.mockClear();
  mockDriveClient.files.delete.mockClear();

  // Reset calendar client mocks
  mockCalendarClient.events.list.mockClear();
  mockCalendarClient.events.insert.mockClear();
  mockCalendarClient.events.patch.mockClear();
  mockCalendarClient.events.get.mockClear();
  mockCalendarClient.events.delete.mockClear();
}

// Export mock clients for direct test access if needed
export { mockOAuth2Client, mockDriveClient, mockCalendarClient };
