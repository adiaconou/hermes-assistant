# Phase 4: Dynamic UI Generation

## Goal

Enable the SMS assistant to generate custom interactive web UIs on-the-fly based on user requests. The user who requests a UI receives a short link back to view their generated page. Access is via a time-limited bearer link (anyone with the link can access until it expires). Optional enhancement: require a SMS-delivered PIN to view.

**Example:** User texts "I want stir fry for dinner" → receives link to interactive grocery checklist page with persistent state that they can check off items at the store.

---

## Design Principles

1. **Incremental Development**: Start simple (localhost), add cloud infrastructure later
2. **Storage Abstraction**: Provider interfaces allow swapping local ↔ cloud storage
3. **Security First**: CSP model works identically in dev and prod
4. **Config-Driven**: Environment variables control which providers are used

---

## Success Criteria

```
1. User requests a UI via SMS (e.g., "make me a grocery list for stir fry")
2. LLM generates HTML/JS for the requested interface
3. User receives a short link in the SMS response
4. Link opens a functional, interactive page (served via app with CSP headers)
5. Page state persists across browser refreshes (localStorage, namespaced by pageId)
6. Page cannot make any network requests (CSP enforced via HTTP response header; meta CSP as defense-in-depth)
7. Links auto-expire after configurable TTL (default 7 days)
```

---

## Scope

### Phase 4a: Local Development (MVP)
- [ ] Storage provider abstraction (interface for upload/fetch)
- [ ] Local file storage provider (`./data/pages/{uuid}/index.html`)
- [ ] In-memory URL shortener with optional JSON persistence
- [ ] CSP security wrapper for LLM-generated code (HTTP header + meta tag)
- [ ] Output validation (size limits, forbidden patterns)
- [ ] Page serve route (`/u/:id`) with security headers
- [ ] LLM tool for generating UI (`generate_ui`)

### Phase 4b: Production Infrastructure
- [ ] S3 storage provider (private bucket, lifecycle rules, SSE encryption)
- [ ] Redis URL shortener provider (TTL-based expiry)
- [ ] Abuse controls (Twilio signature verification, rate limits, quotas)
- [ ] AWS IAM setup with minimal permissions

### Phase 4c: Enhancements
- [ ] Optional export/import of page state (clipboard / textarea; no network)
- [ ] Print-friendly CSS support (LLM includes @media print)

### Out of Scope (Future Phases)
- CloudFront CDN (not needed for single-user)
- Lambda@Edge (CSP via HTTP header instead)
- Backend API calls from generated pages
- User authentication for pages (optional PIN gate documented but not required)
- Shared/collaborative pages
- Page analytics/tracking
- Template library (LLM generates from scratch)

---

