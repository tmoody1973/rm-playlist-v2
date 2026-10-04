import { describe, expect, test } from "bun:test";
import { assertUsableKey, decryptToken, encryptToken, TokenAuthError } from "../convex/tokenCrypto";

const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 9).toString("base64");
const shortKey = Buffer.alloc(16).toString("base64");

describe("token encryption", () => {
  test("round-trips and never stores the plain token", async () => {
    const sealed = await encryptToken("music-user-token-abc", key);
    expect(sealed).not.toContain("music-user-token-abc");
    expect(await decryptToken(sealed, key)).toBe("music-user-token-abc");
  });
  test("two encryptions of the same token differ (fresh IV)", async () => {
    expect(await encryptToken("t", key)).not.toBe(await encryptToken("t", key));
  });
  test("a tampered tag is a TokenAuthError", async () => {
    const bytes = Buffer.from(await encryptToken("music-user-token-abc", key), "base64");
    bytes[bytes.length - 1] ^= 1;
    await expect(decryptToken(bytes.toString("base64"), key)).rejects.toBeInstanceOf(
      TokenAuthError,
    );
  });
  test("a too-short sealed token is a TokenAuthError", async () => {
    const sealed = await encryptToken("music-user-token-abc", key);
    await expect(decryptToken(sealed.slice(0, 10), key)).rejects.toBeInstanceOf(TokenAuthError);
  });
  test("decrypting with a different valid key is a TokenAuthError", async () => {
    const sealed = await encryptToken("music-user-token-abc", key);
    await expect(decryptToken(sealed, otherKey)).rejects.toBeInstanceOf(TokenAuthError);
  });
  test("a bad key is a plain config error naming FINDS_ENCRYPTION_KEY, not a TokenAuthError", async () => {
    const sealed = await encryptToken("music-user-token-abc", key);
    for (const badKey of [shortKey, "not base64 !!"]) {
      const error = await decryptToken(sealed, badKey).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TokenAuthError);
      expect((error as Error).message).toContain("FINDS_ENCRYPTION_KEY");
    }
    await expect(encryptToken("t", shortKey)).rejects.toThrow("FINDS_ENCRYPTION_KEY");
  });
});

describe("assertUsableKey", () => {
  test("accepts a 32-byte base64 key", async () => {
    await expect(assertUsableKey(key)).resolves.toBeUndefined();
  });
  test("rejects a non-base64 key with a message naming FINDS_ENCRYPTION_KEY", async () => {
    await expect(assertUsableKey("not base64 !!")).rejects.toThrow(
      "FINDS_ENCRYPTION_KEY is invalid: must be 32 bytes, base64",
    );
  });
  test("rejects a wrong-length key with the same message", async () => {
    await expect(assertUsableKey(shortKey)).rejects.toThrow(
      "FINDS_ENCRYPTION_KEY is invalid: must be 32 bytes, base64",
    );
  });
});
