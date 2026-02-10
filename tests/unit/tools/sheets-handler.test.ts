import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/services/google/sheets.js', () => ({
  createSpreadsheet: vi.fn(),
  readRange: vi.fn(),
  writeRange: vi.fn(),
  appendRows: vi.fn(),
  findSpreadsheet: vi.fn(),
}));

import { createSpreadsheetTool, readSpreadsheet } from '../../../src/tools/sheets.js';
import { AuthRequiredError } from '../../../src/services/google/calendar.js';
import { createSpreadsheet, readRange } from '../../../src/services/google/sheets.js';
import type { ToolContext } from '../../../src/tools/types.js';

describe('sheets tool handlers', () => {
  const context: ToolContext = {
    phoneNumber: '+15551234567',
    channel: 'sms',
    userConfig: { name: 'Tester', timezone: 'America/New_York' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create_spreadsheet returns created spreadsheet metadata', async () => {
    const createSpreadsheetMock = vi.mocked(createSpreadsheet);
    createSpreadsheetMock.mockResolvedValueOnce({
      id: 'sheet_123',
      title: 'Expenses',
      url: 'https://docs.google.com/spreadsheets/d/sheet_123',
    });

    const result = await createSpreadsheetTool.handler({ title: 'Expenses' }, context);

    expect(result).toMatchObject({
      success: true,
      spreadsheet: {
        id: 'sheet_123',
        title: 'Expenses',
      },
    });
  });

  it('create_spreadsheet returns auth_required when credentials are missing', async () => {
    const createSpreadsheetMock = vi.mocked(createSpreadsheet);
    createSpreadsheetMock.mockRejectedValueOnce(new AuthRequiredError(context.phoneNumber!));

    const result = await createSpreadsheetTool.handler({ title: 'Expenses' }, context);

    expect(result).toMatchObject({
      success: false,
      auth_required: true,
    });
    expect(String((result as { auth_url?: string }).auth_url)).toContain('/auth/google');
  });

  it('read_spreadsheet returns service error on unexpected exception', async () => {
    const readRangeMock = vi.mocked(readRange);
    readRangeMock.mockRejectedValueOnce(new Error('Sheets API unavailable'));

    const result = await readSpreadsheet.handler({
      spreadsheet_id: 'sheet_123',
      range: 'A1:B10',
    }, context);

    expect(result).toEqual({
      success: false,
      error: 'Sheets API unavailable',
    });
  });
});
