# Google Workspace Integration Design Document

## Overview

Add Google Drive, Sheets, and Docs integration to Hermes, enabling file management, spreadsheet tracking, and document creation. The agent should be intelligent about handling various types of files and images - inferring intent from content and asking clarifying questions when unsure.

**Key Behaviors**:
- When creating NEW files/spreadsheets: Ask the user first
- When updating EXISTING files: Proceed automatically if intent is clear and target is in the Hermes folder
- If a likely match exists outside Hermes: Ask to copy/import into Hermes before writing
- When intent is unclear: Analyze content, then ask targeted clarifying questions
- Default to append; require confirmation for overwrites or destructive edits and provide a brief change summary
- Avoid hardcoded use-case logic - let the LLM decide at runtime

## Current State

- **OAuth**: Google auth exists for Calendar + Gmail (`src/routes/auth.ts`)
- **Service pattern**: Established in `src/services/google/calendar.ts` with token refresh
- **Media handling**: **NOT IMPLEMENTED** - webhook at `src/routes/sms.ts:44-49` only extracts `Body`, ignores `NumMedia`/`MediaUrl*`
- **Vision**: No Claude Vision integration yet

---

## Architecture

### 1. OAuth Scope Updates

**File**: `src/routes/auth.ts`

Add new scopes to existing `SCOPES` array:
```typescript
const SCOPES = [
  // Existing
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  // New
  'https://www.googleapis.com/auth/drive.readonly', // Discover existing files (read-only)
  'https://www.googleapis.com/auth/drive.file',     // Create/modify app-owned files (writes still restricted to Hermes folder)
  'https://www.googleapis.com/auth/spreadsheets',   // Sheets read/write
  'https://www.googleapis.com/auth/documents',      // Docs read/write
];
```

**Note**: Users with existing auth will need to re-authenticate to grant new scopes.

---

### 2. New Services

#### 2.1 Google Drive Service
**File**: `src/services/google/drive.ts`

Following the calendar.ts pattern:

```typescript
// Core interfaces
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  parents?: string[];
}

// Key functions
getOrCreateHermesFolder(phoneNumber): Promise<string>  // Root folder for all Hermes files (store and reuse folder ID)
createFolder(phoneNumber, name, parentId?): Promise<DriveFolder>
listFiles(phoneNumber, folderId?, options?): Promise<DriveFile[]>
uploadFile(phoneNumber, options: UploadOptions): Promise<DriveFile>
downloadFile(phoneNumber, fileId): Promise<Buffer>
findFolder(phoneNumber, name): Promise<DriveFolder | null>
searchFiles(phoneNumber, query: SearchQuery): Promise<DriveFile[]>  // Search by name/type/date
```

**Hermes Folder Strategy**:
- All writes occur inside a "Hermes" folder in My Drive
- Store the folder ID in user config and tag it with Drive `appProperties` (e.g., `hermesFolder=true`) to avoid duplicates
- If the stored folder ID is missing/invalid, search by `appProperties` first, then create if needed
- Optional: if `GOOGLE_SHARED_DRIVE_ID` is set, create/use Hermes folder in that Shared Drive; otherwise default to My Drive
- For Shared Drives, include `driveId`, `supportsAllDrives`, and `includeItemsFromAllDrives` in Drive API calls

#### 2.2 Google Sheets Service
**File**: `src/services/google/sheets.ts`

```typescript
interface Spreadsheet {
  id: string;
  title: string;
  url: string;
}

// Key functions
createSpreadsheet(phoneNumber, title, folderId?): Promise<Spreadsheet>
readRange(phoneNumber, spreadsheetId, range): Promise<CellRange>
writeRange(phoneNumber, spreadsheetId, range, values): Promise<UpdateResult>
appendRows(phoneNumber, spreadsheetId, range, rows): Promise<AppendResult>
findSpreadsheet(phoneNumber, title): Promise<Spreadsheet | null>
```

#### 2.3 Google Docs Service
**File**: `src/services/google/docs.ts`

```typescript
createDocument(phoneNumber, title, content?, folderId?): Promise<Document>
readDocumentContent(phoneNumber, documentId): Promise<DocumentContent>
appendText(phoneNumber, documentId, text): Promise<void>
findDocument(phoneNumber, title): Promise<Document | null>
```

**Placement note**:
- Docs/Sheets are created in My Drive by default; if `folderId` is provided, move the file into the Hermes folder via Drive after creation

**Reliability (minimal)**:
- Retry Google API calls on 429/5xx up to 2 times with short backoff
- Otherwise fail fast with a user-visible "try again later" message

