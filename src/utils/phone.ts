/**
 * Normalizes Tanzanian mobile numbers to the international digits-only form
 * used throughout the database, e.g. "0712 345 678" -> "255712345678".
 *
 * Accepted inputs: 07XXXXXXXX, 7XXXXXXXX, 2557XXXXXXXX, +2557XXXXXXXX,
 * 06XXXXXXXX (Halotel/Tigo variants), and 2556XXXXXXXX.
 * Returns null when the input is not a valid Tanzanian mobile number.
 */
const TZ_MOBILE_PATTERN = /^255(6|7)\d{8}$/;

export function normalizeTanzanianPhone(input: string): string | null {
  const digits = input.replace(/[\s()+-]/g, "");

  let candidate: string;
  if (/^0[67]\d{8}$/.test(digits)) {
    candidate = `255${digits.slice(1)}`;
  } else if (/^[67]\d{8}$/.test(digits)) {
    candidate = `255${digits}`;
  } else if (/^255[67]\d{8}$/.test(digits)) {
    candidate = digits;
  } else {
    return null;
  }

  return TZ_MOBILE_PATTERN.test(candidate) ? candidate : null;
}
