import { describe, expect, test } from "bun:test";
import { decryptToken, encryptToken } from "../convex/tokenCrypto";

const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 9).toString("base64");

describe("token encryption", () => {
  test("round-trips and never stores the plain token", async () => {
    const sealed = await encryptToken("music-user-token-abc", key);
    expect(sealed).not.toContain("music-user-token-abc");
    expect(await decryptToken(sealed, key)).toBe("music-user-token-abc");
  });
  test("two encryptions of the same token differ (fresh IV)", async () => {
    expect(await encryptToken("t", key)).not.toBe(await encryptToken("t", key));
  });
  test("tampered ciphertext, truncation, or a different key throws", async () => {
    const sealed = await encryptToken("music-user-token-abc", key);
    const bytes = Buffer.from(sealed, "base64");
    bytes[bytes.length - 1] ^= 1;
    await expect(decryptToken(bytes.toString("base64"), key)).rejects.toThrow();
    await expect(decryptToken(sealed.slice(0, 10), key)).rejects.toThrow();
    await expect(decryptToken(sealed, otherKey)).rejects.toThrow();
  });
  test("rejects a key that isn't 32 bytes", async () => {
    await expect(encryptToken("t", Buffer.alloc(16).toString("base64"))).rejects.toThrow(
      "FINDS_ENCRYPTION_KEY",
    );
  });
});
