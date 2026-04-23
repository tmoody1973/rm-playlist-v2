import { describe, expect, test } from "bun:test";
import { isAllowedIcyUrl } from "../src/ssrf";

describe("isAllowedIcyUrl — protocol", () => {
  test("rejects ftp scheme", () => {
    const r = isAllowedIcyUrl("ftp://stream.example.com/live");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("disallowed_protocol");
  });

  test("rejects file scheme", () => {
    const r = isAllowedIcyUrl("file:///etc/passwd");
    expect(r.allowed).toBe(false);
  });

  test("rejects javascript scheme", () => {
    const r = isAllowedIcyUrl("javascript:alert(1)");
    expect(r.allowed).toBe(false);
  });

  test("accepts http", () => {
    expect(isAllowedIcyUrl("http://stream.example.com/live").allowed).toBe(true);
  });

  test("accepts https", () => {
    expect(isAllowedIcyUrl("https://stream.example.com/live").allowed).toBe(true);
  });
});

describe("isAllowedIcyUrl — IPv4 private ranges", () => {
  test.each([
    ["10.0.0.1", "private_ip"],
    ["10.255.255.255", "private_ip"],
    ["172.16.0.1", "private_ip"],
    ["172.31.255.255", "private_ip"],
    ["192.168.1.1", "private_ip"],
    ["127.0.0.1", "private_ip"],
    ["127.255.255.255", "private_ip"],
    ["0.0.0.0", "private_ip"],
    ["224.0.0.1", "private_ip"],
  ])("rejects %s as %s", (ip, reason) => {
    const r = isAllowedIcyUrl(`http://${ip}/live`);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe(reason);
  });

  test("rejects link-local 169.254.0.1", () => {
    const r = isAllowedIcyUrl("http://169.254.0.1/live");
    expect(r.allowed).toBe(false);
  });

  test("rejects AWS/GCP metadata 169.254.169.254", () => {
    const r = isAllowedIcyUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.allowed).toBe(false);
  });

  test("accepts public 8.8.8.8", () => {
    expect(isAllowedIcyUrl("http://8.8.8.8/live").allowed).toBe(true);
  });

  test("172.32.0.1 is public (not in RFC1918 172.16/12)", () => {
    expect(isAllowedIcyUrl("http://172.32.0.1/live").allowed).toBe(true);
  });
});

describe("isAllowedIcyUrl — IPv6 private ranges", () => {
  test("rejects IPv6 loopback ::1", () => {
    const r = isAllowedIcyUrl("http://[::1]/live");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("private_ip");
  });

  test("rejects IPv6 unspecified ::", () => {
    const r = isAllowedIcyUrl("http://[::]/live");
    expect(r.allowed).toBe(false);
  });

  test("rejects IPv6 link-local fe80::1", () => {
    const r = isAllowedIcyUrl("http://[fe80::1]/live");
    expect(r.allowed).toBe(false);
  });

  test("rejects IPv6 unique-local fc00::1", () => {
    const r = isAllowedIcyUrl("http://[fc00::1]/live");
    expect(r.allowed).toBe(false);
  });

  test("rejects IPv4-mapped ::ffff:10.0.0.1", () => {
    const r = isAllowedIcyUrl("http://[::ffff:10.0.0.1]/live");
    expect(r.allowed).toBe(false);
  });
});

describe("isAllowedIcyUrl — hostname", () => {
  test("rejects literal localhost", () => {
    const r = isAllowedIcyUrl("http://localhost/live");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("loopback_hostname");
  });

  test("accepts public DNS hostname", () => {
    expect(isAllowedIcyUrl("https://stream.wyms.org/live").allowed).toBe(true);
  });
});

describe("isAllowedIcyUrl — ports", () => {
  test("accepts default 80/443", () => {
    expect(isAllowedIcyUrl("http://stream.example.com:80/live").allowed).toBe(true);
    expect(isAllowedIcyUrl("https://stream.example.com:443/live").allowed).toBe(true);
  });

  test("rejects non-default port without env override", () => {
    const r = isAllowedIcyUrl("http://stream.example.com:8000/live", { allowedPortsEnv: "" });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("disallowed_port");
  });

  test("accepts non-default port when allowlisted via option", () => {
    const r = isAllowedIcyUrl("http://stream.example.com:8000/live", { allowedPortsEnv: "8000,8443" });
    expect(r.allowed).toBe(true);
  });

  test("ignores garbage in allowlist env", () => {
    const r = isAllowedIcyUrl("http://stream.example.com:8000/live", {
      allowedPortsEnv: "not-a-port,8000,",
    });
    expect(r.allowed).toBe(true);
  });
});

describe("isAllowedIcyUrl — malformed input", () => {
  test("rejects garbage string", () => {
    const r = isAllowedIcyUrl("not a url");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("invalid_url");
  });

  test("rejects empty string", () => {
    expect(isAllowedIcyUrl("").allowed).toBe(false);
  });
});
