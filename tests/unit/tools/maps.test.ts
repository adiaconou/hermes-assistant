/**
 * Unit tests for Maps tool.
 *
 * Tests the format_maps_link tool that generates Google Maps links:
 * 1. Tool definition is correct
 * 2. URL encoding handles various address formats
 * 3. Optional label parameter works correctly
 * 4. Utility functions work independently
 */

import { describe, it, expect } from 'vitest';

import {
  formatMapsLink,
  formatMapsUrl,
  formatMapsText,
  formatMapsMarkdown,
} from '../../../src/tools/maps.js';

describe('maps tool', () => {
  describe('tool definition', () => {
    it('should have correct tool name', () => {
      expect(formatMapsLink.tool.name).toBe('format_maps_link');
    });

    it('should have address parameter', () => {
      const properties = formatMapsLink.tool.input_schema.properties as Record<
        string,
        { type: string; description: string }
      >;

      expect(properties.address).toBeDefined();
      expect(properties.address.type).toBe('string');
    });

    it('should require address parameter', () => {
      expect(formatMapsLink.tool.input_schema.required).toContain('address');
    });

    it('should have optional label parameter', () => {
      const properties = formatMapsLink.tool.input_schema.properties as Record<
        string,
        { type: string; description: string }
      >;

      expect(properties.label).toBeDefined();
      expect(properties.label.type).toBe('string');
      expect(formatMapsLink.tool.input_schema.required).not.toContain('label');
    });

    it('should have description mentioning Google Maps', () => {
      expect(formatMapsLink.tool.description).toContain('Google Maps');
    });
  });

  describe('formatMapsUrl', () => {
    it('should generate correct URL for simple address', () => {
      const url = formatMapsUrl('123 Main St');
      expect(url).toBe(
        'https://www.google.com/maps/search/?api=1&query=123%20Main%20St'
      );
    });

    it('should encode spaces correctly', () => {
      const url = formatMapsUrl('123 Main Street Austin TX');
      expect(url).toContain('123%20Main%20Street%20Austin%20TX');
    });

    it('should encode commas correctly', () => {
      const url = formatMapsUrl('123 Main St, Austin, TX');
      expect(url).toContain('123%20Main%20St%2C%20Austin%2C%20TX');
    });

    it('should encode special characters', () => {
      const url = formatMapsUrl("Joe's Pizza & Grill");
      expect(url).toContain('Joe%27s%20Pizza%20%26%20Grill');
    });

    it('should encode hash character', () => {
      const url = formatMapsUrl('Suite #100');
      expect(url).toContain('Suite%20%23100');
    });

    it('should handle place names', () => {
      const url = formatMapsUrl('Google HQ');
      expect(url).toBe(
        'https://www.google.com/maps/search/?api=1&query=Google%20HQ'
      );
    });

    it('should handle full addresses with zip codes', () => {
      const url = formatMapsUrl('1600 Amphitheatre Parkway, Mountain View, CA 94043');
      expect(url).toContain('1600%20Amphitheatre%20Parkway');
      expect(url).toContain('94043');
    });
  });

  describe('formatMapsMarkdown', () => {
    it('should generate markdown link with address as label', () => {
      const md = formatMapsMarkdown('123 Main St');
      expect(md).toBe(
        '[123 Main St](https://www.google.com/maps/search/?api=1&query=123%20Main%20St)'
      );
    });

    it('should use custom label when provided', () => {
      const md = formatMapsMarkdown('123 Main Street, Austin TX', "Eli's house");
      expect(md).toBe(
        "[Eli's house](https://www.google.com/maps/search/?api=1&query=123%20Main%20Street%2C%20Austin%20TX)"
      );
    });

    it('should handle label with special characters', () => {
      const md = formatMapsMarkdown('123 Main St', 'Work (Office)');
      expect(md).toContain('[Work (Office)]');
    });
  });

  describe('formatMapsText', () => {
    it('should generate plain text with label and URL', () => {
      const text = formatMapsText('123 Main St');
      expect(text).toBe(
        '123 Main St: https://www.google.com/maps/search/?api=1&query=123%20Main%20St'
      );
    });

    it('should use custom label when provided', () => {
      const text = formatMapsText('123 Main Street, Austin TX', "Eli's house");
      expect(text).toBe(
        "Eli's house: https://www.google.com/maps/search/?api=1&query=123%20Main%20Street%2C%20Austin%20TX"
      );
    });
  });

  describe('handler', () => {
    const mockContext = {
      phoneNumber: '+1234567890',
      channel: 'sms' as const,
    };

    it('should return markdown, url, and label', async () => {
      const result = await formatMapsLink.handler(
        { address: '123 Main St' },
        mockContext
      );

      expect(result.text).toBeDefined();
      expect(result.markdown).toBeDefined();
      expect(result.url).toBeDefined();
      expect(result.label).toBeDefined();
    });

    it('should use address as default label', async () => {
      const result = await formatMapsLink.handler(
        { address: '123 Main St' },
        mockContext
      );

      expect(result.label).toBe('123 Main St');
      expect(result.text).toContain('123 Main St:');
      expect(result.markdown).toContain('[123 Main St]');
    });

    it('should use custom label when provided', async () => {
      const result = await formatMapsLink.handler(
        { address: '123 Main St, Austin TX', label: 'Home' },
        mockContext
      );

      expect(result.label).toBe('Home');
      expect(result.text).toContain('Home:');
      expect(result.markdown).toContain('[Home]');
    });

    it('should generate correct URL in result', async () => {
      const result = await formatMapsLink.handler(
        { address: 'Google HQ' },
        mockContext
      );

      expect(result.url).toBe(
        'https://www.google.com/maps/search/?api=1&query=Google%20HQ'
      );
    });

    it('should handle addresses with special characters', async () => {
      const result = await formatMapsLink.handler(
        { address: "Joe's Bar & Grill, 123 Main St" },
        mockContext
      );

      expect(result.url).toContain('Joe%27s%20Bar%20%26%20Grill');
    });

    it('should reject empty address input', async () => {
      const result = await formatMapsLink.handler({ address: '   ' }, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('address');
    });

    it('should reject missing address input', async () => {
      const result = await formatMapsLink.handler({}, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('address');
    });

    it('should reject non-string address input', async () => {
      const result = await formatMapsLink.handler({ address: 123 }, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('address');
    });
  });
});
