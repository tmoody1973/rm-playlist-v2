#!/usr/bin/env bun
/**
 * Apple Music API smoke test (TODO-1 verification).
 *
 * Signs an ES256 JWT developer token using your `.p8` private key,
 * then hits the catalog endpoint for a known song to confirm the
 * API works end-to-end and a `previews[0].url` comes back.
 *
 * Run: bun scripts/verify-apple-music.ts
 *
 * Env vars expected (read from ~/.gstack/secrets/rm-playlist-v2/.env.production):
 *   APPLE_MUSIC_TEAM_ID         — 10-char Team ID from "View Membership"
 *   APPLE_MUSIC_KEY_ID          — 10-char Key ID from the Keys page
 *   APPLE_MUSIC_PRIVATE_KEY     — path to the .p8 file
 *
 * Optional:
 *   APPLE_MUSIC_TEST_SEARCH     — search term (default: "Black Pumas More Than a Love Song")
 *   APPLE_MUSIC_STOREFRONT      — defaults to "us"
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSign } from "node:crypto";

const SECRETS_DIR = join(homedir(), ".gstack/secrets/rm-playlist-v2");
const ENV_FILE = join(SECRETS_DIR, ".env.production");

function loadDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) {
    console.error(`No env file at ${path}.`);
    console.error(`Create it with:`);
    console.error(`  mkdir -p ${SECRETS_DIR}`);
    console.error(`  cat > ${ENV_FILE} <<EOF`);
    console.error(`  APPLE_MUSIC_TEAM_ID=ABCD123456`);
    console.error(`  APPLE_MUSIC_KEY_ID=XYZW987654`);
    console.error(`  APPLE_MUSIC_PRIVATE_KEY=${SECRETS_DIR}/AuthKey_XYZW987654.p8`);
    console.error(`  EOF`);
    process.exit(1);
  }
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signDeveloperToken(opts: {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  ttlSeconds?: number;
}): string {
  const ttl = opts.ttlSeconds ?? 60 * 60; // 1 hour for the smoke test
  const header = { alg: "ES256", kid: opts.keyId, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: opts.teamId, iat: now, exp: now + ttl };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();

  // Apple expects ES256 in raw R||S form, not the DER form Node returns by default.
  const derSignature = signer.sign({ key: opts.privateKeyPem, dsaEncoding: "ieee-p1363" });
  const signatureB64 = base64UrlEncode(derSignature);

  return `${signingInput}.${signatureB64}`;
}

async function main() {
  const env = loadDotEnv(ENV_FILE);
  const teamId = env.APPLE_MUSIC_TEAM_ID;
  const keyId = env.APPLE_MUSIC_KEY_ID;
  const keyPath = env.APPLE_MUSIC_PRIVATE_KEY;
  const searchTerm = env.APPLE_MUSIC_TEST_SEARCH ?? "Black Pumas More Than a Love Song";
  const storefront = env.APPLE_MUSIC_STOREFRONT ?? "us";

  if (!teamId || !keyId || !keyPath) {
    console.error("Missing one of: APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY");
    process.exit(1);
  }
  if (!existsSync(keyPath)) {
    console.error(`Private key not found at ${keyPath}`);
    process.exit(1);
  }

  console.log(`Team ID:      ${teamId}`);
  console.log(`Key ID:       ${keyId}`);
  console.log(`Private key:  ${keyPath}`);
  console.log(`Storefront:   ${storefront}`);
  console.log(`Search term:  "${searchTerm}"`);
  console.log("");

  const privateKeyPem = readFileSync(keyPath, "utf8");
  const token = signDeveloperToken({ teamId, keyId, privateKeyPem });
  const auth = { Authorization: `Bearer ${token}` };
  console.log("✓ Signed JWT developer token");
  console.log(`  (first 40 chars: ${token.slice(0, 40)}...)`);
  console.log("");

  // Step 1 — search to find a real song ID
  const searchUrl = `https://api.music.apple.com/v1/catalog/${storefront}/search?term=${encodeURIComponent(
    searchTerm,
  )}&types=songs&limit=1`;
  console.log(`GET ${searchUrl}`);
  const searchRes = await fetch(searchUrl, { headers: auth });
  console.log(`Status: ${searchRes.status} ${searchRes.statusText}`);
  if (!searchRes.ok) {
    console.error(`Search error body:\n${await searchRes.text()}`);
    process.exit(1);
  }
  const searchJson = (await searchRes.json()) as {
    results?: { songs?: { data?: Array<{ id: string; attributes: { name: string; artistName: string } }> } };
  };
  const firstSong = searchJson.results?.songs?.data?.[0];
  if (!firstSong) {
    console.error("Search returned no songs. Try a different APPLE_MUSIC_TEST_SEARCH.");
    process.exit(1);
  }
  console.log(`✓ Search found: "${firstSong.attributes.name}" by ${firstSong.attributes.artistName} (id: ${firstSong.id})`);
  console.log("");

  // Step 2 — fetch full song detail to confirm preview URL is present
  const songUrl = `https://api.music.apple.com/v1/catalog/${storefront}/songs/${firstSong.id}`;
  console.log(`GET ${songUrl}`);
  const res = await fetch(songUrl, { headers: auth });
  console.log(`Status: ${res.status} ${res.statusText}`);
  if (!res.ok) {
    console.error(`API error body:\n${await res.text()}`);
    process.exit(1);
  }

  const json = (await res.json()) as {
    data: Array<{
      id: string;
      attributes: {
        name: string;
        artistName: string;
        albumName?: string;
        previews?: Array<{ url: string }>;
      };
    }>;
  };

  const song = json.data?.[0];
  if (!song) {
    console.error("No song returned");
    process.exit(1);
  }

  console.log("");
  console.log("✓ Song detail returned");
  console.log(`  Name:      ${song.attributes.name}`);
  console.log(`  Artist:    ${song.attributes.artistName}`);
  console.log(`  Album:     ${song.attributes.albumName ?? "(none)"}`);
  console.log(`  Preview:   ${song.attributes.previews?.[0]?.url ?? "(none)"}`);

  if (!song.attributes.previews?.[0]?.url) {
    console.error("\n⚠️  No preview URL on this track — try a different APPLE_MUSIC_TEST_SEARCH.");
    process.exit(1);
  }

  console.log("\n✅ TODO-1 verified: Apple Music API works end-to-end.");
  console.log("   - JWT signing works");
  console.log("   - Search endpoint returns results");
  console.log("   - Song detail returns a preview URL");
  console.log("   Next: scaffold can begin.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
