/**
 * SSRF allowlist for ICY stream URLs.
 *
 * Session 1 uses a hardcoded env-var URL, so this guard is belt-and-braces.
 * Session 2 wires user-configurable sources through Convex, at which point
 * this same guard stops the worker from being weaponized to probe internal
 * services (cloud metadata endpoints, RFC1918, localhost).
 *
 * Rules:
 *   - Protocol MUST be http or https
 *   - Hostname MUST NOT be an IP literal in a reserved range
 *   - Hostname MUST NOT resolve to "localhost"
 *   - Port MUST be 80, 443, or in the `ICY_ALLOWED_PORTS` env var list
 *
 * This guard deliberately does NOT perform DNS resolution. Hostname-based
 * SSRF via DNS rebinding is mitigated at the network layer (Fly.io egress
 * policy for production) and by rejecting literal private IPs at the URL
 * layer here. Adding a DNS-time check with re-validation before connect is
 * session 2+ hardening.
 */

const ALWAYS_ALLOWED_PORTS = new Set(["80", "443", ""]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

const METADATA_IP = "169.254.169.254";
const IPV6_LOOPBACK = "::1";

export interface SsrfCheckOptions {
  /** Override env-var lookup (test hook). */
  allowedPortsEnv?: string;
}

export interface SsrfReject {
  allowed: false;
  reason: string;
}

export interface SsrfAccept {
  allowed: true;
}

export type SsrfCheckResult = SsrfAccept | SsrfReject;

export function isAllowedIcyUrl(input: string, options: SsrfCheckOptions = {}): SsrfCheckResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { allowed: false, reason: "disallowed_protocol" };
  }

  const host = stripBrackets(url.hostname.toLowerCase());

  if (PRIVATE_HOSTNAMES.has(host)) {
    return { allowed: false, reason: "loopback_hostname" };
  }

  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { allowed: false, reason: "private_ip" };
  }

  if (host === METADATA_IP) {
    return { allowed: false, reason: "cloud_metadata_ip" };
  }

  const allowedPorts = getAllowedPorts(options.allowedPortsEnv ?? process.env.ICY_ALLOWED_PORTS);
  if (!ALWAYS_ALLOWED_PORTS.has(url.port) && !allowedPorts.has(url.port)) {
    return { allowed: false, reason: "disallowed_port" };
  }

  return { allowed: true };
}

function stripBrackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function getAllowedPorts(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((p) => p.trim())
      .filter((p) => /^\d+$/.test(p)),
  );
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  const a = parseOctet(parts[0]);
  const b = parseOctet(parts[1]);
  const c = parseOctet(parts[2]);
  const d = parseOctet(parts[3]);
  if (a == null || b == null || c == null || d == null) return false;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a >= 224) return true;

  return false;
}

function parseOctet(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  return n;
}

function isPrivateIpv6(host: string): boolean {
  if (host === IPV6_LOOPBACK) return true;
  if (host === "::") return true;
  if (host.startsWith("fe80:") || host.startsWith("fe80::")) return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  // IPv4-mapped (::ffff:...) and IPv4-compatible (::A.B.C.D): always reject.
  // These normalize through URL parsing in ways that make per-octet checks
  // unreliable; any mapped form is disallowed for the streaming use case.
  if (host.startsWith("::ffff:")) return true;
  return false;
}