## Flow 1: User Requests UI via SMS

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER'S PHONE                                                               │
│  ─────────────                                                              │
│  SMS: "Make me a grocery list for chicken parmesan"                         │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TWILIO                                                                     │
│  ──────                                                                     │
│  Receives SMS, forwards to webhook                                          │
│  POST /webhook/sms { From: "+1234567890", Body: "Make me a grocery..." }    │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  EXPRESS SERVER (Railway)                                                   │
│  ────────────────────────                                                   │
│                                                                             │
│  1. Verify Twilio webhook signature                                         │
│     → Invalid: return 403, log attempt                                      │
│                    │                                                        │
│                    ▼                                                        │
│  2. Check rate limits / quotas                                              │
│     → Exceeded: return friendly error SMS                                   │
│                    │                                                        │
│                    ▼                                                        │
│  3. Parse Twilio webhook body                                               │
│                    │                                                        │
│                    ▼                                                        │
│  4. Call Anthropic LLM with user message + UI contract                      │
│     → LLM returns JSON: { title, html, css, js }                            │
│                    │                                                        │
│                    ▼                                                        │
│  5. Validate + scan output (size + forbidden patterns)                      │
│     → Reject if size limits exceeded or dangerous patterns found            │
│                    │                                                        │
│                    ▼                                                        │
│  6. Wrap LLM output in security shell                                       │
│     → Prepend CSP <meta> tag (defense-in-depth)                             │
│     → Sanitize risky tags/attributes from LLM output                        │
│     → Result: complete HTML document                                        │
│                    │                                                        │
│                    ▼                                                        │
│  7. Upload to S3                                                            │
│     → Path: pages/{uuid}/index.html                                         │
│     → Returns: pageId                                                       │
│                    │                                                        │
│                    ▼                                                        │
│  8. Store mapping in shortener store (TTL 7 days)                           │
│     → Store mapping: "abc123XYZw" → { pageId }                              │
│     → Short URL: https://app.railway.app/u/abc123XYZw                       │
│                    │                                                        │
│                    ▼                                                        │
│  9. Return TwiML response with short URL                                    │
│                                                                             │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TWILIO                                                                     │
│  ──────                                                                     │
│  Sends SMS back to user                                                     │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER'S PHONE                                                               │8
│  ─────────────                                                              │
│  SMS received: "Here's your grocery list: https://app.railway.app/u/abc..." │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Flow 2: User Clicks the URL

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER'S PHONE (Browser)                                                     │
│  ──────────────────────                                                     │
│  User taps link: https://app.railway.app/u/abc123XYZw                       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  EXPRESS SERVER (Railway)                                                   │
│  ────────────────────────                                                   │
│                                                                             │
│  GET /u/abc123XYZw                                                          │
│                    │                                                        │
│                    ▼                                                        │
│  1. Look up "abc123XYZw" in shortener store                                 │
│     → Found: pageId                                                         │
│     → Not found or expired: return 404                                      │
│                    │                                                        │
│                    ▼                                                        │
│  2. Fetch HTML from S3 (server-side, using IAM credentials)                 │
│                    │                                                        │
│                    ▼                                                        │
│  3. Return 200 HTML with CSP + security headers                             │
│     → Content-Security-Policy (primary enforcement)                         │
│     → Referrer-Policy: no-referrer                                          │
│     → X-Content-Type-Options: nosniff                                       │
│     → Cross-Origin-Opener-Policy: same-origin                               │
│     → Cross-Origin-Resource-Policy: same-origin                             │
│                                                                             │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  AWS S3                                                                     │
│  ──────                                                                     │
│  Private object store only (server reads with IAM)                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER'S BROWSER                                                             │
│  ──────────────                                                             │
│                                                                             │
│  1. Parse HTML, CSP enforced via HTTP header (strongest)                    │
│     → Browser enforces: no fetch, no external resources, no form submit     │
│     → Meta CSP provides defense-in-depth                                    │
│                    │                                                        │
│                    ▼                                                        │
│  2. Render LLM-generated UI (grocery list)                                  │
│     → Interactive checkboxes work                                           │
│     → localStorage works (state persists on refresh, namespaced by pageId)  │
│     → Any malicious fetch() calls are BLOCKED by CSP                        │
│     → Navigation exfil attempts are BLOCKED by CSP navigate-to              │
│                    │                                                        │
│                    ▼                                                        │
│  3. User interacts with grocery list                                        │
│     → Checks off items                                                      │
│     → State saved to localStorage                                           │
│     → Export/Import state via clipboard (no network)                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Security Model

### Why we need CSP (even for single user)

The risk isn't unauthorized access—bearer links handle that. The risk is **prompt injection**: a malicious recipe or input could trick the LLM into generating JavaScript that:
- Exfiltrates your data to external servers
- Redirects you to phishing sites
- Runs crypto miners in your browser

### How CSP protects you

The CSP is delivered via **HTTP response header** (primary enforcement) plus an embedded `<meta>` tag (defense-in-depth) in the HTML wrapper that **our code** generates (not the LLM). The browser enforces it before any LLM-generated code runs.

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  base-uri 'none';
  object-src 'none';
  frame-ancestors 'none';
  script-src 'unsafe-inline';
  style-src 'unsafe-inline';
  img-src data:;
  connect-src 'none';
  form-action 'none';
  navigate-to 'none';
