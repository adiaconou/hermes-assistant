/**
 * Unit tests for Vision tools.
 *
 * Tests the tool definitions are correct.
 */

import { describe, it, expect } from 'vitest';
import { analyzeImageTool } from '../../../src/tools/vision.js';

describe('vision tools', () => {
  describe('analyze_image tool definition', () => {
    it('should have correct tool name', () => {
      expect(analyzeImageTool.tool.name).toBe('analyze_image');
    });

    it('should require prompt parameter', () => {
      expect(analyzeImageTool.tool.input_schema.required).toContain('prompt');
    });

    it('should have media_url parameter', () => {
      const properties = analyzeImageTool.tool.input_schema.properties as Record<string, any>;
      expect(properties.media_url).toBeDefined();
    });

    it('should have image_base64 parameter', () => {
      const properties = analyzeImageTool.tool.input_schema.properties as Record<string, any>;
      expect(properties.image_base64).toBeDefined();
    });

    it('should have mime_type parameter', () => {
      const properties = analyzeImageTool.tool.input_schema.properties as Record<string, any>;
      expect(properties.mime_type).toBeDefined();
    });

    it('should have attachment_index parameter', () => {
      const properties = analyzeImageTool.tool.input_schema.properties as Record<string, any>;
      expect(properties.attachment_index).toBeDefined();
    });

    it('should have description mentioning image analysis', () => {
      expect(analyzeImageTool.tool.description.toLowerCase()).toContain('image');
      expect(analyzeImageTool.tool.description.toLowerCase()).toContain('analyze');
    });

    it('should have description mentioning OCR', () => {
      expect(analyzeImageTool.tool.description.toLowerCase()).toContain('ocr');
    });

    it('should have description mentioning receipts', () => {
      expect(analyzeImageTool.tool.description.toLowerCase()).toContain('receipt');
    });

    it('should have description mentioning business cards', () => {
      expect(analyzeImageTool.tool.description.toLowerCase()).toContain('business card');
    });
  });
});