---

### 3. WhatsApp Media Handling

#### 3.1 Webhook Enhancement
**File**: `src/routes/sms.ts`

Update `TwilioWebhookBody` type:
```typescript
type TwilioWebhookBody = {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  // New fields
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  // ... up to MediaUrl9
};
```

Add media extraction:
```typescript
interface MediaAttachment {
  url: string;
  contentType: string;
  index: number;
}

function extractMediaAttachments(body: TwilioWebhookBody): MediaAttachment[]
```

#### 3.2 Twilio Media Download Service
**File**: `src/services/twilio/media.ts`

```typescript
// Download media from Twilio (requires auth)
downloadTwilioMedia(mediaUrl: string): Promise<Buffer>
isImageType(contentType: string): boolean
isAllowedMediaType(contentType: string): boolean
```

**Media limits (keep simple)**:
- Allowlist: `image/jpeg`, `image/png`, `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Size cap: 10MB per attachment
- If unsupported or too large: return a friendly error asking the user to send a smaller/supported file
- Multiple attachments: process all attachments in order; if any need a decision, ask once with a numbered list

#### 3.3 Tool Context Enhancement
**File**: `src/tools/types.ts`

Add media to context so tools can access attachments:
```typescript
export interface ToolContext {
  phoneNumber?: string;
  channel?: 'sms' | 'whatsapp';
  userConfig?: UserConfig | null;
  mediaAttachments?: MediaAttachment[];  // NEW
}
```

#### 3.4 Idempotency (Twilio retries)
- Use `MessageSid` to dedupe inbound messages before processing
- If `MessageSid` was already processed, return a no-op confirmation to avoid duplicate writes
- Persist dedupe state in a new table (e.g., `message_dedupe`) so retries after restarts do not duplicate writes

---

### 4. Vision Integration (Gemini 3 Pro)

**File**: `src/services/google/vision.ts`

We use **Gemini 3 Pro** for image analysis:
- Strong on document/OCR tasks, including complex layouts (receipts, forms, handwritten notes)
- Native OCR capabilities (no external OCR service needed)
- Handles edge cases that confuse standard OCR tools

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Analyze an image using Gemini Vision.
 * The prompt determines what to extract - could be document type identification,
 * text extraction, receipt data, business card info, etc.
 *
 * @param imageBuffer - The image data
 * @param mimeType - MIME type (image/jpeg, image/png, etc.)
 * @param prompt - What to analyze/extract (determined by agent at runtime)
 */
export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string
): Promise<string>
```

**Architecture**: Gemini handles image analysis, Claude handles agent reasoning.

```
WhatsApp Image -> Gemini (extract data) -> Claude (decide what to do)
```

The agent crafts appropriate prompts based on context:
- "What type of document is this? Describe its contents briefly."
- "Extract all text and data from this receipt in JSON format."
- "Extract contact information from this business card."
- "Describe what's in this image."

**Non-image files (PDF/DOC/DOCX)**:
- Upload to Hermes folder and ask what to do next (store only, extract later, or convert)
- Do not run `analyze_image` on non-image files in v1

**Configuration** (add to `src/config.ts`):
```typescript
google: {
  // Existing OAuth settings...
  sharedDriveId: process.env.GOOGLE_SHARED_DRIVE_ID,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3-pro',
}
```

---

### 5. New Tools

#### Drive Tools (`src/tools/drive.ts`)
| Tool | Description |
|------|-------------|
| `upload_to_drive` | Upload file/image to Drive (in Hermes folder) |
| `list_drive_files` | List files in Hermes folder or subfolder |
| `create_drive_folder` | Create folder in Hermes hierarchy |
| `read_drive_file` | Read text file content |
| `search_drive` | Search files by name, type, or date (Hermes folder by default; read-only broader search when needed) |

**Note**: `read_drive_file` is for non-Google-native, text-based files. For Docs/Sheets, use the Docs/Sheets tools (or Drive export if needed).

#### Sheets Tools (`src/tools/sheets.ts`)
| Tool | Description |
|------|-------------|
| `create_spreadsheet` | Create new spreadsheet |
| `read_spreadsheet` | Read range of cells |
| `write_spreadsheet` | Write to specific range |
| `append_to_spreadsheet` | Append rows (for logs/tracking) |
| `find_spreadsheet` | Find by name in Hermes folder |

#### Docs Tools (`src/tools/docs.ts`)
| Tool | Description |
|------|-------------|
| `create_document` | Create new document |
| `read_document` | Read document content |
| `append_to_document` | Append text to end |
| `find_document` | Find by name |

