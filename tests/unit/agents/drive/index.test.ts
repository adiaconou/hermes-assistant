/**
 * Unit tests for Drive agent.
 *
 * Tests the agent capability definition is correct.
 */

import { describe, it, expect } from 'vitest';
import { capability } from '../../../../src/domains/drive/runtime/agent.js';

describe('drive agent', () => {
  describe('capability definition', () => {
    it('should have correct agent name', () => {
      expect(capability.name).toBe('drive-agent');
    });

    it('should have description mentioning Drive', () => {
      expect(capability.description).toContain('Drive');
    });

    it('should have description mentioning Sheets', () => {
      expect(capability.description).toContain('Sheets');
    });

    it('should have description mentioning Docs', () => {
      expect(capability.description).toContain('Docs');
    });

    it('should have description mentioning images', () => {
      expect(capability.description.toLowerCase()).toContain('image');
    });

    it('should include Drive tools', () => {
      expect(capability.tools).toContain('upload_to_drive');
      expect(capability.tools).toContain('list_drive_files');
      expect(capability.tools).toContain('create_drive_folder');
      expect(capability.tools).toContain('read_drive_file');
      expect(capability.tools).toContain('search_drive');
      expect(capability.tools).toContain('get_hermes_folder');
    });

    it('should include Sheets tools', () => {
      expect(capability.tools).toContain('create_spreadsheet');
      expect(capability.tools).toContain('read_spreadsheet');
      expect(capability.tools).toContain('write_spreadsheet');
      expect(capability.tools).toContain('append_to_spreadsheet');
      expect(capability.tools).toContain('find_spreadsheet');
    });

    it('should include Docs tools', () => {
      expect(capability.tools).toContain('create_document');
      expect(capability.tools).toContain('read_document');
      expect(capability.tools).toContain('append_to_document');
      expect(capability.tools).toContain('find_document');
    });

    it('should include Vision tools', () => {
      expect(capability.tools).toContain('analyze_image');
    });

    it('should have relevant examples', () => {
      expect(capability.examples.length).toBeGreaterThan(0);
      expect(capability.examples.some(e => e.toLowerCase().includes('drive'))).toBe(true);
      expect(capability.examples.some(e => e.toLowerCase().includes('spreadsheet'))).toBe(true);
    });
  });
});
