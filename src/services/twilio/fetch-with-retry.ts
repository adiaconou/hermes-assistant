/**
 * @fileoverview Retry wrapper for network fetch calls to Twilio media URLs.
 *
 * Handles transient network failures and retryable HTTP statuses.
 */

/** Retryable network error codes commonly surfaced by undici/fetch. */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Retryable HTTP statuses for transient upstream issues. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Extract network error code from a fetch error's cause when available.
 */
function getErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const withCause = error as Error & { cause?: unknown };
  const cause = withCause.cause;
  if (!cause || typeof cause !== 'object') {
    return undefined;
  }

  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Detect transient fetch errors that are worth retrying.
 */
function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false;
  }

  const code = getErrorCode(error);
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes('fetch failed') || message.includes('network');
}

function delayMs(attempt: number, retryDelaysMs: number[]): number {
  return retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with retries for transient failures.
 *
 * @param url Request URL
 * @param init Request init
 * @param operation Human-readable operation label for logs
 * @param retryDelaysMs Delays between retries in milliseconds (attempts = delays + 1)
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  operation: string,
  retryDelaysMs: number[] = [250, 750]
): Promise<Response> {
  const totalAttempts = retryDelaysMs.length + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return response;
      }

      const canRetry = attempt < totalAttempts && isRetryableStatus(response.status);
      if (!canRetry) {
        return response;
      }

      const waitMs = delayMs(attempt, retryDelaysMs);
      console.warn(JSON.stringify({
        level: 'warn',
        message: `${operation} failed with retryable HTTP status; retrying`,
        status: response.status,
        attempt,
        totalAttempts,
        retryInMs: waitMs,
        timestamp: new Date().toISOString(),
      }));
      await sleep(waitMs);
    } catch (error) {
      const canRetry = attempt < totalAttempts && isRetryableFetchError(error);
      if (!canRetry) {
        throw error;
      }

      const waitMs = delayMs(attempt, retryDelaysMs);
      console.warn(JSON.stringify({
        level: 'warn',
        message: `${operation} failed with transient network error; retrying`,
        error: error instanceof Error ? error.message : String(error),
        errorCode: getErrorCode(error),
        attempt,
        totalAttempts,
        retryInMs: waitMs,
        timestamp: new Date().toISOString(),
      }));
      await sleep(waitMs);
    }
  }

  throw new Error(`${operation} failed after retries`);
}
