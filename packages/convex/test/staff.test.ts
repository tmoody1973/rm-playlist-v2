import { describe, expect, test } from "bun:test";
import { isStaffIdentity } from "../convex/staff";

describe("isStaffIdentity", () => {
  test("accepts a Radio Milwaukee address", () => {
    expect(isStaffIdentity({ email: "dj@radiomilwaukee.org" })).toBe(true);
  });

  test("is case-insensitive on the domain", () => {
    expect(isStaffIdentity({ email: "DJ@RadioMilwaukee.ORG" })).toBe(true);
  });

  test("rejects a signed-in outsider", () => {
    expect(isStaffIdentity({ email: "curious@gmail.com" })).toBe(false);
  });

  test("rejects look-alike domains", () => {
    expect(isStaffIdentity({ email: "x@radiomilwaukee.org.evil.com" })).toBe(false);
    expect(isStaffIdentity({ email: "x@notradiomilwaukee.org" })).toBe(false);
    expect(isStaffIdentity({ email: "x@sub.radiomilwaukee.org" })).toBe(false);
  });

  test("rejects an address the identity provider marks unverified", () => {
    expect(isStaffIdentity({ email: "dj@radiomilwaukee.org", emailVerified: false })).toBe(false);
  });

  test("rejects no identity and identities without an email", () => {
    expect(isStaffIdentity(null)).toBe(false);
    expect(isStaffIdentity({})).toBe(false);
  });
});
