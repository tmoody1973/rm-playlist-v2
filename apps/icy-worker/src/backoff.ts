/**
 * Exponential backoff with full jitter.
 *
 * Used by the worker reconnect loop when the upstream ICY stream drops.
 * Unlimited retries on network/5xx (streams die constantly — that's normal).
 * Capped retries on 4xx (permanent config error; don't hammer).
 */

export interface BackoffConfig {
  /** Initial delay in ms before first retry. */
  readonly baseMs: number;
  /** Ceiling delay in ms. */
  readonly maxMs: number;
  /** Random source. Defaults to Math.random. Overridable for deterministic tests. */
  readonly random?: () => number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs: 1_000,
  maxMs: 60_000,
};

export function nextDelayMs(attempt: number, config: BackoffConfig = DEFAULT_BACKOFF): number {
  const rand = config.random ?? Math.random;
  const uncapped = config.baseMs * 2 ** Math.max(0, attempt);
  const capped = Math.min(uncapped, config.maxMs);
  return Math.floor(capped * rand());
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
