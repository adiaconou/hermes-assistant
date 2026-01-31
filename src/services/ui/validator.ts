/**
 * @fileoverview Output validation for LLM-generated UI content.
 *
 * Validates size limits and scans for forbidden patterns that could
 * indicate malicious or problematic generated code.
 */

/** Maximum allowed size for HTML content (100KB) */
const MAX_HTML_SIZE = 100 * 1024;

/** Maximum allowed size for CSS content (50KB) */
const MAX_CSS_SIZE = 50 * 1024;

/** Maximum allowed size for JavaScript content (100KB) */
const MAX_JS_SIZE = 100 * 1024;

/**
 * Patterns that should never appear in generated output.
 * These indicate potential network requests, navigation, or other risky behavior.
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Network requests
  { pattern: /\bfetch\s*\(/i, description: 'fetch() call' },
  { pattern: /\bXMLHttpRequest\b/i, description: 'XMLHttpRequest' },
  { pattern: /\bWebSocket\b/i, description: 'WebSocket' },
  { pattern: /\bnew\s+EventSource\b/i, description: 'EventSource (SSE)' },
  { pattern: /\bnavigator\.sendBeacon\s*\(/i, description: 'sendBeacon()' },

  // Navigation/redirects
  { pattern: /\blocation\s*=\s*[^=]/i, description: 'location assignment' },
  { pattern: /\blocation\.href\s*=\s*/i, description: 'location.href assignment' },
  { pattern: /\blocation\.assign\s*\(/i, description: 'location.assign()' },
  { pattern: /\blocation\.replace\s*\(/i, description: 'location.replace()' },
  { pattern: /\bwindow\.open\s*\(/i, description: 'window.open()' },

  // External resources
  { pattern: /<form[^>]*action\s*=\s*["']?https?:/i, description: 'form with external action' },
  { pattern: /<img[^>]*src\s*=\s*["']?https?:/i, description: 'img with external src' },
  { pattern: /<script[^>]*src\s*=/i, description: 'script with src attribute' },
  { pattern: /<link[^>]*href\s*=\s*["']?https?:/i, description: 'link with external href' },

  // Iframe embedding
  { pattern: /<iframe/i, description: 'iframe element' },
];

/**
 * Result of content validation.
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Content to validate.
 */
export interface ContentToValidate {
  html: string;
  css?: string;
  js?: string;
}

/**
 * Validate LLM-generated output before processing.
 *
 * Checks:
 * 1. Size limits for each content type
 * 2. Forbidden patterns that indicate risky behavior
 *
 * @param content - The content to validate
 * @returns Validation result with reason if invalid
 */
export function validateOutput(content: ContentToValidate): ValidationResult {
  // Size checks
  if (content.html.length > MAX_HTML_SIZE) {
    return {
      valid: false,
      reason: `HTML exceeds maximum size of ${MAX_HTML_SIZE} bytes (got ${content.html.length})`,
    };
  }

  if (content.css && content.css.length > MAX_CSS_SIZE) {
    return {
      valid: false,
      reason: `CSS exceeds maximum size of ${MAX_CSS_SIZE} bytes (got ${content.css.length})`,
    };
  }

  if (content.js && content.js.length > MAX_JS_SIZE) {
    return {
      valid: false,
      reason: `JavaScript exceeds maximum size of ${MAX_JS_SIZE} bytes (got ${content.js.length})`,
    };
  }

  // Forbidden pattern checks
  const combined = [content.html, content.css || '', content.js || ''].join('\n');

  for (const { pattern, description } of FORBIDDEN_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        valid: false,
        reason: `Forbidden pattern detected: ${description}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get the size limits for documentation/error messages.
 */
export function getSizeLimits() {
  return {
    html: MAX_HTML_SIZE,
    css: MAX_CSS_SIZE,
    js: MAX_JS_SIZE,
  };
}
