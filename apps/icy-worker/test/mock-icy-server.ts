export interface MockIcyServerOptions {
  /** Metadata blocks to cycle through, one per metaint window. */
  metadataBlocks: Array<string | null>;
  /** icy-metaint value (audio bytes between metadata blocks). */
  metaint: number;
  /** Force a non-200 response. */
  status?: number;
  /** Suppress the icy-metaint header to exercise the error path. */
  omitMetaintHeader?: boolean;
}

export interface MockIcyServerHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

/**
 * Starts a tiny HTTP server that emits a fake ICY stream.
 *
 * The response body is `metaint` bytes of ASCII "A" audio followed by a
 * metadata block (length prefix + padded bytes), repeating indefinitely
 * through the provided metadata blocks. A `null` block in the list emits
 * a zero length-byte ("metadata unchanged").
 */
export function startMockIcyServer(opts: MockIcyServerOptions): Promise<MockIcyServerHandle> {
  const { metadataBlocks, metaint, status, omitMetaintHeader } = opts;
  const filler = new Uint8Array(metaint).fill(0x41);

  return new Promise((resolve) => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        if (status && status !== 200) {
          return new Response(`status=${status}`, { status });
        }

        const headers: Record<string, string> = {
          "content-type": "audio/mpeg",
        };
        if (!omitMetaintHeader) headers["icy-metaint"] = String(metaint);

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const raw of cycle(metadataBlocks)) {
              controller.enqueue(filler);
              if (raw == null) {
                controller.enqueue(new Uint8Array([0]));
                continue;
              }
              const encoded = new TextEncoder().encode(raw);
              const length = Math.ceil(encoded.length / 16);
              const block = new Uint8Array(1 + length * 16);
              block[0] = length;
              block.set(encoded, 1);
              controller.enqueue(block);
              // tiny yield so the consumer can run
              await new Promise((r) => setTimeout(r, 0));
            }
          },
        });

        return new Response(stream, { headers });
      },
    });

    const port = server.port ?? 0;
    const url = `http://127.0.0.1:${port}/live`;
    resolve({
      url,
      port,
      async stop() {
        await server.stop(true);
      },
    });
  });
}

function* cycle<T>(items: readonly T[]): Generator<T> {
  if (items.length === 0) return;
  while (true) {
    for (const item of items) yield item;
  }
}
