/**
 * Trace Logger
 *
 * File-based logging for development debugging. Captures full agentic traces
 * including LLM inputs/outputs, tool executions, and orchestration decisions.
 *
 * Only active when NODE_ENV === 'development'.
 */

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import config from '../config.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

type LlmRequestParams = {
  model: string;
  maxTokens: number;
  temperature?: number;
  systemPrompt: string;
  messages: Array<{ role: string; content: string | unknown }>;
  tools?: Array<{ name: string }>;
};

type LlmResponse = {
  stopReason: string;
  content: unknown[];
  usage?: { inputTokens: number; outputTokens: number };
};

type TraceSummary = {
  durationMs: number;
  llmCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  planVersions: number;
  status: 'SUCCESS' | 'FAILED';
};

/**
 * Trace logger for development debugging.
 * Writes human-readable log files for each request.
 */
export class TraceLogger {
  private filePath: string | null = null;
  private startTime: number;
  private requestId: string;
  private phoneNumber: string;
  private enabled: boolean;

  // Stats for summary
  private llmCallCount = 0;
  private toolCallCount = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private planVersions = 1;

  constructor(requestId: string, phoneNumber: string) {
    this.requestId = requestId;
    this.phoneNumber = phoneNumber;
    this.startTime = Date.now();
    this.enabled = config.nodeEnv === 'development';

    if (this.enabled) {
      this.initFile();
    }
  }

  /**
   * Create the log file and write the header.
   */
  private initFile(): void {
    const logsDir = process.env.TRACE_LOG_DIR || './logs';
    const now = new Date();

    // Create date directory
    const dateDir = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const fullDir = join(logsDir, dateDir);

    if (!existsSync(fullDir)) {
      mkdirSync(fullDir, { recursive: true });
    }

    // Create filename: HH-mm-ss_requestId.log
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    const filename = `${timeStr}_${this.requestId}.log`;
    this.filePath = join(fullDir, filename);

    // Write header
    const header = `${'='.repeat(80)}
TRACE START | ${now.toISOString()} | ${this.phoneNumber} | ${this.requestId}
${'='.repeat(80)}

`;
    this.write(header);
  }

  /**
   * Write content to the log file.
   */
  private write(content: string): void {
    if (!this.enabled || !this.filePath) return;

    try {
      appendFileSync(this.filePath, content);
    } catch (error) {
      // Silently fail - don't break the app for logging issues
      console.error('TraceLogger write failed:', error);
    }
  }

  /**
   * Get formatted timestamp for log entries.
   */
  private timestamp(): string {
    return new Date().toTimeString().slice(0, 12); // HH:mm:ss.mmm
  }

  /**
   * Format details as indented key-value pairs.
   */
  private formatDetails(details: Record<string, unknown>): string {
    return Object.entries(details)
      .map(([key, value]) => {
        const formatted = typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
        return `  ${key}: ${formatted}`;
      })
      .join('\n');
  }

  /**
   * Log a general message with optional details.
   */
  log(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const detailsStr = details ? '\n' + this.formatDetails(details) : '';
    const entry = `[${this.timestamp()}] ${level.padEnd(5)} ${message}${detailsStr}\n\n`;
    this.write(entry);
  }

  /**
   * Log a section block (for prompts, responses, etc.).
   */
  section(title: string, content: string): void {
    if (!this.enabled) return;

    const entry = `  --- ${title} ---
${content.split('\n').map(line => '  ' + line).join('\n')}
  --- END ${title} ---

`;
    this.write(entry);
  }

  /**
   * Log an LLM request.
   */
  llmRequest(context: string, params: LlmRequestParams): void {
    if (!this.enabled) return;

    this.llmCallCount++;

    const toolsStr = params.tools
      ? params.tools.map(t => t.name).join(', ')
      : '(none)';

    let entry = `[${this.timestamp()}] DEBUG LLM REQUEST [${context}]
  Model: ${params.model}
  Max tokens: ${params.maxTokens}
${params.temperature !== undefined ? `  Temperature: ${params.temperature}\n` : ''}  Tools: ${toolsStr}

  --- SYSTEM PROMPT ---
${params.systemPrompt.split('\n').map(line => '  ' + line).join('\n')}
  --- END SYSTEM PROMPT ---

  --- MESSAGES ---
`;

    for (const msg of params.messages) {
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content, null, 2);
      entry += `  [${msg.role}]: ${content}\n`;
    }

