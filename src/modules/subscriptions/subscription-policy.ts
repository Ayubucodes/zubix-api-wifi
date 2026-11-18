/**
 * Pure time rules for subscriptions. No database or network access, so they are unit-tested.
 *
 * MONTH is 30 days. Calendar months would make a "1 month" package length depend on the date,
 * which is hard for customers to predict. Change this only as a deliberate product decision.
 */

export type DurationUnit = "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH";

const UNIT_MS: Record<DurationUnit, number> = {
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 7 * 86_400_000,
  MONTH: 30 * 86_400_000,
};

export function durationToMs(value: number, unit: DurationUnit): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError("Duration must be a positive whole number");
  }
  return value * UNIT_MS[unit];
}

export interface ExpiryInput {
  now: Date;
  durationMs: number;
}

export interface ExpiryResult {
  startsAt: Date;
  expiresAt: Date;
}

export function computeSubscriptionWindow({ now, durationMs }: ExpiryInput): ExpiryResult {
  return {
    startsAt: now,
    expiresAt: new Date(now.getTime() + durationMs),
  };
}
