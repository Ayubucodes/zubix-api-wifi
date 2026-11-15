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
  it("starts now when the customer has no active time", () => {
    const window = computeSubscriptionWindow({ now: NOW, currentExpiresAt: null, durationMs: 3_600_000 });
    expect(window.stacked).toBe(false);
    expect(window.startsAt.toISOString()).toBe(NOW.toISOString());
    expect(window.expiresAt.toISOString()).toBe("2026-11-14T09:00:00.000Z");
  });

  it("starts now when the previous subscription already expired", () => {
    const window = computeSubscriptionWindow({
      now: NOW,
      currentExpiresAt: new Date("2026-11-14T07:00:00.000Z"),
      durationMs: 3_600_000,
    });
    expect(window.stacked).toBe(false);
    expect(window.startsAt.toISOString()).toBe(NOW.toISOString());
  });

  it("appends to remaining time so a purchase before expiry loses nothing", () => {
    const window = computeSubscriptionWindow({
      now: NOW,
      currentExpiresAt: new Date("2026-11-14T10:00:00.000Z"),
      durationMs: 86_400_000,
    });
    expect(window.stacked).toBe(true);
    expect(window.startsAt.toISOString()).toBe("2026-11-14T10:00:00.000Z");
    expect(window.expiresAt.toISOString()).toBe("2026-11-15T10:00:00.000Z");
  });
});
