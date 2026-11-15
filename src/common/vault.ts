import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * Voucher secrets. Codes are looked up by HMAC (never stored in plaintext), and the printable
 * code is kept AES-256-GCM encrypted so an admin can reprint it. Keys come from the environment.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid misreading

/** Random code in groups of 4, e.g. K7QF-2XMP-9TWA. 12 characters ~ 60 bits of entropy. */
export function generateVoucherCode(): string {
  let raw = "";
  for (let i = 0; i < 12; i += 1) {
    raw += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Codes are typed by customers, so normalize case, spaces and dashes before hashing. */
export function normalizeVoucherCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function hashVoucherCode(code: string, hmacKey: string): string {
  return createHmac("sha256", hmacKey).update(normalizeVoucherCode(code)).digest("hex");
}

export function encryptSecret(plain: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(payload: string, keyHex: string): string {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}

/** Last four characters are safe to display in lists. */
export function voucherHint(code: string): string {
  return normalizeVoucherCode(code).slice(-4);
}
