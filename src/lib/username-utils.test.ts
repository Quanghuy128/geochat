/**
 * Unit tests cho username-utils.ts
 * Runner: Vitest (cần cài: npm install -D vitest)
 * Chạy: npx vitest run src/lib/username-utils.test.ts
 */
import { describe, expect, it } from "vitest";
import { buildFakeEmail, validateUsername } from "./username-utils";

describe("validateUsername", () => {
  // Valid cases → null (no error)
  it("valid: basic alphanumeric", () => {
    expect(validateUsername("huynq12")).toBeNull();
  });

  it("valid: with underscore", () => {
    expect(validateUsername("huy_nguyen")).toBeNull();
  });

  it("valid: with hyphen", () => {
    expect(validateUsername("huy-nguyen")).toBeNull();
  });

  it("valid: exactly 3 chars", () => {
    expect(validateUsername("abc")).toBeNull();
  });

  it("valid: exactly 20 chars", () => {
    expect(validateUsername("abcdefghijklmnopqrst")).toBeNull();
  });

  // Invalid cases → error string
  it("invalid: too short (2 chars)", () => {
    expect(validateUsername("ab")).not.toBeNull();
  });

  it("invalid: too long (21 chars)", () => {
    expect(validateUsername("abcdefghijklmnopqrstu")).not.toBeNull();
  });

  it("invalid: starts with number", () => {
    expect(validateUsername("1huy")).not.toBeNull();
  });

  it("invalid: starts with underscore", () => {
    expect(validateUsername("_huy")).not.toBeNull();
  });

  it("invalid: starts with hyphen", () => {
    expect(validateUsername("-huy")).not.toBeNull();
  });

  it("invalid: contains special char @", () => {
    expect(validateUsername("huy@")).not.toBeNull();
  });

  it("invalid: contains space", () => {
    expect(validateUsername("huy nq")).not.toBeNull();
  });

  it("invalid: empty string", () => {
    expect(validateUsername("")).not.toBeNull();
  });
});

describe("buildFakeEmail", () => {
  it("lowercases mixed-case username", () => {
    expect(buildFakeEmail("HuyNQ12")).toBe("huynq12@geochat.app");
  });

  it("already lowercase stays same", () => {
    expect(buildFakeEmail("huynq12")).toBe("huynq12@geochat.app");
  });

  it("appends @geochat.app", () => {
    expect(buildFakeEmail("testuser")).toBe("testuser@geochat.app");
  });
});
