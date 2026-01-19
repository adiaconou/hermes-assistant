/**
 * @fileoverview CSP security wrapper for LLM-generated UI content.
 *
 * This module wraps untrusted LLM output in a security shell that:
 * - Enforces Content Security Policy to block network requests
 * - Sanitizes risky HTML tags and attributes
 * - Provides localStorage namespacing for state persistence
 */

/**
 * Content Security Policy directives.
 * This policy blocks all network activity while allowing inline scripts/styles.
 */
export const CSP_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
  "worker-src 'none'",
].join('; ');

/**
 * Content to be wrapped in the security shell.
 */
export interface GeneratedContent {
  html: string;
  css?: string;
  js?: string;
}

/**
 * Wrap LLM-generated content in a security shell.
 *
 * @param content - The LLM-generated HTML/CSS/JS
 * @param title - Page title (will be escaped)
 * @param pageId - Unique page identifier for localStorage namespacing
 * @returns Complete HTML document with CSP meta tag
 */
export function wrapWithSecurityShell(
  content: GeneratedContent,
  title: string,
  pageId: string
): string {
  const sanitizedHtml = sanitizeHtml(content.html);
  const sanitizedCss = sanitizeText(content.css || '');
  const sanitizedJs = sanitizeText(content.js || '');

  // Namespace for localStorage to isolate page state
  const stateKey = `hermes:page:${pageId}:state:v1`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">
  <title>${escapeHtml(title)}</title>
  <style>
    /* Base styles for generated pages */
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.5;
      padding: 1rem;
      max-width: 600px;
      margin: 0 auto;
    }
    @media print {
      .no-print { display: none; }
    }
    ${sanitizedCss}
  </style>
</head>
<body>
  <script>
    // Namespaced localStorage key for this page
    window.HERMES_STATE_KEY = "${stateKey}";

    // Helper functions for state management
    window.hermesLoadState = function() {
      try {
        const saved = localStorage.getItem(window.HERMES_STATE_KEY);
        return saved ? JSON.parse(saved) : null;
      } catch (e) {
        console.error('Failed to load state:', e);
        return null;
      }
    };

    window.hermesSaveState = function(state) {
      try {
        localStorage.setItem(window.HERMES_STATE_KEY, JSON.stringify(state));
      } catch (e) {
        console.error('Failed to save state:', e);
      }
    };
  </script>
  ${sanitizedHtml}
  <script>${sanitizedJs}</script>
</body>
</html>`;
}

/**
 * Remove meta tags that could override CSP.
 */
function sanitizeText(text: string): string {
  return text.replace(/<meta[^>]*>/gi, '');
}

/**
 * Remove risky HTML elements.
 *
 * Note: Inline event handlers (onclick, etc.) are allowed because:
 * 1. CSP blocks all network requests, so handlers can't exfiltrate data
 * 2. We need onclick for interactive elements (tabs, buttons)
 * 3. The script runs in a sandboxed context anyway
 */
function sanitizeHtml(html: string): string {
  return (
    html
      // Remove risky tags: meta, base, link, iframe, object, embed, frame, frameset
      .replace(/<(meta|base|link|iframe|object|embed|frame|frameset)[^>]*>/gi, '')
      // Remove closing tags for void elements we removed
      .replace(/<\/(iframe|object|embed|frame|frameset)>/gi, '')
  );
}

/**
 * Escape HTML special characters for safe text insertion.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