">
```

| Directive | Effect |
|-----------|--------|
| `default-src 'none'` | Denies everything not explicitly allowed |
| `base-uri 'none'` | Prevents `<base>` tricks affecting relative URLs |
| `object-src 'none'` | Blocks plugins like Flash/Java |
| `frame-ancestors 'none'` | Prevents clickjacking embedding |
| `connect-src 'none'` | Blocks fetch, XHR, WebSocket - **no data exfiltration** |
| `form-action 'none'` | Blocks form submissions to external sites |
| `navigate-to 'none'` | Blocks JS-driven navigation / redirects (exfil via URL) |
| `worker-src 'none'` | Blocks Web Workers |

### Access Control

- **Bearer links**: Anyone with the short link can access until expiry (7 days)
- **Optional PIN gate**: Require a short PIN delivered via SMS before rendering the page (future enhancement)
- **UUID paths**: 122 bits of randomness (unguessable)
- **Short URL IDs**: ~80 bits of randomness (unguessable, resistant to enumeration)
- **S3 lifecycle rules**: Auto-delete pages after 7 days

### Abuse Controls

- **Twilio signature verification**: Reject forged webhook requests
- **Per-phone rate limits**: e.g., 5 pages/day/number
- **Global rate limits**: Prevent DoS on the generation endpoint
- **Output size limits**: Max HTML/CSS/JS size to avoid multi-MB responses
- **Forbidden pattern scanning**: Reject outputs with dangerous patterns before wrapping

### What Malicious Code CANNOT Do

Even if the LLM is tricked into generating malicious code:
- Cannot send data to external servers (blocked by CSP)
- Cannot submit forms (blocked by CSP)
- Cannot load external scripts/images (blocked by CSP)
- Cannot navigate to external URLs (blocked by CSP navigate-to)
- Cannot run crypto miners (Web Workers blocked)
- Cannot be embedded in iframes (blocked by frame-ancestors)
- Cannot persist beyond TTL (auto-deleted)

### What Generated Code CAN Do

- Run JavaScript locally in the browser
- Use localStorage for state persistence (namespaced by pageId)
- Render interactive UI elements
- Use inline styles and scripts
- Display data: URIs for images
- Export/import state via clipboard

---

## Technical Implementation

### 1. Project Structure

```
src/
├── index.ts              # Express entry (add /u/:id route)
├── config.ts             # Add storage provider config
├── routes/
│   ├── sms.ts            # Existing SMS webhook
│   └── pages.ts          # NEW: Page serve route (/u/:id)
├── middleware/
│   └── rateLimit.ts      # NEW: Rate limiting middleware (Phase 4b)
└── ui/                   # NEW: UI generation module
    ├── index.ts          # Main export: generatePage()
    ├── generator.ts      # CSP wrapper + sanitization
    ├── validator.ts      # Output validation + forbidden patterns
    ├── providers/        # Storage abstraction layer
    │   ├── types.ts      # Provider interfaces
    │   ├── local-storage.ts    # Local file storage (Phase 4a)
    │   ├── memory-shortener.ts # In-memory shortener (Phase 4a)
    │   ├── s3-storage.ts       # S3 storage (Phase 4b)
    │   └── redis-shortener.ts  # Redis shortener (Phase 4b)
    └── provider-factory.ts     # Creates providers based on config
```

### 2. Dependencies

**Phase 4a (Local Development):**
```bash
# No additional dependencies needed - uses Node.js fs
```

**Phase 4b (Production):**
```bash
npm install @aws-sdk/client-s3 ioredis
npm install --save-dev @types/ioredis
```

### 3. Provider Interfaces (`src/ui/providers/types.ts`)

```typescript
/**
 * Storage provider for generated HTML pages.
 * Implementations: LocalFileStorage (dev), S3Storage (prod)
 */
export interface PageStorage {
  /**
   * Upload HTML content and return identifiers
   */
  upload(html: string): Promise<{ pageId: string; key: string }>;

  /**
   * Fetch HTML content by key
   */
  fetch(key: string): Promise<string>;
}

/**
 * URL shortener provider for page links.
 * Implementations: MemoryShortener (dev), RedisShortener (prod)
 */
export interface UrlShortener {
  /**
   * Create a short URL mapping
   */
  create(pageId: string, key: string, ttlDays: number): Promise<string>;

