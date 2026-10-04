/** AES-256-GCM for listeners' Apple Music User Tokens. Sealed format: base64(iv[12] ‖ ciphertext+tag). */
const IV_BYTES = 12;
const KEY_BYTES = 32;
const INVALID_KEY_MESSAGE = "FINDS_ENCRYPTION_KEY is invalid: must be 32 bytes, base64";

/** The sealed token itself failed authentication (wrong key, tamper, truncation) — the link is unusable. */
export class TokenAuthError extends Error {}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function rawKeyBytes(keyB64: string): Uint8Array {
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(keyB64);
  } catch {
    throw new Error(INVALID_KEY_MESSAGE);
  }
  if (raw.length !== KEY_BYTES) throw new Error(INVALID_KEY_MESSAGE);
  return raw;
}

/** Throws a config error (never a TokenAuthError) when the key can't be used at all. */
export async function assertUsableKey(keyB64: string): Promise<void> {
  rawKeyBytes(keyB64);
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKeyBytes(keyB64) as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptToken(plain: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const sealed = new Uint8Array(IV_BYTES + cipher.length);
  sealed.set(iv);
  sealed.set(cipher, IV_BYTES);
  return bytesToBase64(sealed);
}

export async function decryptToken(sealed: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const bytes = base64ToBytes(sealed);
  if (bytes.length <= IV_BYTES) throw new TokenAuthError("Sealed token is too short");
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) },
      key,
      bytes.slice(IV_BYTES),
    );
  } catch {
    throw new TokenAuthError("Sealed token failed authentication");
  }
  return new TextDecoder().decode(plain);
}
