/**
 * Drive Agent
 *
 * Unified agent for Google Workspace file operations (Drive, Sheets, Docs)
 * and image analysis.
 */

import type { AgentCapability, StepResult, AgentExecutionContext } from '../../../executor/types.js';
import { getDriveExecuteWithTools } from '../providers/executor.js';
import { applyAgentContext } from '../../../agents/context.js';
import { DRIVE_AGENT_PROMPT } from './prompt.js';

const DRIVE_TOOLS = [
  'upload_to_drive',
  'list_drive_files',
  'create_drive_folder',
  'read_drive_file',
  'search_drive',
  'get_hermes_folder',
  'create_spreadsheet',
  'read_spreadsheet',
  'write_spreadsheet',
  'append_to_spreadsheet',
  'find_spreadsheet',
  'create_document',
  'read_document',
  'append_to_document',
  'find_document',
  'analyze_image',
];

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

export async function executor(
  task: string,
  context: AgentExecutionContext
): Promise<StepResult> {
  const systemPrompt = applyAgentContext(DRIVE_AGENT_PROMPT, context.userConfig);
  const executeWithTools = getDriveExecuteWithTools();

  return executeWithTools(
    systemPrompt,
    task,
    DRIVE_TOOLS,
    context
  );
}