  /**
   * Resolve a short URL to its page info, or null if expired/not found
   */
  resolve(id: string): Promise<{ pageId: string; key: string } | null>;
}

export type ShortUrlEntry = {
  pageId: string;
  key: string;
  createdAt: number;
  expiresAt: number;
};
```

### 4. Local File Storage (`src/ui/providers/local-storage.ts`)

```typescript
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { PageStorage } from './types.js';

export class LocalFileStorage implements PageStorage {
  private basePath: string;

  constructor(basePath: string = './data/pages') {
    this.basePath = basePath;
  }

  async upload(html: string): Promise<{ pageId: string; key: string }> {
    const pageId = randomUUID();
    const key = `${pageId}/index.html`;
    const dirPath = join(this.basePath, pageId);
    const filePath = join(dirPath, 'index.html');

    // Ensure directory exists
    await mkdir(dirPath, { recursive: true });

    // Write HTML file
    await writeFile(filePath, html, 'utf-8');

    return { pageId, key };
  }

  async fetch(key: string): Promise<string> {
    const filePath = join(this.basePath, key);
    return readFile(filePath, 'utf-8');
  }
}
```

### 5. In-Memory URL Shortener (`src/ui/providers/memory-shortener.ts`)

```typescript
import { randomBytes } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { UrlShortener, ShortUrlEntry } from './types.js';

/**
 * In-memory URL shortener with optional JSON file persistence.
 * Suitable for development; entries survive restarts if persistPath is set.
 */
export class MemoryShortener implements UrlShortener {
  private store = new Map<string, ShortUrlEntry>();
  private persistPath?: string;
  private loaded = false;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded || !this.persistPath) return;

    try {
      const data = await readFile(this.persistPath, 'utf-8');
      const entries = JSON.parse(data) as Record<string, ShortUrlEntry>;
      const now = Date.now();

      // Load non-expired entries
      for (const [id, entry] of Object.entries(entries)) {
        if (entry.expiresAt > now) {
          this.store.set(id, entry);
        }
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;

    const entries: Record<string, ShortUrlEntry> = {};
    for (const [id, entry] of this.store.entries()) {
      entries[id] = entry;
    }

    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(entries, null, 2));
  }

  async create(pageId: string, key: string, ttlDays: number): Promise<string> {
    await this.ensureLoaded();

    const id = randomBytes(10).toString('base64url'); // ~80 bits
    const now = Date.now();
    const entry: ShortUrlEntry = {
      pageId,
      key,
      createdAt: now,
      expiresAt: now + ttlDays * 24 * 60 * 60 * 1000,
    };

    this.store.set(id, entry);
    await this.persist();

    return id;
  }

  async resolve(id: string): Promise<{ pageId: string; key: string } | null> {
    await this.ensureLoaded();

    const entry = this.store.get(id);
    if (!entry) return null;

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.store.delete(id);
      await this.persist();
      return null;
    }

    return { pageId: entry.pageId, key: entry.key };
  }
}
```

### 6. Provider Factory (`src/ui/provider-factory.ts`)

```typescript
import type { PageStorage, UrlShortener } from './providers/types.js';
import { LocalFileStorage } from './providers/local-storage.js';
import { MemoryShortener } from './providers/memory-shortener.js';
// Phase 4b imports (uncomment when implementing):
// import { S3Storage } from './providers/s3-storage.js';
// import { RedisShortener } from './providers/redis-shortener.js';
import config from '../config.js';

let storageInstance: PageStorage | null = null;
let shortenerInstance: UrlShortener | null = null;

export function getStorage(): PageStorage {
  if (!storageInstance) {
    const provider = config.ui?.storageProvider || 'local';

    switch (provider) {
      case 'local':
        storageInstance = new LocalFileStorage(config.ui?.localStoragePath || './data/pages');
        break;
      case 's3':
        // Phase 4b: uncomment when S3 provider is implemented
        // storageInstance = new S3Storage({
        //   region: config.aws.region,
        //   bucket: config.aws.s3Bucket,
        // });
        throw new Error('S3 storage provider not yet implemented');
      default:
        throw new Error(`Unknown storage provider: ${provider}`);
    }
  }
  return storageInstance;
}

