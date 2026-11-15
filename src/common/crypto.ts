import { createHash, randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

const ARGON2_OPTIONS = {
  iterations: 2,
  memorySize: 19456,
  parallelism: 1,
  hashLength: 32,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2id({
    password: plain,
    salt: randomBytes(16),
    ...ARGON2_OPTIONS,
    outputType: "encoded",
  }).then((hash) => {
    if (typeof hash !== "string") {
      throw new Error("Argon2 did not return an encoded hash");
    }
    return hash;
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2Verify({ hash, password: plain });
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
