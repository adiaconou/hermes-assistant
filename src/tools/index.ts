/**
 * Tool registry (canonical).
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDefinition, ToolHandler, ToolContext } from './types.js';

import { generateUi } from '../domains/ui/runtime/tools.js';
import { getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, resolveDateTool } from '../domains/calendar/runtime/tools.js';
import { getEmails, readEmail, getEmailThread } from '../domains/email/runtime/tools.js';
import { extractMemory, listMemories, updateMemory, removeMemory } from '../domains/memory/runtime/tools.js';
import { setUserConfig, deleteUserData } from './user-config.js';
import { createScheduledJob, listScheduledJobs, updateScheduledJob, deleteScheduledJob } from '../domains/scheduler/runtime/tools.js';
import { formatMapsLink } from './maps.js';
// Google Workspace tools
import { uploadToDrive, listDriveFiles, createDriveFolder, readDriveFile, searchDrive, getHermesFolder } from '../domains/drive/runtime/tools.js';
import { createSpreadsheetTool, readSpreadsheet, writeSpreadsheet, appendToSpreadsheet, findSpreadsheetTool } from '../domains/drive/runtime/tools.js';
import { createDocumentTool, readDocument, appendToDocument, findDocumentTool } from '../domains/drive/runtime/tools.js';
import { analyzeImageTool } from '../domains/drive/runtime/tools.js';
// Email watcher toggle (retained)
import {
  toggleEmailWatcher,
} from '../domains/email-watcher/runtime/tools.js';

/**
 * All tool definitions.
 */
const allTools: ToolDefinition[] = [
  // UI
  generateUi,
  // Calendar
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  resolveDateTool,
  // Email
  getEmails,
  readEmail,
  getEmailThread,
  // Memory
  extractMemory,
  listMemories,
  updateMemory,
  removeMemory,
  // User Config
  setUserConfig,
  deleteUserData,
  // Scheduler
  createScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
  deleteScheduledJob,
  // Maps
  formatMapsLink,
  // Drive
  uploadToDrive,
  listDriveFiles,
  createDriveFolder,
  readDriveFile,
  searchDrive,
  getHermesFolder,
  // Sheets
  createSpreadsheetTool,
  readSpreadsheet,
  writeSpreadsheet,
  appendToSpreadsheet,
  findSpreadsheetTool,
  // Docs
  createDocumentTool,
  readDocument,
  appendToDocument,
  findDocumentTool,
  // Vision
  analyzeImageTool,
  // Email watcher toggle
  toggleEmailWatcher,
];

/**
 * Tool definitions for the Anthropic API.
 */
export const TOOLS: Tool[] = allTools.map(t => t.tool);

/**
 * Map of tool handlers by name.
 */
export const toolHandlers = new Map<string, ToolHandler>(
  allTools.map(t => [t.tool.name, t.handler])
);

/**
 * Read-only tools safe for scheduled job execution.
 * These tools can gather information but not modify user data.
 */
export const READ_ONLY_TOOLS: Tool[] = [
  getCalendarEvents.tool,
  resolveDateTool.tool,
  getEmails.tool,
  readEmail.tool,
  getEmailThread.tool,
  formatMapsLink.tool,
];

/**
 * Execute a tool by name.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const handler = toolHandlers.get(name);

  if (!handler) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'Tool call received',
    toolName: name,
    inputKeys: Object.keys(input),
    timestamp: new Date().toISOString(),
  }));

  try {
    const result = await handler(input, context);
    return JSON.stringify(result);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Tool execution failed',
      toolName: name,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type { ToolDefinition, ToolHandler, ToolContext } from './types.js';

// Re-export maps tool for direct use by response composer
export { formatMapsLink } from './maps.js';
