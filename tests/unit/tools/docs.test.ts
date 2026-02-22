/**
 * Unit tests for Docs tools.
 *
 * Tests the tool definitions are correct.
 */

import { describe, it, expect } from 'vitest';
import {
  createDocumentTool,
  readDocument,
  appendToDocument,
  findDocumentTool,
} from '../../../src/domains/drive/runtime/tools.js';

describe('docs tools', () => {
  describe('create_document tool definition', () => {
    it('should have correct tool name', () => {
      expect(createDocumentTool.tool.name).toBe('create_document');
    });

    it('should require title parameter', () => {
      expect(createDocumentTool.tool.input_schema.required).toContain('title');
    });

    it('should have optional content parameter', () => {
      const properties = createDocumentTool.tool.input_schema.properties as Record<string, any>;
      expect(properties.content).toBeDefined();
      expect(createDocumentTool.tool.input_schema.required).not.toContain('content');
    });

    it('should have optional folder_id parameter', () => {
      const properties = createDocumentTool.tool.input_schema.properties as Record<string, any>;
      expect(properties.folder_id).toBeDefined();
      expect(createDocumentTool.tool.input_schema.required).not.toContain('folder_id');
    });

    it('should have description mentioning document', () => {
      expect(createDocumentTool.tool.description.toLowerCase()).toContain('document');
    });
  });

  describe('read_document tool definition', () => {
    it('should have correct tool name', () => {
      expect(readDocument.tool.name).toBe('read_document');
    });

    it('should require document_id parameter', () => {
      expect(readDocument.tool.input_schema.required).toContain('document_id');
    });

    it('should have description mentioning read', () => {
      expect(readDocument.tool.description.toLowerCase()).toContain('read');
    });
  });

  describe('append_to_document tool definition', () => {
    it('should have correct tool name', () => {
      expect(appendToDocument.tool.name).toBe('append_to_document');
    });

    it('should require document_id parameter', () => {
      expect(appendToDocument.tool.input_schema.required).toContain('document_id');
    });

    it('should require text parameter', () => {
      expect(appendToDocument.tool.input_schema.required).toContain('text');
    });

    it('should have description mentioning append', () => {
      expect(appendToDocument.tool.description.toLowerCase()).toContain('append');
    });
  });

  describe('find_document tool definition', () => {
    it('should have correct tool name', () => {
      expect(findDocumentTool.tool.name).toBe('find_document');
    });

    it('should require title parameter', () => {
      expect(findDocumentTool.tool.input_schema.required).toContain('title');
    });

    it('should have description mentioning find', () => {
      expect(findDocumentTool.tool.description.toLowerCase()).toContain('find');
    });
  });
});
