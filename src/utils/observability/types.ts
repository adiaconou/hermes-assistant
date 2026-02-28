export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  requestId?: string;
  runId?: string;
  domain?: string;
  operation?: string;
  [key: string]: unknown;
};

export type LogData = Record<string, unknown>;

export type AppLogRecord = {
  timestamp: string;
  level: LogLevel;
  event: string;
} & LogContext & LogData;

export interface AppLogger {
  debug(event: string, data?: LogData): void;
  info(event: string, data?: LogData): void;
  warn(event: string, data?: LogData): void;
  error(event: string, data?: LogData): void;
  child(context: LogContext): AppLogger;
}

