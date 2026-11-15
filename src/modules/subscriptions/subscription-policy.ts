/**
 * Pure time rules for subscriptions. No database or network access, so they are unit-tested.
 *
 * Stacking policy (documented decision):
 *  - If the customer still has time left on an active subscription for the same location,
 *    the new package is appended to the end of that time (no time is lost).
 *  - Otherwise the package starts now.
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
  /** Expiry of the customer's current active subscription at the same location, if any. */
  currentExpiresAt: Date | null;
  durationMs: number;
}

export interface ExpiryResult {
  startsAt: Date;
  expiresAt: Date;
  stacked: boolean;
}

export function computeSubscriptionWindow({ now, currentExpiresAt, durationMs }: ExpiryInput): ExpiryResult {
  const stacked = currentExpiresAt !== null && currentExpiresAt.getTime() > now.getTime();
  const startsAt = stacked && currentExpiresAt ? currentExpiresAt : now;
  return {
    startsAt,
    expiresAt: new Date(startsAt.getTime() + durationMs),
    stacked,
  };
}
