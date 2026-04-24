/**
 * Minimal fetch mock for adapter tests.
 * Scripts a sequence of responses, asserts each request, and tracks history.
 */

export interface MockResponseInit {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface MockFetchCall {
  readonly url: string;
  readonly headers: Record<string, string>;
}

export type MockFetchFn = (input: URL | string | Request, init?: RequestInit) => Promise<Response>;

export interface MockFetch {
  fetch: MockFetchFn;
  readonly calls: MockFetchCall[];
  enqueue(init: MockResponseInit): void;
}

export function createMockFetch(): MockFetch {
  const queue: MockResponseInit[] = [];
  const calls: MockFetchCall[] = [];

  const fetchImpl: MockFetchFn = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders) {
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
      } else if (Array.isArray(rawHeaders)) {
        for (const [k, v] of rawHeaders) if (k && v) headers[k.toLowerCase()] = v;
      } else {
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (typeof v === "string") headers[k.toLowerCase()] = v;
        }
      }
    }
    calls.push({ url, headers });

    const next = queue.shift();
    if (!next) {
      return new Response("mock exhausted", { status: 500 });
    }
    const bodyText =
      next.body === undefined ? "" : typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(bodyText, {
      status: next.status ?? 200,
      headers: next.headers,
    });
  };

  return {
    fetch: fetchImpl,
    calls,
    enqueue(init) {
      queue.push(init);
    },
  };
}
