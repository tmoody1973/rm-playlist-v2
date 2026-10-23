import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { checkIngestKey } from "../convex/ingestKey";
import { writeDeveloperToken } from "../convex/appleMusic";

const KEY = "worker-key-for-tests";
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.INGEST_SERVER_KEY;
  process.env.INGEST_SERVER_KEY = KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.INGEST_SERVER_KEY;
  else process.env.INGEST_SERVER_KEY = savedKey;
});

describe("checkIngestKey", () => {
  test("accepts the exact key", () => {
    expect(() => checkIngestKey(KEY, "plays.recordPolledPlays")).not.toThrow();
  });

  test("rejects a wrong key", () => {
    expect(() => checkIngestKey("worker-key-for-tesTs", "plays.recordPolledPlays")).toThrow(
      "Unauthorized",
    );
  });

  test("rejects any key while the deployment has none set", () => {
    delete process.env.INGEST_SERVER_KEY;
    expect(() => checkIngestKey(KEY, "plays.recordPolledPlays")).toThrow("Unauthorized");
  });

  test("allows a missing key during the rollout but logs which function was called", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect(() => checkIngestKey(undefined, "plays.recordStreamPlay")).not.toThrow();
    expect(warn).toHaveBeenCalledWith("[ingest-key] unkeyed call to plays.recordStreamPlay");
    warn.mockRestore();
  });
});

type Row = Record<string, unknown>;

function fakeTokenCtx() {
  const inserted: Row[] = [];
  const db = {
    query: () => ({ [Symbol.asyncIterator]: async function* () {} }),
    delete: async () => {},
    insert: async (_table: string, row: Row) => {
      inserted.push(row);
    },
  };
  return { ctx: { db }, inserted };
}

const writeToken = (
  writeDeveloperToken as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<void> }
)._handler;

describe("appleMusic.writeDeveloperToken", () => {
  const token = { token: "jwt", expiresAt: 2, mintedAt: 1 };

  test("stores the token without the worker key", async () => {
    const { ctx, inserted } = fakeTokenCtx();
    await writeToken(ctx, { serverKey: KEY, ...token });
    expect(inserted).toEqual([token]);
  });

  test("refuses a wrong key and writes nothing", async () => {
    const { ctx, inserted } = fakeTokenCtx();
    await expect(writeToken(ctx, { serverKey: "nope", ...token })).rejects.toThrow("Unauthorized");
    expect(inserted).toEqual([]);
  });
});
