/**
 * Unit tests for UI generation tool.
 *
 * Tests that the generate_ui tool:
 * 1. Has correct tool definition with html parameter (not spec)
 * 2. Correctly processes HTML input
 * 3. Returns success with shortUrl
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the UI module before importing the tool
vi.mock('../../../src/services/ui/index.js', () => ({
  generatePage: vi.fn(),
}));

import { generateUi } from '../../../src/domains/ui/runtime/tools.js';
import { generatePage } from '../../../src/services/ui/index.js';

const mockGeneratePage = vi.mocked(generatePage);

describe('generateUi tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tool definition', () => {
    it('should have correct tool name', () => {
      expect(generateUi.tool.name).toBe('generate_ui');
    });

    it('should have html parameter (not spec)', () => {
      const properties = generateUi.tool.input_schema.properties as Record<string, { type: string; description: string }>;

      // Should have html parameter
      expect(properties.html).toBeDefined();
      expect(properties.html.type).toBe('string');

      // Should NOT have spec parameter
      expect(properties.spec).toBeUndefined();
    });

    it('should require html parameter', () => {
      expect(generateUi.tool.input_schema.required).toContain('html');
    });

    it('should have optional title parameter', () => {
      const properties = generateUi.tool.input_schema.properties as Record<string, { type: string; description: string }>;

      expect(properties.title).toBeDefined();
      expect(properties.title.type).toBe('string');
      expect(generateUi.tool.input_schema.required).not.toContain('title');
    });

    it('should have description indicating it hosts HTML, not generates it', () => {
      expect(generateUi.tool.description).toContain('Host');
      expect(generateUi.tool.description).toContain('HTML');
      // Should clarify that actual code is required
      expect(generateUi.tool.description).toContain('complete HTML code');
    });

    it('should have html parameter description clarifying code is required', () => {
      const properties = generateUi.tool.input_schema.properties as Record<string, { type: string; description: string }>;

      expect(properties.html.description).toContain('NOT a description');
      expect(properties.html.description).toContain('actual HTML/CSS/JS code');
    });
  });

  describe('handler', () => {
    const mockContext = {
      phoneNumber: '+1234567890',
      channel: 'sms' as const,
    };

    it('should call generatePage with html and title', async () => {
      mockGeneratePage.mockResolvedValue({
        shortUrl: 'https://example.com/u/abc123',
        pageId: 'page-123',
        shortId: 'abc123',
      });

      const result = await generateUi.handler({
        html: '<div>Hello World</div>',
        title: 'Test Page',
      }, mockContext);

      expect(mockGeneratePage).toHaveBeenCalledWith({
        title: 'Test Page',
        html: '<div>Hello World</div>',
      });
      expect(result).toEqual({
        success: true,
        shortUrl: 'https://example.com/u/abc123',
        pageId: 'page-123',
        shortId: 'abc123',
      });
    });

    it('should use default title when not provided', async () => {
      mockGeneratePage.mockResolvedValue({
        shortUrl: 'https://example.com/u/xyz789',
        pageId: 'page-456',
        shortId: 'xyz789',
      });

      await generateUi.handler({
        html: '<div>Test</div>',
      }, mockContext);

      expect(mockGeneratePage).toHaveBeenCalledWith({
        title: 'Generated Page',
        html: '<div>Test</div>',
      });
    });

    it('should return success true with generatePage result', async () => {
      mockGeneratePage.mockResolvedValue({
        shortUrl: 'https://example.com/u/test',
        pageId: 'page-id',
        shortId: 'test',
      });

      const result = await generateUi.handler({
        html: '<button onclick="alert(1)">Click</button>',
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.shortUrl).toBe('https://example.com/u/test');
    });

    it('should handle complex HTML with styles and scripts', async () => {
      const complexHtml = `
        <style>body{font-family:sans-serif}</style>
        <h1>My App</h1>
        <div id="app"></div>
        <script>document.getElementById('app').textContent='Hello'</script>
      `;

      mockGeneratePage.mockResolvedValue({
        shortUrl: 'https://example.com/u/complex',
        pageId: 'page-complex',
        shortId: 'complex',
      });

      await generateUi.handler({
        html: complexHtml,
        title: 'Complex App',
      }, mockContext);

      expect(mockGeneratePage).toHaveBeenCalledWith({
        title: 'Complex App',
        html: complexHtml,
      });
    });

    it('should handle generatePage returning an error', async () => {
      mockGeneratePage.mockResolvedValue({
        error: 'HTML exceeds maximum size',
      });

      const result = await generateUi.handler({
        html: 'x'.repeat(1000000), // Very large HTML
      }, mockContext);

      // The handler adds success: true and spreads the result
      // So if generatePage returns error, it gets spread
      expect(result).toHaveProperty('error', 'HTML exceeds maximum size');
    });

    describe('boundary validation', () => {
      it('rejects missing html', async () => {
        const result = await generateUi.handler({}, mockContext);
        expect(result.success).toBe(false);
        expect(result.error).toContain('html');
      });

      it('rejects empty html', async () => {
        const result = await generateUi.handler({ html: '' }, mockContext);
        expect(result.success).toBe(false);
        expect(result.error).toContain('html');
      });

      it('rejects html as number', async () => {
        const result = await generateUi.handler({ html: 123 }, mockContext);
        expect(result.success).toBe(false);
        expect(result.error).toContain('html');
      });

      it('rejects title as number', async () => {
        const result = await generateUi.handler(
          { html: '<div>test</div>', title: 42 },
          mockContext
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('title');
      });
    });
  });
});
