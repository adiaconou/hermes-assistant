/**
 * Unit tests for UI agent prompts.
 *
 * Tests that the UI agent prompt correctly instructs the agent to:
 * 1. Write actual HTML code (not descriptions)
 * 2. Return the URL in the response
 * 3. Keep responses concise
 */

import { describe, it, expect } from 'vitest';
import { UI_AGENT_PROMPT } from '../../../../src/agents/ui/prompts.js';

describe('UI_AGENT_PROMPT', () => {
  describe('content requirements', () => {
    it('should instruct agent to write HTML code, not descriptions', () => {
      expect(UI_AGENT_PROMPT).toContain('CRITICAL');
      expect(UI_AGENT_PROMPT).toContain('You must pass complete, valid HTML code');
      expect(UI_AGENT_PROMPT).toContain('The tool does NOT generate code');
      expect(UI_AGENT_PROMPT).toContain('YOU must write the actual HTML/CSS/JS code yourself');
    });

    it('should include example tool call with actual HTML', () => {
      expect(UI_AGENT_PROMPT).toContain('"title": "Shopping List"');
      expect(UI_AGENT_PROMPT).toContain('"html": "<style>');
      // Should have actual HTML elements in example
      expect(UI_AGENT_PROMPT).toContain('<div');
      expect(UI_AGENT_PROMPT).toContain('<button');
      expect(UI_AGENT_PROMPT).toContain('onclick=');
    });

    it('should specify the html parameter requirements', () => {
      expect(UI_AGENT_PROMPT).toContain('"html" parameter');
      expect(UI_AGENT_PROMPT).toContain('<style> tag');
      expect(UI_AGENT_PROMPT).toContain('<script> tag');
    });
  });

  describe('URL return instructions', () => {
    it('should have section about returning the URL', () => {
      expect(UI_AGENT_PROMPT).toContain('Returning the URL');
      expect(UI_AGENT_PROMPT).toContain('shortUrl');
    });

    it('should instruct agent to include URL prominently', () => {
      expect(UI_AGENT_PROMPT).toContain('MUST include this URL');
      expect(UI_AGENT_PROMPT).toContain('URL prominently');
    });

    it('should provide response format example', () => {
      expect(UI_AGENT_PROMPT).toContain("Here's your");
      expect(UI_AGENT_PROMPT).toContain('[shortUrl]');
    });

    it('should list what NOT to do', () => {
      expect(UI_AGENT_PROMPT).toContain('Do NOT');
      expect(UI_AGENT_PROMPT).toContain('List features');
      expect(UI_AGENT_PROMPT).toContain('Explain how to use it');
    });
  });

  describe('constraints', () => {
    it('should list network constraints', () => {
      expect(UI_AGENT_PROMPT).toContain('No fetch()');
      expect(UI_AGENT_PROMPT).toContain('XMLHttpRequest');
      expect(UI_AGENT_PROMPT).toContain('WebSocket');
    });

    it('should prohibit external resources', () => {
      expect(UI_AGENT_PROMPT).toContain('No external fonts');
      expect(UI_AGENT_PROMPT).toContain('CDN scripts');
    });

    it('should specify inline code requirements', () => {
      expect(UI_AGENT_PROMPT).toContain('All styling must be in a <style> tag');
      expect(UI_AGENT_PROMPT).toContain('All scripts must be in a <script> tag');
    });
  });

  describe('persistence API', () => {
    it('should document hermesLoadState function', () => {
      expect(UI_AGENT_PROMPT).toContain('hermesLoadState()');
      expect(UI_AGENT_PROMPT).toContain('Returns previously saved state or null');
    });

    it('should document hermesSaveState function', () => {
      expect(UI_AGENT_PROMPT).toContain('hermesSaveState(data)');
      expect(UI_AGENT_PROMPT).toContain('JSON-serializable data');
    });
  });

  describe('placeholders', () => {
    it('should have timeContext placeholder', () => {
      expect(UI_AGENT_PROMPT).toContain('{timeContext}');
    });

    it('should have userContext placeholder', () => {
      expect(UI_AGENT_PROMPT).toContain('{userContext}');
    });
  });

  describe('code quality check', () => {
    it('should instruct agent to review generated code', () => {
      expect(UI_AGENT_PROMPT).toContain('Code Quality Check');
      expect(UI_AGENT_PROMPT).toContain('generatedCode');
    });

    it('should list what to check', () => {
      expect(UI_AGENT_PROMPT).toContain('onclick');
      expect(UI_AGENT_PROMPT).toContain('HTML valid');
      expect(UI_AGENT_PROMPT).toContain('JavaScript have syntax errors');
    });

    it('should instruct to fix issues before sharing URL', () => {
      expect(UI_AGENT_PROMPT).toContain('call generate_ui again with fixes');
      expect(UI_AGENT_PROMPT).toContain('before sharing the URL');
    });
  });

  describe('size limits', () => {
    it('should include size limit information', () => {
      // The prompt uses getSizeLimits() so it should have byte limits
      expect(UI_AGENT_PROMPT).toContain('bytes');
      expect(UI_AGENT_PROMPT).toContain('Size limits');
    });
  });
});
