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
import { applyAgentContext } from '../context.js';
import { DRIVE_AGENT_PROMPT } from './prompt.js';

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
  const systemPrompt = applyAgentContext(DRIVE_AGENT_PROMPT, context.userConfig);

  return executeWithTools(
    systemPrompt,
    task,
    DRIVE_TOOLS,
    context
  );
}
