import { setTimeout as delay } from 'node:timers/promises';

export type ImportAttemptFailure = {
  attempt: number;
  statusCode: number | null;
  isRetryable: boolean;
  message: string;
};

const transientNetworkErrors = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

function classify(
  error: unknown,
  attempt: number,
  signal: AbortSignal,
): ImportAttemptFailure {
  let cause = error;
  let statusCode: number | null = null;
  let networkCode: string | undefined;
  for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
    if (
      cause.name === 'AI_APICallError' &&
      'statusCode' in cause &&
      typeof cause.statusCode === 'number'
    ) {
      statusCode = cause.statusCode;
    }
    if (
      'code' in cause &&
      typeof cause.code === 'string' &&
      transientNetworkErrors.has(cause.code)
    ) {
      networkCode = cause.code;
    }
    cause = cause.cause;
  }
  const retryable =
    statusCode === null
      ? !!networkCode
      : statusCode === 429 || (statusCode >= 500 && statusCode < 600);
  const message = signal.aborted
    ? signal.reason?.name === 'TimeoutError'
      ? 'TIMEOUT'
      : 'CANCELLED'
    : statusCode !== null
      ? 'HTTP ' + statusCode
      : (networkCode ?? 'REQUEST_FAILED');
  return {
    attempt,
    statusCode,
    isRetryable: !signal.aborted && retryable,
    message,
  };
}

export async function runImportRequest<T>(
  generate: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal,
  observe: (failure: ImportAttemptFailure) => void,
): Promise<T> {
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(25_000)]);
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await generate(signal);
    } catch (error) {
      const failure = classify(error, attempt, signal);
      observe(failure);
      if (attempt === 2 || !failure.isRetryable) throw error;
      await delay(250, undefined, { signal });
    }
  }
}
