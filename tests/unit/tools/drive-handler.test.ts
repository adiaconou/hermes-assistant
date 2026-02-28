import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/domains/drive/providers/google-drive.js', () => ({
  uploadFile: vi.fn(),
  listFiles: vi.fn(),
  createFolder: vi.fn(),
  readFileContent: vi.fn(),
  searchFiles: vi.fn(),
  getOrCreateHermesFolder: vi.fn(),
}));

import { uploadToDrive, listDriveFiles } from '../../../src/domains/drive/runtime/tools.js';
import { AuthRequiredError } from '../../../src/providers/auth.js';
import { uploadFile, listFiles } from '../../../src/domains/drive/providers/google-drive.js';
import type { ToolContext } from '../../../src/tools/types.js';

describe('drive tool handlers', () => {
  const context: ToolContext = {
    phoneNumber: '+15551234567',
    channel: 'sms',
    userConfig: { name: 'Tester', timezone: 'America/New_York' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upload_to_drive uploads binary content and returns file payload', async () => {
    const uploadFileMock = vi.mocked(uploadFile);
    uploadFileMock.mockResolvedValueOnce({
      id: 'file_123',
      name: 'receipt.png',
      mimeType: 'image/png',
      webViewLink: 'https://drive.google.com/file/d/file_123/view',
    });

    const result = await uploadToDrive.handler({
      name: 'receipt.png',
      content: Buffer.from('hello').toString('base64'),
      mime_type: 'image/png',
    }, context);

    expect(result).toMatchObject({
      success: true,
      file: {
        id: 'file_123',
        name: 'receipt.png',
      },
    });
    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    const call = uploadFileMock.mock.calls[0];
    expect(call[0]).toBe(context.phoneNumber);
    expect(Buffer.isBuffer(call[1].content)).toBe(true);
  });

  it('upload_to_drive returns auth_required when Google auth is missing', async () => {
    const uploadFileMock = vi.mocked(uploadFile);
    uploadFileMock.mockRejectedValueOnce(new AuthRequiredError(context.phoneNumber!));

    const result = await uploadToDrive.handler({
      name: 'notes.txt',
      content: 'hello',
      mime_type: 'text/plain',
      is_base64: false,
    }, context);

    expect(result).toMatchObject({
      success: false,
      auth_required: true,
    });
    expect(String((result as { auth_url?: string }).auth_url)).toContain('/auth/google');
  });

  it('list_drive_files returns service error on unexpected exception', async () => {
    const listFilesMock = vi.mocked(listFiles);
    listFilesMock.mockRejectedValueOnce(new Error('Drive API unavailable'));

    const result = await listDriveFiles.handler({}, context);

    expect(result).toEqual({
      success: false,
      error: 'Drive API unavailable',
    });
  });

  describe('boundary validation', () => {
    it('upload_to_drive rejects missing name', async () => {
      const result = await uploadToDrive.handler(
        { content: 'data', mime_type: 'text/plain' },
        context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('upload_to_drive rejects empty name', async () => {
      const result = await uploadToDrive.handler(
        { name: '', content: 'data', mime_type: 'text/plain' },
        context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('upload_to_drive rejects is_base64 as string', async () => {
      const result = await uploadToDrive.handler(
        { name: 'test.txt', content: 'data', mime_type: 'text/plain', is_base64: 'yes' },
        context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('is_base64');
    });

    it('upload_to_drive rejects missing mime_type', async () => {
      const result = await uploadToDrive.handler(
        { name: 'test.txt', content: 'data' },
        context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('mime_type');
    });

    it('list_drive_files rejects max_results as string', async () => {
      const result = await listDriveFiles.handler(
        { max_results: 'fifty' },
        context
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('max_results');
    });
  });
});