#### Vision Tools (`src/tools/vision.ts`)
| Tool | Description |
|------|-------------|
| `analyze_image` | Analyze image content - can describe, extract text, identify document type, or answer questions about the image |

Note: Rather than specialized tools like `extract_receipt`, the agent uses `analyze_image` with appropriate prompts. The LLM determines what to extract based on context.

---

### 6. New Agent: Drive Agent

**File**: `src/agents/drive/index.ts`

Single unified agent for all Google Workspace file operations:

```typescript
const DRIVE_TOOLS = [
  // Drive
  'upload_to_drive', 'list_drive_files', 'create_drive_folder', 'read_drive_file', 'search_drive',
  // Sheets
  'create_spreadsheet', 'read_spreadsheet', 'write_spreadsheet',
  'append_to_spreadsheet', 'find_spreadsheet',
  // Docs
  'create_document', 'read_document', 'append_to_document', 'find_document',
  // Vision
  'analyze_image',
];

export const capability: AgentCapability = {
  name: 'drive-agent',
  description: 'Manages Google Drive files, Sheets, and Docs. Analyzes and processes images and documents.',
  tools: DRIVE_TOOLS,
  examples: [
    'Save this image to my Drive',
    'Create a spreadsheet to track expenses',
    'What files are in my Hermes folder?',
    'Create a document for meeting notes',
    'What is this document?',  // Triggers image analysis
    '[image attached]',        // Agent analyzes and asks what to do
  ],
};
```

---

### 7. Intelligent Document Processing Flow

The drive-agent should handle various document types intelligently:

```
User sends WhatsApp image/document
         |
         v
[Webhook] Extract media (NumMedia, MediaUrl0, etc.)
         |
         v
[Drive Agent] Analyzes content:
  1. analyze_image - Understand what the document is
     - Receipt? Invoice? Business card? Screenshot? Photo?
         |
         v
  2. Check for existing relevant files in Hermes folder
     - Is there an expense tracker? A contacts list? Related folder?
     - If none found, optionally do a read-only search outside Hermes for likely matches
         |
         v
  3. Decision point:

     CLEAR INTENT + EXISTING FILE:
       -> Proceed automatically
       -> "Added your Costco receipt to Expense Tracker"

     CLEAR INTENT + EXISTING FILE OUTSIDE HERMES:
       -> Ask to copy/import into Hermes before writing
       -> "I found an expense tracker outside Hermes. Want me to copy it into Hermes and use that?"

     CLEAR INTENT + NO EXISTING FILE:
       -> Ask before creating
       -> "This looks like a receipt. Want me to create an
          Expense Tracker spreadsheet to log these?"

     UNCLEAR INTENT:
       -> Ask clarifying question based on content analysis
       -> "I see this is a business card for John Smith.
          Would you like me to save it to a Contacts folder,
          or add to a contacts spreadsheet?"
```

**Example Flows**:

| Input | Agent Behavior |
|-------|----------------|
| Receipt photo (first time) | Analyzes -> "This is a $156 Costco receipt. Want me to create an expense tracker?" |
| Receipt photo (tracker exists in Hermes) | Analyzes -> Uploads to Receipts folder -> Appends to tracker -> Confirms |
| Receipt photo (tracker exists outside Hermes) | Analyzes -> "I found an expense tracker outside Hermes. Want me to copy it into Hermes and use that?" |
| Business card photo | Analyzes -> "Business card for Jane Doe. Save to Drive, add to contacts sheet, or both?" |
| Random screenshot | Analyzes -> "What would you like me to do with this screenshot?" |
| PDF document | Analyzes -> "This appears to be [description]. Where should I save it?" |

**Key Principle**: The LLM decides behavior at runtime based on content analysis and existing file context. No hardcoded category lists or processing rules.

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Update OAuth scopes in `src/routes/auth.ts`
- [ ] Create Drive service (`src/services/google/drive.ts`)
- [ ] Implement Hermes folder management (store folder ID + `appProperties` tag)
- [ ] Create basic Drive tools (upload, list, create folder)
- [ ] Register tools in `src/executor/registry.ts`
- [ ] Add minimal retry/backoff for Google API 429/5xx (2 retries, short backoff)

### Phase 2: Sheets & Docs
- [ ] Create Sheets service (`src/services/google/sheets.ts`)
- [ ] Create Docs service (`src/services/google/docs.ts`)
- [ ] Create Sheets and Docs tools
- [ ] Add unit tests

