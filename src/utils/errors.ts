/**
 * @fileoverview Standardized error handling utilities.
 *
 * Provides consistent error patterns across the codebase:
 * - AppError: Base class for application-specific errors
 * - withErrorContext: Wraps operations with consistent error logging
 * - safeExecute: Returns result objects instead of throwing
 */

/**
 * Base class for application-specific errors.
 * Includes error code, recoverability flag, and optional context.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Result type for operations that may fail.
 * Prefer this over try-catch when callers need to handle both cases.
 */
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Execute an async function with consistent error logging.
 * Errors are logged and re-thrown for the caller to handle.
 */
export async function withErrorContext<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: `Error in ${context}`,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    throw error;
  }
}

/**
 * Execute an async function and return a Result object.
 * Use for operations where the caller wants to handle failure without exceptions.
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context: string
): Promise<Result<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: `Error in ${context}`,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