    entry += `  --- END MESSAGES ---

`;
    this.write(entry);
  }

  /**
   * Log an LLM response.
   */
  llmResponse(context: string, response: LlmResponse, durationMs: number): void {
    if (!this.enabled) return;

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;

    let entry = `[${this.timestamp()}] DEBUG LLM RESPONSE [${context}] (${durationMs}ms)
  Stop reason: ${response.stopReason}
  Tokens: ${inputTokens} in / ${outputTokens} out

  --- RESPONSE ---
`;

    // Format response content
    for (const block of response.content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text') {
          entry += `  ${b.text}\n`;
        } else if (b.type === 'tool_use') {
          entry += `\n  [TOOL CALL] ${b.name}\n`;
          entry += `  ${JSON.stringify(b.input, null, 2).split('\n').map(l => '  ' + l).join('\n')}\n`;
        }
      }
    }

    entry += `  --- END RESPONSE ---

`;
    this.write(entry);
  }

  /**
   * Log a tool execution start.
   */
  toolExecution(name: string, input: unknown): void {
    if (!this.enabled) return;

    this.toolCallCount++;

    const inputStr = typeof input === 'object'
      ? JSON.stringify(input)
      : String(input);

    const entry = `[${this.timestamp()}] DEBUG TOOL EXECUTION: ${name}
  Input: ${inputStr}

`;
    this.write(entry);
  }

  /**
   * Log a tool result.
   */
  toolResult(name: string, result: unknown, durationMs: number, success: boolean): void {
    if (!this.enabled) return;

    const level = success ? 'DEBUG' : 'ERROR';
    const status = success ? 'TOOL RESULT' : 'TOOL FAILED';

    const shouldTruncate = name !== 'analyze_image';
    let resultStr: string;
    if (typeof result === 'string') {
      resultStr = shouldTruncate && result.length > 1000
        ? result.substring(0, 1000) + '...(truncated)'
        : result;
    } else {
      const json = JSON.stringify(result, null, 2);
      resultStr = shouldTruncate && json.length > 1000
        ? json.substring(0, 1000) + '...(truncated)'
        : json;
    }

    const entry = `[${this.timestamp()}] ${level} ${status}: ${name} (${durationMs}ms)
  Success: ${success}
  Output:
${resultStr.split('\n').map(line => '  ' + line).join('\n')}

`;
    this.write(entry);
  }

  /**
   * Log a tool error with stack trace.
   */
  toolError(name: string, error: Error, durationMs: number): void {
    if (!this.enabled) return;

    const entry = `[${this.timestamp()}] ERROR TOOL FAILED: ${name} (${durationMs}ms)
  Error: ${error.message}

  --- STACK TRACE ---
${error.stack?.split('\n').map(line => '  ' + line).join('\n') || '  (no stack trace)'}
  --- END STACK TRACE ---

`;
    this.write(entry);
  }

  /**
   * Log a step event.
   */
  stepEvent(
    event: 'start' | 'complete' | 'failed' | 'retry',
    stepId: string,
    agent: string,
    details?: Record<string, unknown>
  ): void {
    if (!this.enabled) return;

    const levelMap = {
      start: 'INFO',
      complete: 'INFO',
      failed: 'ERROR',
      retry: 'WARN',
    };
    const level = levelMap[event] as LogLevel;

    const messageMap = {
      start: `Executing step ${stepId}`,
      complete: `Step ${stepId} complete`,
      failed: `Step ${stepId} failed`,
      retry: `Step ${stepId} retrying`,
    };
    const message = messageMap[event];

    const baseDetails: Record<string, unknown> = { Agent: agent };
    if (details) {
      Object.assign(baseDetails, details);
    }

    this.log(level, message, baseDetails);
  }

  /**
   * Log a plan event.
   */
  planEvent(
    event: 'created' | 'replanning' | 'replanned' | 'completed' | 'failed' | 'timeout',
    details?: Record<string, unknown>
  ): void {
    if (!this.enabled) return;

    if (event === 'replanned') {
      this.planVersions++;
    }

    const levelMap = {
      created: 'INFO',
      replanning: 'INFO',
      replanned: 'INFO',
      completed: 'INFO',
      failed: 'ERROR',
      timeout: 'ERROR',
    };
    const level = levelMap[event] as LogLevel;

    const messageMap = {
      created: 'Plan created',
      replanning: 'Triggering replan',
      replanned: 'Replan complete',
      completed: 'Plan execution completed',
      failed: 'Plan execution failed',
      timeout: 'Plan execution timeout',
    };
    const message = messageMap[event];

    this.log(level, message, details);
  }

  /**
   * Close the log file and write the footer.
   */
  close(status: 'SUCCESS' | 'FAILED'): void {
    if (!this.enabled || !this.filePath) return;

    const durationMs = Date.now() - this.startTime;

    const footer = `${'='.repeat(80)}
TRACE END | ${new Date().toISOString()} | ${this.requestId}
Duration: ${durationMs}ms | LLM calls: ${this.llmCallCount} | Tool calls: ${this.toolCallCount} | Tokens: ${this.totalInputTokens} in / ${this.totalOutputTokens} out
Plan versions: ${this.planVersions} | Status: ${status}
${'='.repeat(80)}
`;
    this.write(footer);
  }

  /**
   * Get summary stats for external use.
   */
  getSummary(): TraceSummary {
    return {
      durationMs: Date.now() - this.startTime,
      llmCalls: this.llmCallCount,
      toolCalls: this.toolCallCount,
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      planVersions: this.planVersions,
      status: 'SUCCESS', // Will be set on close
    };
  }
}

/**
 * Create a trace logger for a request.
 * Returns a functioning logger in development, or a no-op logger in production.
 */
export function createTraceLogger(phoneNumber: string): TraceLogger {
  const requestId = Math.random().toString(36).slice(2, 10);
  return new TraceLogger(requestId, phoneNumber);
}

/**
 * Write debug log to a file, overwriting any existing content.
 * Used for single-file debug logs like memory processor output.
 *
 * Only writes in development mode.
 */
export function writeDebugLog(filename: string, content: string): void {
  if (config.nodeEnv !== 'development') return;

  const logDir = process.env.TRACE_LOG_DIR || './logs';

  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const filePath = join(logDir, filename);
    writeFileSync(filePath, content, 'utf-8');
  } catch (error) {
    // Silently fail - don't break the app for logging issues
    console.error('writeDebugLog failed:', error);
  }
}

/**
 * No-op logger for when tracing is disabled.
 * Has the same interface but does nothing.
 */
export const noopLogger: TraceLogger = {
  log: () => {},
  section: () => {},
  llmRequest: () => {},
  llmResponse: () => {},
  toolExecution: () => {},
  toolResult: () => {},
  toolError: () => {},
  stepEvent: () => {},
  planEvent: () => {},
  close: () => {},
  getSummary: () => ({
    durationMs: 0,
    llmCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    planVersions: 0,
    status: 'SUCCESS' as const,
  }),
} as unknown as TraceLogger;
