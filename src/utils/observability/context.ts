import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import type { LogContext } from './types.js';

const logContextStorage = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(context: LogContext, fn: () => T): T {
  const parent = logContextStorage.getStore() ?? {};
  const merged = { ...parent, ...context };
  return logContextStorage.run(merged, fn);
}

export function getLogContext(): LogContext {
  return logContextStorage.getStore() ?? {};
}

export function createRequestId(prefix = 'req'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function createRunId(prefix = 'run'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

