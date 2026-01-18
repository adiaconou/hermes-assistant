# Phase 3: Dynamic UI Generation

## Goal

Enable the SMS assistant to generate custom interactive web UIs on-the-fly based on user requests. The user who requests a UI receives a short link back to view their generated page. Access is via a time-limited bearer link (anyone with the link can access until it expires). Optional enhancement: require a SMS-delivered PIN to view.

**Example:** User texts "Make me a grocery list for chicken parmesan" → receives link to interactive checklist page with persistent state.

---

## Success Criteria

```
1. User requests a UI via SMS (e.g., "make me a grocery list")
2. LLM generates HTML/JS for the requested interface
3. User receives a short link in the SMS response
4. Link opens a functional, interactive page (served via app with CSP headers)
5. Page state persists across browser refreshes (localStorage, namespaced by pageId)
6. Page cannot make any network requests (CSP enforced via HTTP response header; meta CSP as defense-in-depth)
7. Links auto-expire after 7 days
```

---

## Scope

### In Scope
- [ ] S3 bucket setup (private, with lifecycle rules, SSE encryption)
- [ ] CSP security wrapper for LLM-generated code (HTTP header + meta tag)
- [ ] S3 upload with UUID-based paths
- [ ] Persistent URL shortener store (Redis *or* DynamoDB TTL) (`/u/:id` → serve page)
- [ ] 7-day TTL with auto-cleanup
- [ ] Abuse controls (Twilio signature verification, rate limits, quotas)
- [ ] Output validation (size limits, forbidden patterns)
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
├── config.ts             # Add AWS + Redis config
├── routes/
│   ├── sms.ts            # Existing SMS webhook (add Twilio signature check)
│   └── redirect.ts       # NEW: Page serve route
├── middleware/
│   └── rateLimit.ts      # NEW: Rate limiting middleware
└── ui/                   # NEW: UI generation module
    ├── index.ts          # Main export: generatePage()
    ├── generator.ts      # CSP wrapper + sanitization
    ├── validator.ts      # NEW: Output validation + forbidden patterns
    ├── uploader.ts       # S3 upload
    └── shortener.ts      # Redis (or DynamoDB) URL shortener with TTL
```

### 2. Dependencies

```bash
npm install @aws-sdk/client-s3 ioredis
npm install --save-dev @types/ioredis
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

### 5. S3 Uploader (`src/ui/uploader.ts`)

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

export class UIUploader {
  private s3: S3Client;
  private bucket: string;

  constructor(config: { region: string; bucket: string }) {
    this.s3 = new S3Client({ region: config.region });
    this.bucket = config.bucket;
  }

  async upload(html: string): Promise<{ pageId: string; s3Key: string }> {
    const pageId = randomUUID();
    const s3Key = `pages/${pageId}/index.html`;

    // Upload the HTML (SSE-S3 encryption applied via bucket default)
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      Body: html,
      ContentType: 'text/html; charset=utf-8',
    }));

    return { pageId, s3Key };
  }

  async fetch(s3Key: string): Promise<string> {
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    }));

    return await response.Body!.transformToString();
  }
}
```

### 6. URL Shortener (`src/ui/shortener.ts`) — Redis-backed

```typescript
import { randomBytes } from 'crypto';
import Redis from 'ioredis';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL!);
  }
  return redis;
}

type ShortUrlEntry = {
  pageId: string;
  s3Key: string;
};

export async function createShortUrl(
  pageId: string,
  s3Key: string,
  ttlDays: number
): Promise<string> {
  const id = randomBytes(10).toString('base64url'); // ~80 bits
  const ttlSeconds = ttlDays * 24 * 60 * 60;

  const entry: ShortUrlEntry = { pageId, s3Key };

  // Redis SET with EX (expiry in seconds) and NX (only if not exists)
  await getRedis().set(
    `u:${id}`,
    JSON.stringify(entry),
    'EX',
    ttlSeconds,
    'NX'
  );

  return id;
}

export async function resolveShortUrl(id: string): Promise<ShortUrlEntry | null> {
  const raw = await getRedis().get(`u:${id}`);
  if (!raw) return null;
  return JSON.parse(raw) as ShortUrlEntry;
}

// Optional: one-time links (consume on first successful resolve)
export async function resolveAndConsumeShortUrl(id: string): Promise<ShortUrlEntry | null> {
  const raw = await getRedis().getdel(`u:${id}`);
  if (!raw) return null;
  return JSON.parse(raw) as ShortUrlEntry;
}
```

### 7. Page Serve Route (`src/routes/redirect.ts`)

```typescript
import { Router } from 'express';
import { resolveShortUrl } from '../ui/shortener.js';
import { UIUploader } from '../ui/uploader.js';
import { CSP_POLICY } from '../ui/generator.js';
import config from '../config.js';

