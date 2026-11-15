import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashPassword, sha256Hex, verifyPassword } from "../src/common/crypto.js";

describe("password hashing", () => {
  it("hashes with argon2id and verifies the correct password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct-horse-battery")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("verifies Argon2id hashes created by the previous implementation", async () => {
    const hash =
      "$argon2id$v=19$m=19456,t=2,p=1$ABEiM0RVZneImaq7zN3u/w$yD7Mll4qe7L6nR6MnGYQ9aEcLH1T2Ld3RM+qSeoBPxs";
    expect(await verifyPassword(hash, "legacy-compatible-password")).toBe(true);
  });

  it("returns false for a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});

describe("refresh token helpers", () => {
  it("generates unique opaque tokens", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes deterministically without exposing the input", () => {
    const token = "example-token";
    expect(sha256Hex(token)).toBe(sha256Hex(token));
    expect(sha256Hex(token)).not.toContain(token);
    expect(sha256Hex(token)).toHaveLength(64);
  });
});
