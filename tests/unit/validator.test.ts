/**
 * Unit tests for UI output validator.
 *
 * Tests size limits and forbidden pattern detection.
 */

import { describe, it, expect } from 'vitest';
import { validateOutput, getSizeLimits } from '../../src/ui/validator.js';

describe('validateOutput', () => {
  describe('size limits', () => {
    it('should accept content within size limits', () => {
      const result = validateOutput({
        html: '<div>Hello</div>',
        css: 'body { color: red; }',
        js: 'console.log("hi");',
      });

      expect(result.valid).toBe(true);
    });

    it('should reject HTML exceeding size limit', () => {
      const limits = getSizeLimits();
      const oversizedHtml = 'x'.repeat(limits.html + 1);

      const result = validateOutput({
        html: oversizedHtml,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('HTML exceeds maximum size');
      }
    });

    it('should reject CSS exceeding size limit', () => {
      const limits = getSizeLimits();
      const oversizedCss = 'x'.repeat(limits.css + 1);

      const result = validateOutput({
        html: '<div>test</div>',
        css: oversizedCss,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('CSS exceeds maximum size');
      }
    });

    it('should reject JavaScript exceeding size limit', () => {
      const limits = getSizeLimits();
      const oversizedJs = 'x'.repeat(limits.js + 1);

      const result = validateOutput({
        html: '<div>test</div>',
        js: oversizedJs,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('JavaScript exceeds maximum size');
      }
    });

    it('should accept content without optional CSS and JS', () => {
      const result = validateOutput({
        html: '<div>Hello</div>',
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('forbidden patterns - network requests', () => {
    it('should reject fetch() calls', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'fetch("https://example.com").then(r => r.json())',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('fetch() call');
      }
    });

    it('should reject XMLHttpRequest', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'var xhr = new XMLHttpRequest();',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('XMLHttpRequest');
      }
    });

    it('should reject WebSocket', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'const ws = new WebSocket("wss://example.com");',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('WebSocket');
      }
    });

    it('should reject EventSource (SSE)', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'const es = new EventSource("/events");',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('EventSource');
      }
    });

    it('should reject navigator.sendBeacon', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'navigator.sendBeacon("/log", data);',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('sendBeacon');
      }
    });
  });

  describe('forbidden patterns - navigation', () => {
    it('should reject location assignment', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'location = "https://evil.com";',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('location assignment');
      }
    });

    it('should reject location.href assignment', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'location.href = "https://evil.com";',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('location.href');
      }
    });

    it('should reject location.assign()', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'location.assign("https://evil.com");',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('location.assign');
      }
    });

    it('should reject location.replace()', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'location.replace("https://evil.com");',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('location.replace');
      }
    });

    it('should reject window.open()', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: 'window.open("https://evil.com", "_blank");',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('window.open');
      }
    });
  });

  describe('forbidden patterns - external resources', () => {
    it('should reject forms with external action', () => {
      const result = validateOutput({
        html: '<form action="https://evil.com/submit"><input type="text"></form>',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('form with external action');
      }
    });

    it('should reject images with external src', () => {
      const result = validateOutput({
        html: '<img src="https://example.com/image.jpg">',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('img with external src');
      }
    });

    it('should reject scripts with src attribute', () => {
      const result = validateOutput({
        html: '<script src="https://example.com/malicious.js"></script>',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('script with src');
      }
    });

    it('should reject links with external href', () => {
      const result = validateOutput({
        html: '<link href="https://example.com/style.css" rel="stylesheet">',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('link with external href');
      }
    });

    it('should reject iframes', () => {
      const result = validateOutput({
        html: '<iframe src="https://example.com"></iframe>',
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('iframe');
      }
    });
  });

  describe('valid patterns', () => {
    it('should allow inline scripts', () => {
      const result = validateOutput({
        html: '<div id="app"></div>',
        js: 'document.getElementById("app").textContent = "Hello";',
      });

      expect(result.valid).toBe(true);
    });

    it('should allow local storage access via helper functions', () => {
      const result = validateOutput({
        html: '<div>test</div>',
        js: `
          const state = window.hermesLoadState() || {};
          state.count = (state.count || 0) + 1;
          window.hermesSaveState(state);
        `,
      });

      expect(result.valid).toBe(true);
    });

    it('should allow data URIs for images', () => {
      const result = validateOutput({
        html: '<img src="data:image/png;base64,iVBORw0KGgo=">',
      });

      expect(result.valid).toBe(true);
    });

    it('should allow forms without action (submit to same page)', () => {
      const result = validateOutput({
        html: '<form><input type="text"><button type="submit">Submit</button></form>',
      });

      expect(result.valid).toBe(true);
    });

    it('should allow interactive UI with state management', () => {
      const result = validateOutput({
        html: `
          <h1>Grocery List</h1>
          <ul id="items"></ul>
          <input id="newItem" placeholder="Add item">
          <button onclick="addItem()">Add</button>
        `,
        css: `
          body { font-family: sans-serif; padding: 20px; }
          .checked { text-decoration: line-through; opacity: 0.6; }
        `,
        js: `
          let items = window.hermesLoadState()?.items || [];

          function render() {
            const ul = document.getElementById('items');
            ul.innerHTML = items.map((item, i) =>
              '<li class="' + (item.checked ? 'checked' : '') + '" onclick="toggle(' + i + ')">' + item.text + '</li>'
            ).join('');
          }

          function addItem() {
            const input = document.getElementById('newItem');
            if (input.value.trim()) {
              items.push({ text: input.value.trim(), checked: false });
              input.value = '';
              save();
              render();
            }
          }

          function toggle(i) {
            items[i].checked = !items[i].checked;
            save();
            render();
          }

          function save() {
            window.hermesSaveState({ items });
          }

          render();
        `,
      });

      expect(result.valid).toBe(true);
    });
  });
});

describe('getSizeLimits', () => {
  it('should return size limits object', () => {
    const limits = getSizeLimits();

    expect(limits).toHaveProperty('html');
    expect(limits).toHaveProperty('css');
    expect(limits).toHaveProperty('js');
    expect(typeof limits.html).toBe('number');
    expect(typeof limits.css).toBe('number');
    expect(typeof limits.js).toBe('number');
  });

  it('should have reasonable limits', () => {
    const limits = getSizeLimits();

    // HTML should allow at least 50KB
    expect(limits.html).toBeGreaterThanOrEqual(50 * 1024);

    // CSS should allow at least 25KB
    expect(limits.css).toBeGreaterThanOrEqual(25 * 1024);

    // JS should allow at least 50KB
    expect(limits.js).toBeGreaterThanOrEqual(50 * 1024);
  });
});
