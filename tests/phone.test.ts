import { describe, expect, it } from "vitest";
import { normalizeTanzanianPhone } from "../src/utils/phone.js";

describe("normalizeTanzanianPhone", () => {
  it.each([
    ["0712345678", "255712345678"],
    ["0712 345 678", "255712345678"],
    ["712345678", "255712345678"],
    ["+255712345678", "255712345678"],
    ["255 712 345 678", "255712345678"],
    ["0655123456", "255655123456"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeTanzanianPhone(input)).toBe(expected);
  });

  it.each(["12345", "0112345678", "+254712345678", "07123456789", "abc"])(
    "rejects %s",
    (input) => {
      expect(normalizeTanzanianPhone(input)).toBeNull();
    },
  );
});
