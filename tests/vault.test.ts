import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateVoucherCode,
  hashVoucherCode,
  normalizeVoucherCode,
  voucherHint,
} from "../src/common/vault.js";

const KEY_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const HMAC_KEY = "x".repeat(32);

describe("voucher codes", () => {
  it("generates codes in the 4-4-4 format using only unambiguous characters", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateVoucherCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });

  it("generates distinct codes", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateVoucherCode()));
    expect(codes.size).toBe(200);
  });

  it("hashes the same code regardless of case, spaces or dashes", () => {
    expect(hashVoucherCode("k7qf-2xmp 9twa", HMAC_KEY)).toBe(hashVoucherCode("K7QF2XMP9TWA", HMAC_KEY));
    expect(normalizeVoucherCode(" k7qf-2xmp ")).toBe("K7QF2XMP");
  });

  it("produces different hashes under different keys", () => {
    expect(hashVoucherCode("K7QF-2XMP-9TWA", HMAC_KEY)).not.toBe(hashVoucherCode("K7QF-2XMP-9TWA", "y".repeat(32)));
  });

  it("returns only the last four characters as a hint", () => {
    expect(voucherHint("K7QF-2XMP-9TWA")).toBe("9TWA");
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips the plaintext", () => {
    const cipher = encryptSecret("K7QF-2XMP-9TWA", KEY_HEX);
    expect(cipher).not.toContain("K7QF");
    expect(decryptSecret(cipher, KEY_HEX)).toBe("K7QF-2XMP-9TWA");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", KEY_HEX)).not.toBe(encryptSecret("same", KEY_HEX));
  });

  it("rejects tampered ciphertext", () => {
    const [iv, tag, data] = encryptSecret("secret", KEY_HEX).split(".") as [string, string, string];
    const tampered = [iv, tag, data.slice(0, -2) + (data.endsWith("AA") ? "BB" : "AA")].join(".");
    expect(() => decryptSecret(tampered, KEY_HEX)).toThrow();
  });
});