const router = Router();

let uploader: UIUploader | null = null;

function getUploader(): UIUploader {
  if (!uploader) {
    uploader = new UIUploader({
      region: config.aws.region,
      bucket: config.aws.s3Bucket,
    });
  }
  return uploader;
}

router.get('/u/:id', async (req, res) => {
  try {
    const resolved = await resolveShortUrl(req.params.id);

    if (!resolved) {
      return res.status(404).send('Link expired or not found');
    }

    // Fetch HTML from S3 server-side
    const html = await getUploader().fetch(resolved.s3Key);

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
import { UIUploader } from './uploader.js';
import { createShortUrl } from './shortener.js';

let uploader: UIUploader | null = null;

function getUploader(): UIUploader {
  if (!uploader) {
    uploader = new UIUploader({
      region: config.aws.region,
      bucket: config.aws.s3Bucket,
    });
  }
  return uploader;
}

export async function generatePage(options: {
  title: string;
  html: string;
  css?: string;
  js?: string;
  ttlDays?: number;
}): Promise<{ shortUrl: string; pageId: string } | { error: string }> {
  const ttlDays = options.ttlDays ?? config.pageTtlDays;

  // Validate output before processing
  const validation = validateOutput({
    html: options.html,
    css: options.css,
    js: options.js,
  });

  if (!validation.valid) {
    return { error: validation.reason };
  }

  // Upload first to get pageId
  const { pageId, s3Key } = await getUploader().upload(''); // Placeholder, will update

  // Wrap content with CSP security shell (includes pageId for localStorage namespacing)
  const wrappedHtml = wrapWithSecurityShell(
    { html: options.html, css: options.css, js: options.js },
    options.title,
    pageId
  );

  // Actually upload the wrapped HTML
  await getUploader().upload(wrappedHtml);

  // Create short URL (stores pageId + s3Key, not presigned URL)
  const shortId = await createShortUrl(pageId, s3Key, ttlDays);
  const shortUrl = `${config.baseUrl}/u/${shortId}`;

  return { shortUrl, pageId };
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

Add to `.env`:

```bash
# AWS Credentials
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# S3 Bucket
AWS_S3_BUCKET=hermes-generated-pages

# Redis (Railway addon or external)
REDIS_URL=redis://default:password@host:port

# App Settings
PAGE_TTL_DAYS=7
BASE_URL=https://your-railway-app.railway.app

# Rate Limiting
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

### Phase 3a: Infrastructure
1. Create S3 bucket with lifecycle rules + encryption + TLS enforcement
2. Create IAM user with minimal permissions
3. Set up Redis (Railway addon)
4. Configure environment variables

### Phase 3b: Core Module
1. Implement `src/ui/generator.ts` (CSP wrapper with sanitization)
2. Implement `src/ui/validator.ts` (output validation + forbidden patterns)
3. Implement `src/ui/uploader.ts` (S3 upload)
4. Implement `src/ui/shortener.ts` (Redis-backed URL shortener)
5. Implement `src/ui/index.ts` (unified API)
6. Add AWS + Redis config to `src/config.ts`

### Phase 3c: Routes
1. Implement `src/routes/redirect.ts` (page serve with CSP headers)
2. Register `/u/:id` route in `src/index.ts`
3. Add Twilio signature verification to SMS webhook

### Phase 3d: Integration
1. Add LLM integration (builds on Phase 2 messaging foundation)
2. Add `generate_ui` tool for LLM (prompt enforces localStorage namespacing + no-network constraints)
3. Update SMS handler to call UI generation
4. End-to-end testing

### Phase 3e: Abuse Controls
1. Verify Twilio signature on incoming webhooks
2. Implement rate limiting middleware (per phone number and global)
3. Enforce max output size and timeouts
4. Add friendly error SMS for quota exceeded

---

## Transition to Phase 4

Phase 3 establishes the secure UI generation foundation. Future enhancements:

- **Phase 4a**: Template library (faster generation, consistent styling)
- **Phase 4b**: Backend integration (authenticated API calls from pages)
- **Phase 4c**: Collaborative pages (shared state via WebSocket)
- **Phase 4d**: Page analytics (view counts, interaction tracking)
- **Phase 4e**: PIN gate for sensitive pages (optional access control)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-11 | Initial Phase 2 spec |
| 1.1 | 2025-01-11 | Simplified to S3-only (removed CloudFront/Lambda@Edge) |
| 2.0 | 2025-01-11 | Major revision: Redis persistence, server-side page serving with CSP headers, hardened CSP (navigate-to, base-uri, frame-ancestors), enhanced sanitization, output validation, abuse controls, S3 security hardening, localStorage namespacing, ~80-bit short URL IDs, export/import + print support |
