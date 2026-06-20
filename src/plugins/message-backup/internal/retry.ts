/**
 * Retry primitives kept separate from the main plugin so the retry
 * policy and the backup orchestration live in distinct modules.
 *
 * `isRetryableError` is intentionally generous on the network-failure
 * side: a single Discord fetch can fail with `DiscordAPIError`,
 * undici `UND_ERR_*`, or a bare `Error` from the ws layer. Anything
 * that looks like a transient 5xx, 429, or socket error retries;
 * 4xx / Unknown Channel / validation errors propagate immediately.
 */
const isRetryableError = (err: unknown): boolean => {
  if (err === null || err === undefined) return false;
  const anyErr = err as { status?: number; httpStatus?: number; name?: string; code?: string };
  const status = anyErr.status ?? anyErr.httpStatus;
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true;
  if (
    anyErr.name === 'ConnectTimeoutError' ||
    anyErr.name === 'AbortError' ||
    anyErr.name === 'FetchError'
  ) {
    return true;
  }
  const code = anyErr.code;
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return true;
  }
  const msg = String(err);
  return msg.includes('ConnectTimeoutError') || msg.includes('Service Unavailable');
};

/**
 * Exponential-backoff retry with jitter. Default ceiling is 5 attempts
 * starting at 2000ms; the jitter coefficient `(0.5 + random)` keeps a
 * fan-out of concurrent channel backups from synchronising their retry
 * waves.
 */
export const retryFetch = async <T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> => {
  let delay = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt === maxAttempts) throw err;
      const jittered = delay * (0.5 + Math.random());
      await new Promise<void>((resolve) => setTimeout(resolve, jittered));
      delay *= 2;
    }
  }
  throw new Error('unreachable');
};
