/**
 * ICY (Shoutcast / Icecast) streaming metadata reader.
 *
 * Protocol recap:
 *   1. Client sends `Icy-MetaData: 1` header on GET.
 *   2. Server responds with `icy-metaint: N` header.
 *   3. The response body is audio bytes, punctuated every N bytes by a
 *      metadata block:  <length-byte><length*16 bytes of metadata><padding>.
 *   4. A zero-length byte means "metadata unchanged since last block" — skip.
 *   5. Non-empty metadata looks like:
 *      `StreamTitle='Artist - Title';StreamUrl='...';`
 *
 * This module does NOT parse the metadata itself — that's `icyAdapter.parse()`
 * in `@rm/ingestion`. This module just extracts the raw metadata strings and
 * hands them to the caller via `onMetadata`.
 */

const ICY_METAINT_HEADER = "icy-metaint";
const METADATA_LENGTH_MULTIPLIER = 16;
const MAX_METADATA_BYTES = 255 * METADATA_LENGTH_MULTIPLIER;

export type IcyErrorCode = "http_4xx" | "http_5xx" | "no_metaint" | "invalid_metaint" | "no_body";

export class IcyProtocolError extends Error {
  public readonly code: IcyErrorCode;
  constructor(code: IcyErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "IcyProtocolError";
  }
}

export interface ReadIcyStreamOptions {
  url: string;
  onMetadata: (metadata: string) => void;
  signal?: AbortSignal;
  /** Override for tests — inject a custom fetch. */
  fetch?: typeof globalThis.fetch;
}

export async function readIcyStream(options: ReadIcyStreamOptions): Promise<void> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(options.url, {
    method: "GET",
    headers: { "Icy-MetaData": "1" },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new IcyProtocolError(
      response.status >= 500 ? "http_5xx" : "http_4xx",
      `upstream responded ${response.status} ${response.statusText}`,
    );
  }

  const metaintRaw = response.headers.get(ICY_METAINT_HEADER);
  if (metaintRaw == null) {
    throw new IcyProtocolError("no_metaint", `upstream missing ${ICY_METAINT_HEADER} header`);
  }

  const metaint = Number.parseInt(metaintRaw, 10);
  if (!Number.isInteger(metaint) || metaint <= 0) {
    throw new IcyProtocolError("invalid_metaint", `upstream sent non-positive ${ICY_METAINT_HEADER}`);
  }

  if (response.body == null) {
    throw new IcyProtocolError("no_body", "upstream returned empty body");
  }

  await consumeIcyBody({
    body: response.body,
    metaint,
    onMetadata: options.onMetadata,
    signal: options.signal,
  });
}

interface ConsumeArgs {
  body: ReadableStream<Uint8Array>;
  metaint: number;
  onMetadata: (metadata: string) => void;
  signal?: AbortSignal;
}

/**
 * State machine:
 *   - "audio": discarding audio bytes; countdown = metaint bytes until next metadata
 *   - "length": next byte is the metadata length prefix
 *   - "metadata": collecting the metadata block; countdown = length * 16 bytes left
 */
type State = "audio" | "length" | "metadata";

async function consumeIcyBody({ body, metaint, onMetadata, signal }: ConsumeArgs): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });

  // Hoisted scratch buffer — metadata blocks are at most 255*16 bytes. Reused
  // across every block to keep the per-byte hot path allocation-free.
  const scratch = new Uint8Array(MAX_METADATA_BYTES);

  let state: State = "audio";
  let audioRemaining = metaint;
  let metadataLength = 0;
  let metadataRemaining = 0;

  const onAbort = () => {
    reader.cancel().catch(() => {
      /* swallow — cancellation by design */
    });
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) return;
      if (value == null || value.length === 0) continue;

      let cursor = 0;
      while (cursor < value.length) {
        if (state === "audio") {
          const take = Math.min(audioRemaining, value.length - cursor);
          cursor += take;
          audioRemaining -= take;
          if (audioRemaining === 0) state = "length";
          continue;
        }

        if (state === "length") {
          const lengthByte = value[cursor] ?? 0;
          cursor += 1;
          if (lengthByte === 0) {
            state = "audio";
            audioRemaining = metaint;
          } else {
            metadataLength = lengthByte * METADATA_LENGTH_MULTIPLIER;
            metadataRemaining = metadataLength;
            state = "metadata";
          }
          continue;
        }

        // state === "metadata"
        const writeOffset = metadataLength - metadataRemaining;
        const take = Math.min(metadataRemaining, value.length - cursor);
        scratch.set(value.subarray(cursor, cursor + take), writeOffset);
        cursor += take;
        metadataRemaining -= take;

        if (metadataRemaining === 0) {
          const raw = decoder.decode(scratch.subarray(0, metadataLength));
          const trimmed = raw.replace(/\0+$/, "");
          if (trimmed.length > 0) {
            try {
              onMetadata(trimmed);
            } catch {
              // Callback errors must not kill the reader loop.
            }
          }
          state = "audio";
          audioRemaining = metaint;
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