export function getShortener(): UrlShortener {
  if (!shortenerInstance) {
    const provider = config.ui?.shortenerProvider || 'memory';

    switch (provider) {
      case 'memory':
        shortenerInstance = new MemoryShortener(config.ui?.shortenerPersistPath);
        break;
      case 'redis':
        // Phase 4b: uncomment when Redis provider is implemented
        // shortenerInstance = new RedisShortener(config.redis.url);
        throw new Error('Redis shortener provider not yet implemented');
      default:
        throw new Error(`Unknown shortener provider: ${provider}`);
    }
  }
  return shortenerInstance;
}
```

### 3. CSP Wrapper (`src/ui/generator.ts`)

```typescript
const CSP_POLICY = [
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
  "worker-src 'none'"
].join('; ');

export { CSP_POLICY };

export function wrapWithSecurityShell(content: {
  html: string;
  css?: string;
  js?: string;
}, title: string, pageId: string): string {
  // Sanitize risky tags/attrs from LLM output (defense-in-depth)
  const sanitizedHtml = sanitizeHtml(content.html);
  const sanitizedCss = sanitizeText(content.css || '');
  const sanitizedJs = sanitizeText(content.js || '');

  // Inject pageId for localStorage namespacing
  const stateKey = `hermes:page:${pageId}:state:v1`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">
  <title>${escapeHtml(title)}</title>
  <style>
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
  </script>
  ${sanitizedHtml}
  <script>${sanitizedJs}</script>
</body>
</html>`;
}

function sanitizeText(text: string): string {
  return text.replace(/<meta[^>]*>/gi, '');
}

function sanitizeHtml(html: string): string {
  return html
    // Remove risky tags: meta, base, link, iframe, object, embed
    .replace(/<(meta|base|link|iframe|object|embed)[^>]*>/gi, '')
    // Remove inline event handlers (onclick, onerror, etc.)
    .replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

### 4. Output Validator (`src/ui/validator.ts`)

```typescript
const MAX_HTML_SIZE = 100 * 1024; // 100KB
const MAX_CSS_SIZE = 50 * 1024;   // 50KB
const MAX_JS_SIZE = 100 * 1024;   // 100KB

// Patterns that should never appear in generated output
const FORBIDDEN_PATTERNS = [
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i,
  /\bWebSocket\b/i,
  /\bnew\s+EventSource\b/i,
  /\blocation\s*=\s*/i,
  /\blocation\.href\s*=\s*/i,
  /\blocation\.assign\s*\(/i,
  /\blocation\.replace\s*\(/i,
  /\bwindow\.open\s*\(/i,
  /\bnavigator\.sendBeacon\s*\(/i,
  /<form[^>]*action\s*=\s*["']?https?:/i,
  /<img[^>]*src\s*=\s*["']?https?:/i,
  /<script[^>]*src\s*=/i,
  /<link[^>]*href\s*=\s*["']?https?:/i,
];

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export function validateOutput(content: {
  html: string;
  css?: string;
  js?: string;
}): ValidationResult {
  // Size checks
  if (content.html.length > MAX_HTML_SIZE) {
    return { valid: false, reason: `HTML exceeds ${MAX_HTML_SIZE} bytes` };
  }
  if (content.css && content.css.length > MAX_CSS_SIZE) {
    return { valid: false, reason: `CSS exceeds ${MAX_CSS_SIZE} bytes` };
  }
  if (content.js && content.js.length > MAX_JS_SIZE) {
    return { valid: false, reason: `JS exceeds ${MAX_JS_SIZE} bytes` };
  }

  // Forbidden pattern checks
  const combined = [content.html, content.css || '', content.js || ''].join('\n');
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(combined)) {
      return { valid: false, reason: `Forbidden pattern detected: ${pattern.source}` };
    }
  }

  return { valid: true };
}
```

### 7. Page Serve Route (`src/routes/pages.ts`)

```typescript
import { Router } from 'express';
import { getStorage, getShortener } from '../ui/provider-factory.js';
import { CSP_POLICY } from '../ui/generator.js';

const router = Router();

router.get('/u/:id', async (req, res) => {
  try {
    const shortener = getShortener();
    const storage = getStorage();

    const resolved = await shortener.resolve(req.params.id);

    if (!resolved) {
      return res.status(404).send('Link expired or not found');
    }

    // Fetch HTML from storage (local file or S3, depending on config)
    const html = await storage.fetch(resolved.key);

    // Set security headers (stronger than meta CSP alone)
    res.setHeader('Content-Security-Policy', CSP_POLICY);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, no-cache');

    res.type('html').send(html);
  } catch (error) {
    console.error('Error serving page:', error);
    res.status(500).send('Error loading page');
  }
});

export default router;
```

### 8. Main Export (`src/ui/index.ts`)

```typescript
import config from '../config.js';
import { wrapWithSecurityShell } from './generator.js';
import { validateOutput } from './validator.js';
import { getStorage, getShortener } from './provider-factory.js';

export async function generatePage(options: {
  title: string;
  html: string;
  css?: string;
  js?: string;
  ttlDays?: number;
}): Promise<{ shortUrl: string; pageId: string } | { error: string }> {
  const ttlDays = options.ttlDays ?? config.ui?.pageTtlDays ?? 7;

  // Validate output before processing
  const validation = validateOutput({
    html: options.html,
    css: options.css,
    js: options.js,
  });

  if (!validation.valid) {
    return { error: validation.reason };
  }

  const storage = getStorage();
  const shortener = getShortener();

  // Generate a temporary pageId for the security shell
  const tempPageId = crypto.randomUUID();

  // Wrap content with CSP security shell (includes pageId for localStorage namespacing)
  const wrappedHtml = wrapWithSecurityShell(
    { html: options.html, css: options.css, js: options.js },
    options.title,
    tempPageId
  );

  // Upload the wrapped HTML
  const { pageId, key } = await storage.upload(wrappedHtml);

  // Create short URL
  const shortId = await shortener.create(pageId, key, ttlDays);
  const shortUrl = `${config.baseUrl}/u/${shortId}`;

  return { shortUrl, pageId };
}
```

---

## Phase 4b: Production Providers (S3 + Redis)

### S3 Storage Provider (`src/ui/providers/s3-storage.ts`)

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import type { PageStorage } from './types.js';

export class S3Storage implements PageStorage {
  private s3: S3Client;
  private bucket: string;

  constructor(config: { region: string; bucket: string }) {
    this.s3 = new S3Client({ region: config.region });
    this.bucket = config.bucket;
  }

  async upload(html: string): Promise<{ pageId: string; key: string }> {
    const pageId = randomUUID();
    const key = `pages/${pageId}/index.html`;

    // Upload the HTML (SSE-S3 encryption applied via bucket default)
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: html,
      ContentType: 'text/html; charset=utf-8',
    }));

    return { pageId, key };
  }

  async fetch(key: string): Promise<string> {
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));

    return await response.Body!.transformToString();
  }
}
```

### Redis Shortener Provider (`src/ui/providers/redis-shortener.ts`)

```typescript
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import type { UrlShortener } from './types.js';

export class RedisShortener implements UrlShortener {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async create(pageId: string, key: string, ttlDays: number): Promise<string> {
    const id = randomBytes(10).toString('base64url'); // ~80 bits
    const ttlSeconds = ttlDays * 24 * 60 * 60;

    const entry = JSON.stringify({ pageId, key });

    // Redis SET with EX (expiry in seconds)
    await this.redis.set(`u:${id}`, entry, 'EX', ttlSeconds);

    return id;
  }

  async resolve(id: string): Promise<{ pageId: string; key: string } | null> {
    const raw = await this.redis.get(`u:${id}`);
    if (!raw) return null;
    return JSON.parse(raw);
  }
}
```

---

## AWS Infrastructure Setup

### S3 Bucket Only (Simplified)

```bash
# Create bucket (private by default)
aws s3 mb s3://hermes-generated-pages --region us-east-1

# Block all public access
aws s3api put-public-access-block \
  --bucket hermes-generated-pages \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enforce bucket owner for all objects (recommended)
aws s3api put-bucket-ownership-controls \
  --bucket hermes-generated-pages \
  --ownership-controls '{
    "Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]
  }'

# Default encryption at rest (SSE-S3)
aws s3api put-bucket-encryption \
  --bucket hermes-generated-pages \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
  }'

# Add lifecycle rule (7-day expiration)
aws s3api put-bucket-lifecycle-configuration \
  --bucket hermes-generated-pages \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "ExpirePages",
      "Status": "Enabled",
      "Filter": { "Prefix": "pages/" },
      "Expiration": { "Days": 7 }
    }]
  }'

# (Optional) Bucket policy: deny any non-TLS (aws:SecureTransport=false)
aws s3api put-bucket-policy \
  --bucket hermes-generated-pages \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "DenyNonTLS",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::hermes-generated-pages",
        "arn:aws:s3:::hermes-generated-pages/*"
      ],
      "Condition": {
        "Bool": { "aws:SecureTransport": "false" }
      }
    }]
  }'
```

### IAM Policy for App

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::hermes-generated-pages/pages/*"
    }
  ]
}
```

---

## Environment Variables

### Phase 4a (Local Development)

Add to `.env`:

```bash
# App Settings
BASE_URL=http://localhost:3000
PAGE_TTL_DAYS=7

# UI Storage (defaults work for local dev)
UI_STORAGE_PROVIDER=local              # 'local' (default) or 's3'
UI_LOCAL_STORAGE_PATH=./data/pages     # Local file storage path
UI_SHORTENER_PROVIDER=memory           # 'memory' (default) or 'redis'
UI_SHORTENER_PERSIST_PATH=./data/shortener.json  # Optional: persist links across restarts
```

### Phase 4b (Production)

Add to `.env`:

```bash
# App Settings
BASE_URL=https://your-railway-app.railway.app
PAGE_TTL_DAYS=7

# UI Storage - Production
UI_STORAGE_PROVIDER=s3
UI_SHORTENER_PROVIDER=redis

# AWS Credentials
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=hermes-generated-pages

# Redis (Railway addon or external)
REDIS_URL=redis://default:password@host:port

# Rate Limiting (Phase 4b)
RATE_LIMIT_PAGES_PER_DAY_PER_NUMBER=5
RATE_LIMIT_GLOBAL_PAGES_PER_MINUTE=20
```

---

## Testing Checklist

### Unit Tests
- [ ] CSP wrapper strips meta/base/link/iframe/object/embed tags from LLM output
- [ ] CSP wrapper removes inline event handlers (onclick, onerror, etc.)
- [ ] CSP wrapper escapes HTML special characters in title
- [ ] Output validator rejects forbidden patterns (fetch/WebSocket/location redirects/forms)
- [ ] Output validator enforces max size limits
- [ ] UUID generation produces valid UUIDs
- [ ] Short URL generation/resolution works (Redis)
- [ ] Expired short URLs return null

### Integration Tests
- [ ] S3 upload succeeds with correct content type
- [ ] Page serve route fetches from S3 and returns with CSP headers
- [ ] Expired Redis entries return 404
- [ ] Short URL serves page correctly

### Manual Tests
- [ ] Generate a grocery list page via SMS
- [ ] Click link, verify page loads
- [ ] Check items, refresh page, verify state persists (localStorage; keys namespaced by pageId)
- [ ] Open DevTools console, run `fetch('https://evil.com')` - verify CSP blocks it
- [ ] Open DevTools console, run `location = 'https://evil.com'` - verify CSP blocks it
- [ ] Open DevTools Network tab - confirm no outbound requests
- [ ] Test export/import state functionality
- [ ] Test print mode (Ctrl+P or print button)

### Security Tests
- [ ] Verify CSP header present in HTTP response
- [ ] Verify CSP meta tag present in HTML source (defense-in-depth)
- [ ] Attempt to inject `<meta>` tag via LLM - verify it's stripped
- [ ] Attempt to inject `<base>` tag via LLM - verify it's stripped
- [ ] Attempt to inject inline event handlers - verify they're stripped
- [ ] Verify Twilio signature validation rejects forged requests
- [ ] Verify per-number quota enforcement (e.g., 5 pages/day) and friendly error SMS
- [ ] Verify large/malicious outputs are rejected (size limits)
- [ ] Attempt to guess other short URL IDs - verify not found (80-bit randomness)
- [ ] Verify S3 objects are not publicly accessible

---

## Cost Estimate

| Item | Cost |
|------|------|
| S3 storage | ~$0.023/GB/month (minimal for HTML) |
| S3 requests | ~$0.0004/1000 PUT, $0.0004/1000 GET |
| Redis (Railway) | ~$5/month for small addon |
| **Per page generated** | ~$0.0001 (S3 only) |

**Note:** No CloudFront or Lambda costs - this is significantly cheaper than the original architecture.

---

## Implementation Phases

### Phase 4a: Local Development (MVP)

**Goal:** Working UI generation on localhost with no cloud dependencies.

1. **Provider Abstraction**
   - Implement `src/ui/providers/types.ts` (interfaces)
   - Implement `src/ui/providers/local-storage.ts` (file-based storage)
   - Implement `src/ui/providers/memory-shortener.ts` (in-memory with optional persistence)
   - Implement `src/ui/provider-factory.ts` (config-driven provider selection)

2. **Core Module**
   - Implement `src/ui/generator.ts` (CSP wrapper with sanitization)
   - Implement `src/ui/validator.ts` (output validation + forbidden patterns)
   - Implement `src/ui/index.ts` (unified API using providers)
   - Add UI config section to `src/config.ts`

3. **Routes**
   - Implement `src/routes/pages.ts` (page serve with CSP headers)
   - Register `/u/:id` route in `src/index.ts`

4. **LLM Integration**
   - Add `generate_ui` tool for LLM
   - Tool prompt enforces localStorage namespacing + no-network constraints
   - Test with grocery list use case

5. **Manual Testing**
   - Generate grocery list via local endpoint
   - Verify page loads at `http://localhost:3000/u/{id}`
   - Verify localStorage persistence works
   - Verify CSP blocks network requests in DevTools

### Phase 4b: Production Infrastructure

**Goal:** Swap local providers for cloud-backed (S3 + Redis) with no code changes.

1. **Cloud Providers**
   - Implement `src/ui/providers/s3-storage.ts`
   - Implement `src/ui/providers/redis-shortener.ts`
   - Update `provider-factory.ts` to enable S3/Redis

2. **AWS Setup**
   - Create S3 bucket with lifecycle rules + encryption + TLS enforcement
   - Create IAM user with minimal permissions
   - Set up Redis (Railway addon)

3. **Abuse Controls**
   - Add Twilio signature verification to SMS webhook
   - Implement rate limiting middleware (per phone number and global)
   - Enforce max output size and timeouts
   - Add friendly error SMS for quota exceeded

4. **Environment Configuration**
   - Update Railway environment variables
   - Test with production providers

### Phase 4c: Enhancements

**Goal:** Polish and additional features.

1. Export/import page state via clipboard
2. Print-friendly CSS support
3. Better error handling and user feedback

---

## Future Phases (Phase 5+)

Phase 4 establishes the secure UI generation foundation. Future enhancements:

- **Phase 5a**: Template library (faster generation, consistent styling)
- **Phase 5b**: Backend integration (authenticated API calls from pages)
- **Phase 5c**: Collaborative pages (shared state via WebSocket)
- **Phase 5d**: Page analytics (view counts, interaction tracking)
- **Phase 5e**: PIN gate for sensitive pages (optional access control)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-11 | Initial Phase 2 spec |
| 1.1 | 2025-01-11 | Simplified to S3-only (removed CloudFront/Lambda@Edge) |
| 2.0 | 2025-01-11 | Major revision: Redis persistence, server-side page serving with CSP headers, hardened CSP (navigate-to, base-uri, frame-ancestors), enhanced sanitization, output validation, abuse controls, S3 security hardening, localStorage namespacing, ~80-bit short URL IDs, export/import + print support |
| 3.0 | 2025-01-18 | Renamed to Phase 4. Added storage provider abstraction for incremental development. Phase 4a: local file storage + memory shortener for dev. Phase 4b: S3 + Redis for production. Config-driven provider selection. |
