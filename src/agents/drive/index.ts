/**
 * Drive Agent
 *
 * Unified agent for Google Workspace file operations (Drive, Sheets, Docs)
 * and image analysis. Handles document processing intelligently based on
 * content type and user context.
 *
 * Capabilities:
 * - Upload, list, and organize files in Drive
 * - Create and manage spreadsheets (expense tracking, logs, etc.)
 * - Create and manage documents (meeting notes, drafts, etc.)
 * - Analyze images (receipts, business cards, screenshots, etc.)
 * - Intelligent document processing based on content analysis
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../executor/types.js';
import { executeWithTools } from '../../executor/tool-executor.js';
import { buildTimeContext } from '../../services/anthropic/prompts/context.js';

/**
 * All tools this agent can use.
 */
const DRIVE_TOOLS = [
  // Drive
  'upload_to_drive',
  'list_drive_files',
  'create_drive_folder',
  'read_drive_file',
  'search_drive',
  'get_hermes_folder',
  // Sheets
  'create_spreadsheet',
  'read_spreadsheet',
  'write_spreadsheet',
  'append_to_spreadsheet',
  'find_spreadsheet',
  // Docs
  'create_document',
  'read_document',
  'append_to_document',
  'find_document',
  // Vision
  'analyze_image',
];

/**
 * Drive agent capability definition.
 */
export const capability: AgentCapability = {
  name: 'drive-agent',
  description: 'Manages Google Drive files, Sheets, and Docs. Analyzes and processes images and documents. Use for file storage, spreadsheet tracking, document creation, and image analysis.',
  tools: DRIVE_TOOLS,
  examples: [
    'Save this image to my Drive',
    'Create a spreadsheet to track expenses',
    'What files are in my Hermes folder?',
    'Create a document for meeting notes',
    'What is this document?',
    '[image attached]',
    'Add this receipt to my expense tracker',
    'Create a contacts sheet from this business card',
  ],
};

/**
 * System prompt for the drive agent.
 */
const DRIVE_AGENT_PROMPT = `You are a file management and document processing assistant.

Your job is to help with Google Drive, Sheets, Docs, and image analysis tasks.

## Core Behaviors

### When Creating NEW Files/Spreadsheets:
- Always ask the user first before creating
- Suggest appropriate organization (folder structure, naming)

### When Updating EXISTING Files:
- Proceed automatically if intent is clear and target is in the Hermes folder
- Confirm if making destructive changes (overwrite, delete)

### When Analyzing Images:
1. First use analyze_image to understand what the document is
2. Then check for existing relevant files (expense tracker, contacts sheet, etc.)
3. Based on content and context, either:
   - Update existing file automatically if intent is clear
   - Ask clarifying questions if unsure what to do

### Document Type Examples:
- **Receipt**: Extract data, ask about expense tracker or just save image
- **Business card**: Extract contact info, ask about contacts sheet
- **Screenshot**: Ask what they'd like to do with it
- **PDF/Document**: Save to Hermes folder, ask about categorization

## Guidelines

1. All files are stored in the user's "Hermes" folder in Google Drive
2. Use search_drive or find_spreadsheet/find_document before creating new files
3. When creating spreadsheets, set up appropriate headers
4. For expense tracking, include columns: Date, Store, Amount, Category, Notes
5. For contacts, include columns: Name, Email, Phone, Company, Notes
6. Provide links to created/updated files when possible
7. Be concise in responses - summarize what was done

## File Operations

- **upload_to_drive**: Save files and images
- **list_drive_files**: See what's in a folder
- **search_drive**: Find files by name/type
- **create_spreadsheet**: New spreadsheet for tracking
- **append_to_spreadsheet**: Add rows to existing sheet
- **create_document**: New document for notes/drafts
- **analyze_image**: Understand image content

{timeContext}

{userContext}`;

/**
 * Execute the drive agent.
 *
 * @param task The drive/file task to perform
 * @param context Execution context
 * @returns StepResult with operation outcome
 */
export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  // Build system prompt with context
  const timeContext = context.userConfig
    ? `Current time: ${buildTimeContext(context.userConfig)}`
    : 'Timezone: not set (ask user for timezone first)';

  const userContext = context.userConfig?.name
    ? `User: ${context.userConfig.name}`
    : '';

  const systemPrompt = DRIVE_AGENT_PROMPT
    .replace('{timeContext}', timeContext)
    .replace('{userContext}', userContext);

  return executeWithTools(
    systemPrompt,
    task,
    DRIVE_TOOLS,
    context
  );
}
