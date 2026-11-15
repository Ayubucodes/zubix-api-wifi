import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB, OWASP minimum recommendation
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Opaque, URL-safe random token returned to clients. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Only hashes of refresh tokens are stored, so a database leak cannot be replayed. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
