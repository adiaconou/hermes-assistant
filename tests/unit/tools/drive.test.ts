/**
 * Unit tests for Drive tools.
 *
 * Tests the tool definitions are correct.
 */

import { describe, it, expect } from 'vitest';
import {
  uploadToDrive,
  listDriveFiles,
  createDriveFolder,
  readDriveFile,
  searchDrive,
  getHermesFolder,
} from '../../../src/domains/drive/runtime/tools.js';

describe('drive tools', () => {
  describe('upload_to_drive tool definition', () => {
    it('should have correct tool name', () => {
      expect(uploadToDrive.tool.name).toBe('upload_to_drive');
    });

    it('should have required parameters', () => {
      expect(uploadToDrive.tool.input_schema.required).toContain('name');
      expect(uploadToDrive.tool.input_schema.required).toContain('content');
      expect(uploadToDrive.tool.input_schema.required).toContain('mime_type');
    });

    it('should have optional folder_id parameter', () => {
      const properties = uploadToDrive.tool.input_schema.properties as Record<string, any>;
      expect(properties.folder_id).toBeDefined();
      expect(uploadToDrive.tool.input_schema.required).not.toContain('folder_id');
    });

    it('should have description mentioning Drive', () => {
      expect(uploadToDrive.tool.description).toContain('Drive');
    });
  });

  describe('list_drive_files tool definition', () => {
    it('should have correct tool name', () => {
      expect(listDriveFiles.tool.name).toBe('list_drive_files');
    });

    it('should have optional parameters', () => {
      expect(listDriveFiles.tool.input_schema.required).toEqual([]);
    });

    it('should have folder_id parameter', () => {
      const properties = listDriveFiles.tool.input_schema.properties as Record<string, any>;
      expect(properties.folder_id).toBeDefined();
    });

    it('should have max_results parameter', () => {
      const properties = listDriveFiles.tool.input_schema.properties as Record<string, any>;
      expect(properties.max_results).toBeDefined();
    });
  });

  describe('create_drive_folder tool definition', () => {
    it('should have correct tool name', () => {
      expect(createDriveFolder.tool.name).toBe('create_drive_folder');
    });

    it('should require name parameter', () => {
      expect(createDriveFolder.tool.input_schema.required).toContain('name');
    });

    it('should have optional parent_id parameter', () => {
      const properties = createDriveFolder.tool.input_schema.properties as Record<string, any>;
      expect(properties.parent_id).toBeDefined();
      expect(createDriveFolder.tool.input_schema.required).not.toContain('parent_id');
    });
  });

  describe('read_drive_file tool definition', () => {
    it('should have correct tool name', () => {
      expect(readDriveFile.tool.name).toBe('read_drive_file');
    });

    it('should require file_id parameter', () => {
      expect(readDriveFile.tool.input_schema.required).toContain('file_id');
    });
  });

  describe('search_drive tool definition', () => {
    it('should have correct tool name', () => {
      expect(searchDrive.tool.name).toBe('search_drive');
    });

    it('should have optional parameters', () => {
      expect(searchDrive.tool.input_schema.required).toEqual([]);
    });

    it('should have search parameters', () => {
      const properties = searchDrive.tool.input_schema.properties as Record<string, any>;
      expect(properties.name).toBeDefined();
      expect(properties.mime_type).toBeDefined();
      expect(properties.search_outside_hermes).toBeDefined();
    });
  });

  describe('get_hermes_folder tool definition', () => {
    it('should have correct tool name', () => {
      expect(getHermesFolder.tool.name).toBe('get_hermes_folder');
    });

    it('should require no parameters', () => {
      expect(getHermesFolder.tool.input_schema.required).toEqual([]);
    });
  });
});
