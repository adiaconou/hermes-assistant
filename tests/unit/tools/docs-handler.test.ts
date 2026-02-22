import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/domains/drive/providers/google-docs.js', () => ({
  createDocument: vi.fn(),
  readDocumentContent: vi.fn(),
  appendText: vi.fn(),
  findDocument: vi.fn(),
}));

import { createDocumentTool, readDocument } from '../../../src/domains/drive/runtime/tools.js';
import { AuthRequiredError } from '../../../src/providers/auth.js';
import { createDocument, readDocumentContent } from '../../../src/domains/drive/providers/google-docs.js';
import type { ToolContext } from '../../../src/tools/types.js';

describe('docs tool handlers', () => {
  const context: ToolContext = {
    phoneNumber: '+15551234567',
    channel: 'sms',
    userConfig: { name: 'Tester', timezone: 'America/New_York' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create_document returns created document metadata', async () => {
    const createDocumentMock = vi.mocked(createDocument);
    createDocumentMock.mockResolvedValueOnce({
      id: 'doc_123',
      title: 'Meeting Notes',
      url: 'https://docs.google.com/document/d/doc_123',
    });

    const result = await createDocumentTool.handler({
      title: 'Meeting Notes',
      content: 'Agenda',
    }, context);

    expect(result).toMatchObject({
      success: true,
      document: {
        id: 'doc_123',
        title: 'Meeting Notes',
      },
    });
  });

  it('create_document returns auth_required when credentials are missing', async () => {
    const createDocumentMock = vi.mocked(createDocument);
    createDocumentMock.mockRejectedValueOnce(new AuthRequiredError(context.phoneNumber!));

    const result = await createDocumentTool.handler({
      title: 'Needs auth',
    }, context);

    expect(result).toMatchObject({
      success: false,
      auth_required: true,
    });
    expect(String((result as { auth_url?: string }).auth_url)).toContain('/auth/google');
  });

  it('read_document returns error when upstream call fails', async () => {
    const readDocumentMock = vi.mocked(readDocumentContent);
    readDocumentMock.mockRejectedValueOnce(new Error('Docs read failed'));

    const result = await readDocument.handler({
      document_id: 'doc_123',
    }, context);

    expect(result).toEqual({
      success: false,
      error: 'Docs read failed',
    });
  });
});
