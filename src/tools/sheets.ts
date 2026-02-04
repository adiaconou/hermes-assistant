/**
 * Google Sheets tools.
 */

import type { ToolDefinition } from './types.js';
import { requirePhoneNumber, handleAuthError } from './utils.js';
import {
  createSpreadsheet,
  readRange,
  writeRange,
  appendRows,
  findSpreadsheet,
} from '../services/google/sheets.js';

export const createSpreadsheetTool: ToolDefinition = {
  tool: {
    name: 'create_spreadsheet',
    description: 'Create a new Google Spreadsheet in the Hermes folder. Use for tracking expenses, logs, contacts, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Spreadsheet title (e.g., "Expense Tracker", "Contacts")',
        },
        folder_id: {
          type: 'string',
          description: 'Optional folder ID to create in (defaults to Hermes root folder)',
        },
      },
      required: ['title'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { title, folder_id } = input as {
      title: string;
      folder_id?: string;
    };

    try {
      const spreadsheet = await createSpreadsheet(phoneNumber, title, folder_id);

      console.log(JSON.stringify({
        level: 'info',
        message: 'Spreadsheet created',
        spreadsheetId: spreadsheet.id,
        title,
        timestamp: new Date().toISOString(),
      }));

      return {
        success: true,
        spreadsheet: {
          id: spreadsheet.id,
          title: spreadsheet.title,
          url: spreadsheet.url,
        },
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Create spreadsheet failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const readSpreadsheet: ToolDefinition = {
  tool: {
    name: 'read_spreadsheet',
    description: 'Read a range of cells from a Google Spreadsheet. Use to view spreadsheet data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spreadsheet_id: {
          type: 'string',
          description: 'Spreadsheet ID (from find_spreadsheet or create_spreadsheet)',
        },
        range: {
          type: 'string',
          description: 'A1 notation range (e.g., "Sheet1!A1:D10", "A:D" for entire columns)',
        },
      },
      required: ['spreadsheet_id', 'range'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { spreadsheet_id, range } = input as {
      spreadsheet_id: string;
      range: string;
    };

    try {
      const data = await readRange(phoneNumber, spreadsheet_id, range);

      return {
        success: true,
        range: data.range,
        values: data.values,
        rowCount: data.values.length,
        columnCount: data.values.length > 0 ? data.values[0].length : 0,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Read spreadsheet failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const writeSpreadsheet: ToolDefinition = {
  tool: {
    name: 'write_spreadsheet',
    description: 'Write data to a specific range of cells in a Google Spreadsheet. Use for updating existing data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spreadsheet_id: {
          type: 'string',
          description: 'Spreadsheet ID (from find_spreadsheet or create_spreadsheet)',
        },
        range: {
          type: 'string',
          description: 'A1 notation range (e.g., "Sheet1!A1:D3")',
        },
        values: {
          type: 'array',
          description: '2D array of values to write. Each inner array is a row.',
          items: {
            type: 'array',
            items: {
              type: ['string', 'number', 'boolean', 'null'],
            },
          },
        },
      },
      required: ['spreadsheet_id', 'range', 'values'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { spreadsheet_id, range, values } = input as {
      spreadsheet_id: string;
      range: string;
      values: (string | number | boolean | null)[][];
    };

    try {
      const result = await writeRange(phoneNumber, spreadsheet_id, range, values);

      return {
        success: true,
        updatedCells: result.updatedCells,
        updatedRows: result.updatedRows,
        updatedColumns: result.updatedColumns,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Write spreadsheet failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const appendToSpreadsheet: ToolDefinition = {
  tool: {
    name: 'append_to_spreadsheet',
    description: 'Append rows to a Google Spreadsheet. Use for adding new entries to logs, expense trackers, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spreadsheet_id: {
          type: 'string',
          description: 'Spreadsheet ID (from find_spreadsheet or create_spreadsheet)',
        },
        range: {
          type: 'string',
          description: 'A1 notation range (e.g., "Sheet1!A:D"). Rows will be appended after existing data.',
        },
        rows: {
          type: 'array',
          description: 'Array of rows to append. Each row is an array of values.',
          items: {
            type: 'array',
            items: {
              type: ['string', 'number', 'boolean', 'null'],
            },
          },
        },
      },
      required: ['spreadsheet_id', 'range', 'rows'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { spreadsheet_id, range, rows } = input as {
      spreadsheet_id: string;
      range: string;
      rows: (string | number | boolean | null)[][];
    };

    try {
      const result = await appendRows(phoneNumber, spreadsheet_id, range, rows);

      return {
        success: true,
        updatedRange: result.updatedRange,
        updatedRows: result.updatedRows,
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Append to spreadsheet failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const findSpreadsheetTool: ToolDefinition = {
  tool: {
    name: 'find_spreadsheet',
    description: 'Find a Google Spreadsheet by name in the Hermes folder. Use to check if a spreadsheet exists before creating a new one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Spreadsheet title to search for (e.g., "Expense Tracker")',
        },
      },
      required: ['title'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { title } = input as { title: string };

    try {
      const spreadsheet = await findSpreadsheet(phoneNumber, title);

      if (!spreadsheet) {
        return {
          success: true,
          found: false,
          message: `No spreadsheet found with title "${title}"`,
        };
      }

      return {
        success: true,
        found: true,
        spreadsheet: {
          id: spreadsheet.id,
          title: spreadsheet.title,
          url: spreadsheet.url,
        },
      };
    } catch (error) {
      const authResult = handleAuthError(error, phoneNumber, context.channel);
      if (authResult) return authResult;

      console.error(JSON.stringify({
        level: 'error',
        message: 'Find spreadsheet failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
