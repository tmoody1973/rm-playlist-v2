import { createPrivateKey, createSign } from "node:crypto";

/**
 * Apple Music developer token signing (ES256, P1363 raw R||S format).
 *
 * Apple expects a 64-byte concatenated R||S signature, NOT the ASN.1 DER
 * wrapping Node's default `sign()` emits. The `dsaEncoding: "ieee-p1363"`
 * option produces the raw form.
 *
 * Ported from `scripts/verify-apple-music.ts` which smoke-tested the
 * end-to-end flow against Apple's catalog API.
 */

export interface SignDeveloperTokenInput {
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  /** Token lifetime in seconds. Defaults to 30 days; Apple's max is 6 months. */
  readonly ttlSeconds?: number;
  /** Test seam for deterministic `iat` / `exp`. */
  readonly now?: () => number;
}

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

export function signDeveloperToken(input: SignDeveloperTokenInput): string {
  assertEs256Key(input.privateKeyPem);

  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const nowFn = input.now ?? (() => Math.floor(Date.now() / 1000));
  const iat = nowFn();
  const exp = iat + ttl;

  const header = { alg: "ES256", kid: input.keyId, typ: "JWT" };
  const payload = { iss: input.teamId, iat, exp };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({ key: input.privateKeyPem, dsaEncoding: "ieee-p1363" });
  const signatureB64 = base64UrlEncode(signature);

  return `${signingInput}.${signatureB64}`;
}

export function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function assertEs256Key(privateKeyPem: string): void {
  // Apple rejects JWTs signed with the wrong curve. If a caller passes an
  // RSA key by mistake, Node will happily sign with a DIFFERENT algorithm
  // while our header still claims ES256 — catch the misconfig upfront.
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ec") {
    throw new Error(`Expected EC private key, got ${key.asymmetricKeyType ?? "unknown"}`);
  }
  const curve = key.asymmetricKeyDetails?.namedCurve;
  if (curve !== "prime256v1") {
    throw new Error(`Expected P-256 (prime256v1) curve, got ${curve ?? "unknown"}`);
  }
}