### Phase 3: Media & Vision
- [ ] Update webhook to extract media (`src/routes/sms.ts`)
- [ ] Create Twilio media download service
- [ ] Enforce media allowlist + 10MB size cap
- [ ] Create Gemini Vision service (`src/services/google/vision.ts`)
- [ ] Add `GEMINI_API_KEY` to config
- [ ] Create vision tool (analyze_image)
- [ ] Add media to ToolContext
- [ ] Add MessageSid dedupe to avoid duplicate writes on webhook retries
- [ ] Add `message_dedupe` table for durable MessageSid tracking

### Phase 4: Agent & Integration
- [ ] Create drive-agent (`src/agents/drive/`)
- [ ] Register agent in `src/executor/router.ts`
- [ ] End-to-end testing
- [ ] Update post-auth message to mention Drive capabilities

---

## Files Summary

### Files to Modify

| File | Change |
|------|--------|
| `src/routes/auth.ts` | Add Drive/Sheets/Docs OAuth scopes |
| `src/routes/sms.ts` | Extract media attachments from webhook |
| `src/tools/types.ts` | Add mediaAttachments to ToolContext |
| `src/config.ts` | Add Gemini + optional Shared Drive config |
| `src/executor/registry.ts` | Register new tools |
| `src/executor/router.ts` | Register drive-agent |

### New Files to Create

| File | Purpose |
|------|---------|
| `src/services/google/drive.ts` | Drive API wrapper |
| `src/services/google/sheets.ts` | Sheets API wrapper |
| `src/services/google/docs.ts` | Docs API wrapper |
| `src/services/twilio/media.ts` | Media download from Twilio |
| `src/services/google/vision.ts` | Gemini 3 Pro vision integration |
| `src/tools/drive.ts` | Drive tools |
| `src/tools/sheets.ts` | Sheets tools |
| `src/tools/docs.ts` | Docs tools |
| `src/tools/vision.ts` | Vision tools |
| `src/agents/drive/index.ts` | Drive agent capability + executor |
| `src/agents/drive/prompt.ts` | Drive agent system prompt |

---

## Verification Plan

1. **OAuth Flow**: Re-authenticate and verify new scopes granted
2. **Drive Operations**:
   - Create folder via tool -> verify in Google Drive web UI
   - Upload test image -> verify appears in Hermes folder
   - List files -> verify correct files returned
   - If `GOOGLE_SHARED_DRIVE_ID` is set -> verify Hermes folder is created in that Shared Drive
3. **Sheets Operations**:
   - Create spreadsheet -> verify in Drive
   - Append rows -> verify data in spreadsheet
4. **Docs Operations**:
   - Create document with content -> verify in Drive
   - Append text -> verify content updated
5. **Image Analysis (E2E)**:
   - Send image via WhatsApp -> verify agent asks clarifying question
   - Reply with intent -> verify file saved correctly
6. **Existing File Detection**:
   - Create expense tracker manually
   - Send receipt -> verify agent finds tracker and asks to copy/import into Hermes before writing
7. **New File Creation Flow**:
   - Clear Hermes folder
   - Send receipt -> verify agent asks before creating tracker
8. **Idempotency**:
   - Simulate duplicate webhook delivery (same MessageSid) -> verify no duplicate writes
9. **Media Limits**:
   - Send unsupported type or >10MB file -> verify friendly error
   - Send multiple attachments -> verify all are uploaded and a single summary/decision is returned
10. **Hermes Folder Enforcement**:
    - Attempt to target a file outside Hermes -> verify agent refuses to write and offers copy/import

---

## Environment Variables

Add to `.env`:
```
# Gemini API (for vision/OCR)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3-pro  # Google's most advanced model for vision/OCR

# Optional: Shared Drive to host Hermes folder (defaults to My Drive)
GOOGLE_SHARED_DRIVE_ID=
```

Get your API key from: https://aistudio.google.com/apikey

---

## Security Considerations

1. **Scoped access**: Use `drive.readonly` for discovery and `drive.file` for app-owned files; enforce writes only within Hermes folder
2. **Hermes folder**: All writes contained within user's Hermes folder; if a file is outside, require copy/import before writing
3. **Credential encryption**: Follows existing AES-256-GCM pattern from calendar/gmail
4. **Media URLs**: Twilio media URLs require authentication (use stored Twilio creds)
5. **No persistence**: Extracted image/document content is used in-memory for the current request and not stored
6. **Access minimization**: Prefer metadata-only queries when discovering files outside Hermes

