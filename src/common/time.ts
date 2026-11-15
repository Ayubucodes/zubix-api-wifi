/** Business timezone. Database timestamps are stored in UTC and converted only for display. */
export const BUSINESS_TIMEZONE = "Africa/Dar_es_Salaam";

/** Tanzania has no daylight saving time, so a fixed UTC+3 offset is exact. */
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns the UTC instant at which the business-local day containing `at` began. */
export function startOfBusinessDay(at: Date): Date {
  const shifted = new Date(at.getTime() + TZ_OFFSET_MS);
  const midnightLocalAsUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(midnightLocalAsUtc - TZ_OFFSET_MS);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Business-local calendar date (YYYY-MM-DD) for a UTC instant. */
export function businessDateKey(at: Date): string {
  return new Date(at.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Returns the UTC instant at which the business-local calendar month containing `at` began. */
export function startOfBusinessMonth(at: Date): Date {
  const shifted = new Date(at.getTime() + TZ_OFFSET_MS);
  const firstLocalAsUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1);
  return new Date(firstLocalAsUtc - TZ_OFFSET_MS);
}
