/**
 * FIFO token bucket with AbortSignal-aware waiters.
 *
 * MusicBrainz enforces 1 request per second per IP. This throttle sits
 * in front of every MB call so concurrent enrichment over a backlog of
 * pending plays doesn't get the worker banned.
 */

export interface ThrottleConfig {
  /** Tokens per second. MusicBrainz = 1. */
  readonly ratePerSec: number;
  /** Test seam for deterministic timing. */
  readonly now?: () => number;
}

export interface Throttle {
  acquire(signal?: AbortSignal): Promise<void>;
}

interface Waiter {
  resolve(): void;
  reject(err: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export function createThrottle(config: ThrottleConfig): Throttle {
  const intervalMs = 1000 / config.ratePerSec;
  const now = config.now ?? Date.now;
  let nextAvailableAt = 0;
  const queue: Waiter[] = [];
  let drainScheduled = false;

  function scheduleDrain(): void {
    if (drainScheduled) return;
    drainScheduled = true;
    const delay = Math.max(0, nextAvailableAt - now());
    setTimeout(drain, delay);
  }

  function drain(): void {
    drainScheduled = false;
    while (queue.length > 0 && now() >= nextAvailableAt) {
      const next = queue.shift();
      if (!next) break;
      if (next.signal?.aborted) continue;
      if (next.onAbort && next.signal) {
        next.signal.removeEventListener("abort", next.onAbort);
      }
      nextAvailableAt = now() + intervalMs;
      next.resolve();
    }
    if (queue.length > 0) scheduleDrain();
  }

  return {
    acquire(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }
      return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject, signal };
        if (signal) {
          waiter.onAbort = () => {
            const idx = queue.indexOf(waiter);
            if (idx >= 0) queue.splice(idx, 1);
            reject(new DOMException("aborted", "AbortError"));
          };
          signal.addEventListener("abort", waiter.onAbort, { once: true });
        }
        queue.push(waiter);
        scheduleDrain();
      });
    },
  };
}
