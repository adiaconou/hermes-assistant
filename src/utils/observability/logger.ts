import { WriteStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getLogContext } from './context.js';
import { redactSecrets } from './redaction.js';
import type { AppLogger, AppLogRecord, LogContext, LogData, LogLevel } from './types.js';

let consoleMirroringInstalled = false;
let sinkHooksInstalled = false;
let fileSink: { path: string; stream: WriteStream } | null = null;

const HIGH_RISK_DOMAINS = new Set(['sms-routing', 'orchestrator-handler']);
const HIGH_RISK_ALLOWED_FIELDS = new Set([
  'message',
  'channel',
  'sender',
  'phone',
  'messageSid',
  'durationMs',
  'totalDurationMs',
  'classificationDurationMs',
  'responseLength',
  'numMedia',
  'mediaTypes',
  'count',
  'fileIds',
  'userMessageId',
  'backfillCount',
  'mimeType',
  'error',
  'useOrchestrator',
  'messageLength',
  'partialResponseLength',
]);

function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

function shouldWriteFileSink(): boolean {
  if (!isDevelopment()) return false;
  return process.env.APP_LOG_FILE !== 'off';
}

function resolveLogFilePath(): string {
  if (process.env.APP_LOG_FILE) return process.env.APP_LOG_FILE;

  const baseDir = process.env.APP_LOG_DIR || process.env.TRACE_LOG_DIR || './logs';
  const dateDir = new Date().toISOString().slice(0, 10);
  return join(baseDir, dateDir, 'app.ndjson');
}

function closeFileSink(): void {
  if (!fileSink) return;
  fileSink.stream.end();
  fileSink = null;
}

function ensureFileSink(): WriteStream | null {
  if (!shouldWriteFileSink()) return null;

  const filePath = resolveLogFilePath();
  if (fileSink?.path === filePath) {
    return fileSink.stream;
  }

  closeFileSink();

  const dir = dirname(filePath);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const stream = createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' });
    stream.on('error', () => {
      // Never break app behavior due to logging issues.
    });
    fileSink = { path: filePath, stream };
    return stream;
  } catch {
    return null;
  }
}

function writeLineToFile(line: string): void {
  const sink = ensureFileSink();
  if (!sink) return;
  sink.write(`${line}\n`);
}

function writeToStd(level: LogLevel, line: string): void {
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

function toDisplayMessage(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function normalizeData(data?: LogData): LogData {
  if (!data) return {};
  return redactSecrets(data);
}

function isAllowedHighRiskField(key: string): boolean {
  if (HIGH_RISK_ALLOWED_FIELDS.has(key)) return true;
  if (/^has[A-Z]/.test(key)) return true;
  if (/^[a-zA-Z]+Id$/.test(key)) return true;
  return false;
}

function applyHighRiskFieldPolicy(context: LogContext, payload: LogData): LogData {
  const domain = typeof context.domain === 'string' ? context.domain : '';
  if (!HIGH_RISK_DOMAINS.has(domain)) {
    return payload;
  }

  const filtered: LogData = {};
  for (const [key, value] of Object.entries(payload)) {
    if (isAllowedHighRiskField(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function toRecord(
  level: LogLevel,
  event: string,
  baseContext: LogContext,
  data?: LogData,
): AppLogRecord {
  const context = getLogContext();
  const mergedContext = { ...context, ...baseContext };
  const payload = applyHighRiskFieldPolicy(mergedContext, normalizeData(data));
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...mergedContext,
    ...payload,
  };
}

function emitRecord(record: AppLogRecord): void {
  const line = JSON.stringify(record);
  writeToStd(record.level, line);
  writeLineToFile(line);
}

export function createLogger(baseContext: LogContext = {}): AppLogger {
  const log = (level: LogLevel, event: string, data?: LogData): void => {
    emitRecord(toRecord(level, event, baseContext, data));
  };

  return {
    debug: (event: string, data?: LogData) => log('debug', event, data),
    info: (event: string, data?: LogData) => log('info', event, data),
    warn: (event: string, data?: LogData) => log('warn', event, data),
    error: (event: string, data?: LogData) => log('error', event, data),
    child: (context: LogContext) => createLogger({ ...baseContext, ...context }),
  };
}

export function initObservability(): void {
  if (!sinkHooksInstalled) {
    sinkHooksInstalled = true;
    process.once('exit', closeFileSink);
    process.once('SIGINT', closeFileSink);
    process.once('SIGTERM', closeFileSink);
  }

  if (consoleMirroringInstalled) return;
  if (!isDevelopment()) return;

  const mirrorConsole = process.env.APP_MIRROR_CONSOLE !== 'false';
  if (!mirrorConsole) return;

  consoleMirroringInstalled = true;

  const install = (
    method: 'log' | 'info' | 'warn' | 'error' | 'debug',
    level: LogLevel,
  ): void => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);

      const record: AppLogRecord = {
        timestamp: new Date().toISOString(),
        level,
        event: 'legacy_console',
        source: `console.${method}`,
        message: redactSecrets(toDisplayMessage(args)),
        ...getLogContext(),
      };
      const line = JSON.stringify(record);
      writeLineToFile(line);
    };
  };

  install('log', 'info');
  install('info', 'info');
  install('warn', 'warn');
  install('error', 'error');
  install('debug', 'debug');
}
