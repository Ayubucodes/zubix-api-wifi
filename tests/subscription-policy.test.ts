import { describe, expect, it } from "vitest";
import { computeSubscriptionWindow, durationToMs } from "../src/modules/subscriptions/subscription-policy.js";

const NOW = new Date("2026-11-14T08:00:00.000Z");

describe("durationToMs", () => {
  it("converts units", () => {
    expect(durationToMs(1, "HOUR")).toBe(3_600_000);
    expect(durationToMs(3, "DAY")).toBe(3 * 86_400_000);
    expect(durationToMs(1, "MONTH")).toBe(30 * 86_400_000);
  });

  it("rejects zero, negative and fractional durations", () => {
    expect(() => durationToMs(0, "HOUR")).toThrow(RangeError);
    expect(() => durationToMs(-1, "DAY")).toThrow(RangeError);
    expect(() => durationToMs(1.5, "HOUR")).toThrow(RangeError);
  });
});

describe("computeSubscriptionWindow", () => {
  it("expires after the configured package duration, regardless of any previous pass", () => {
    const window = computeSubscriptionWindow({ now: NOW, durationMs: durationToMs(5, "MINUTE") });
    expect(window.startsAt.toISOString()).toBe(NOW.toISOString());
    expect(window.expiresAt.toISOString()).toBe("2026-11-14T08:05:00.000Z");
  });
});
