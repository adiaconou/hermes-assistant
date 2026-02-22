/**
 * Unit tests for Sheets tools.
 *
 * Tests the tool definitions are correct.
 */

import { describe, it, expect } from 'vitest';
import {
  createSpreadsheetTool,
  readSpreadsheet,
  writeSpreadsheet,
  appendToSpreadsheet,
  findSpreadsheetTool,
} from '../../../src/domains/drive/runtime/tools.js';

describe('sheets tools', () => {
  describe('create_spreadsheet tool definition', () => {
    it('should have correct tool name', () => {
      expect(createSpreadsheetTool.tool.name).toBe('create_spreadsheet');
    });

    it('should require title parameter', () => {
      expect(createSpreadsheetTool.tool.input_schema.required).toContain('title');
    });

    it('should have optional folder_id parameter', () => {
      const properties = createSpreadsheetTool.tool.input_schema.properties as Record<string, any>;
      expect(properties.folder_id).toBeDefined();
      expect(createSpreadsheetTool.tool.input_schema.required).not.toContain('folder_id');
    });

    it('should have description mentioning spreadsheet', () => {
      expect(createSpreadsheetTool.tool.description.toLowerCase()).toContain('spreadsheet');
    });
  });

  describe('read_spreadsheet tool definition', () => {
    it('should have correct tool name', () => {
      expect(readSpreadsheet.tool.name).toBe('read_spreadsheet');
    });

    it('should require spreadsheet_id parameter', () => {
      expect(readSpreadsheet.tool.input_schema.required).toContain('spreadsheet_id');
    });

    it('should require range parameter', () => {
      expect(readSpreadsheet.tool.input_schema.required).toContain('range');
    });

    it('should have range parameter with A1 notation description', () => {
      const properties = readSpreadsheet.tool.input_schema.properties as Record<string, any>;
      expect(properties.range.description).toContain('A1');
    });
  });

  describe('write_spreadsheet tool definition', () => {
    it('should have correct tool name', () => {
      expect(writeSpreadsheet.tool.name).toBe('write_spreadsheet');
    });

    it('should require spreadsheet_id, range, and values', () => {
      expect(writeSpreadsheet.tool.input_schema.required).toContain('spreadsheet_id');
      expect(writeSpreadsheet.tool.input_schema.required).toContain('range');
      expect(writeSpreadsheet.tool.input_schema.required).toContain('values');
    });

    it('should have values parameter as array', () => {
      const properties = writeSpreadsheet.tool.input_schema.properties as Record<string, any>;
      expect(properties.values.type).toBe('array');
    });
  });

  describe('append_to_spreadsheet tool definition', () => {
    it('should have correct tool name', () => {
      expect(appendToSpreadsheet.tool.name).toBe('append_to_spreadsheet');
    });

    it('should require spreadsheet_id, range, and rows', () => {
      expect(appendToSpreadsheet.tool.input_schema.required).toContain('spreadsheet_id');
      expect(appendToSpreadsheet.tool.input_schema.required).toContain('range');
      expect(appendToSpreadsheet.tool.input_schema.required).toContain('rows');
    });

    it('should have rows parameter as array', () => {
      const properties = appendToSpreadsheet.tool.input_schema.properties as Record<string, any>;
      expect(properties.rows.type).toBe('array');
    });

    it('should have description mentioning append', () => {
      expect(appendToSpreadsheet.tool.description.toLowerCase()).toContain('append');
    });
  });

  describe('find_spreadsheet tool definition', () => {
    it('should have correct tool name', () => {
      expect(findSpreadsheetTool.tool.name).toBe('find_spreadsheet');
    });

    it('should require title parameter', () => {
      expect(findSpreadsheetTool.tool.input_schema.required).toContain('title');
    });

    it('should have description mentioning find', () => {
      expect(findSpreadsheetTool.tool.description.toLowerCase()).toContain('find');
    });
  });
});
