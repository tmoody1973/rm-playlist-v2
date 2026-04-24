import { describe, expect, test } from "bun:test";
import { createThrottle } from "../src/throttle";

describe("createThrottle", () => {
  test("serializes calls at ratePerSec=1 — three concurrent acquires take at least 2 seconds total", async () => {
    const throttle = createThrottle({ ratePerSec: 1 });
    const started = Date.now();
    await Promise.all([throttle.acquire(), throttle.acquire(), throttle.acquire()]);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1800);
  });

  test("first call resolves immediately", async () => {
    const throttle = createThrottle({ ratePerSec: 100 });
    const started = Date.now();
    await throttle.acquire();
    expect(Date.now() - started).toBeLessThan(50);
  });

  test("FIFO ordering", async () => {
    const throttle = createThrottle({ ratePerSec: 50 });
    const order: number[] = [];
    await Promise.all([
      throttle.acquire().then(() => order.push(1)),
      throttle.acquire().then(() => order.push(2)),
      throttle.acquire().then(() => order.push(3)),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  test("rejects with AbortError when signal already aborted", async () => {
    const throttle = createThrottle({ ratePerSec: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(throttle.acquire(controller.signal)).rejects.toThrow("aborted");
  });

  test("rejects waiting call when signal aborts mid-wait", async () => {
    const throttle = createThrottle({ ratePerSec: 1 });
    await throttle.acquire();
    const controller = new AbortController();
    const pending = throttle.acquire(controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow("aborted");
  });

  test("aborted waiter leaves queue — subsequent waiter still resolves", async () => {
    const throttle = createThrottle({ ratePerSec: 5 });
    await throttle.acquire();
    const abortedController = new AbortController();
    const aborted = throttle.acquire(abortedController.signal);
    setTimeout(() => abortedController.abort(), 10);
    await aborted.catch(() => {});
    const afterAborted = throttle.acquire();
    await expect(afterAborted).resolves.toBeUndefined();
  });
});
