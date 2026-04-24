import { describe, expect, test } from "bun:test";
import { createPrivateKey, createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { base64UrlDecode, signDeveloperToken } from "../../src/apple-music/jwt";

function generateEs256KeyPair(): { privateKeyPem: string; publicKey: ReturnType<typeof createPublicKey> } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKey = createPublicKey(createPrivateKey(privateKeyPem));
  return { privateKeyPem, publicKey };
}

describe("signDeveloperToken", () => {
  test("produces a 3-segment JWT", () => {
    const { privateKeyPem } = generateEs256KeyPair();
    const jwt = signDeveloperToken({
      teamId: "TEAMID1234",
      keyId: "KEYID56789",
      privateKeyPem,
      ttlSeconds: 60,
    });
    expect(jwt.split(".").length).toBe(3);
  });

  test("header has ES256 alg + kid + JWT typ", () => {
    const { privateKeyPem } = generateEs256KeyPair();
    const jwt = signDeveloperToken({
      teamId: "TEAMID1234",
      keyId: "KEYID56789",
      privateKeyPem,
      ttlSeconds: 60,
    });
    const headerPart = jwt.split(".")[0];
    expect(headerPart).toBeTruthy();
    const header = JSON.parse(base64UrlDecode(headerPart ?? "").toString("utf8"));
    expect(header).toEqual({ alg: "ES256", kid: "KEYID56789", typ: "JWT" });
  });

  test("payload has iss, iat, exp with exp - iat === ttlSeconds", () => {
    const { privateKeyPem } = generateEs256KeyPair();
    const fixedNow = 1_700_000_000;
    const jwt = signDeveloperToken({
      teamId: "MYTEAMID00",
      keyId: "MYKEYID000",
      privateKeyPem,
      ttlSeconds: 300,
      now: () => fixedNow,
    });
    const payloadPart = jwt.split(".")[1];
    expect(payloadPart).toBeTruthy();
    const payload = JSON.parse(base64UrlDecode(payloadPart ?? "").toString("utf8"));
    expect(payload.iss).toBe("MYTEAMID00");
    expect(payload.iat).toBe(fixedNow);
    expect(payload.exp).toBe(fixedNow + 300);
    expect(payload.exp - payload.iat).toBe(300);
  });

  test("signature is 64 bytes (raw R||S P1363), not ASN.1 DER", () => {
    const { privateKeyPem } = generateEs256KeyPair();
    const jwt = signDeveloperToken({
      teamId: "TEAMID1234",
      keyId: "KEYID56789",
      privateKeyPem,
      ttlSeconds: 60,
    });
    const sigPart = jwt.split(".")[2];
    expect(sigPart).toBeTruthy();
    const signature = base64UrlDecode(sigPart ?? "");
    expect(signature.length).toBe(64);
  });

  test("JWT round-trips: verify against the public key", () => {
    const { privateKeyPem, publicKey } = generateEs256KeyPair();
    const jwt = signDeveloperToken({
      teamId: "TEAMID1234",
      keyId: "KEYID56789",
      privateKeyPem,
      ttlSeconds: 60,
    });
    const [header, payload, signatureB64] = jwt.split(".") as [string, string, string];
    const signingInput = `${header}.${payload}`;

    const verifier = createVerify("SHA256");
    verifier.update(signingInput);
    verifier.end();
    const sig = base64UrlDecode(signatureB64);
    const valid = verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, sig);
    expect(valid).toBe(true);
  });

  test("defaults to 30-day TTL when ttlSeconds omitted", () => {
    const { privateKeyPem } = generateEs256KeyPair();
    const fixedNow = 1_700_000_000;
    const jwt = signDeveloperToken({
      teamId: "TEAMID1234",
      keyId: "KEYID56789",
      privateKeyPem,
      now: () => fixedNow,
    });
    const payloadPart = jwt.split(".")[1];
    expect(payloadPart).toBeTruthy();
    const payload = JSON.parse(base64UrlDecode(payloadPart ?? "").toString("utf8"));
    expect(payload.exp - payload.iat).toBe(30 * 24 * 60 * 60);
  });
});
