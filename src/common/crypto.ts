import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2.js";

const ARGON2_OPTIONS = {
  t: 2,
  m: 19456,
  p: 1,
  dkLen: 32,
};
const MAX_ARGON2_MEMORY_KIB = 65536;
const MAX_ARGON2_ITERATIONS = 10;
const MAX_ARGON2_PARALLELISM = 4;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  // Keep the derivation synchronous so concurrent Worker requests cannot share async scratch state.
  const hash = argon2id(plain, salt, ARGON2_OPTIONS);
  return `$argon2id$v=19$m=${ARGON2_OPTIONS.m},t=${ARGON2_OPTIONS.t},p=${ARGON2_OPTIONS.p}$${encodeBase64(salt)}$${encodeBase64(hash)}`;
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    const parsed = parseArgon2idHash(hash);
    if (!parsed) return false;
    const computed = argon2id(plain, parsed.salt, {
      t: parsed.iterations,
      m: parsed.memoryKiB,
      p: parsed.parallelism,
      dkLen: parsed.hash.length,
      version: parsed.version,
      maxmem: MAX_ARGON2_MEMORY_KIB * 1024,
    });
    return computed.length === parsed.hash.length && timingSafeEqual(computed, parsed.hash);
  } catch {
    return false;
  }
}

function parseArgon2idHash(value: string) {
  const parts = value.split("$");
  if (parts.length !== 6 || parts[0] !== "" || parts[1] !== "argon2id") return null;

  const versionField = parts[2];
  const parameterField = parts[3];
  const saltField = parts[4];
  const hashField = parts[5];
  if (!versionField || !parameterField || !saltField || !hashField) return null;

  const version = versionField === "v=19" ? 19 : versionField === "v=16" ? 16 : null;
  const parameters = new Map<string, string>();
  for (const parameter of parameterField.split(",")) {
    const separator = parameter.indexOf("=");
    if (separator <= 0) return null;
    parameters.set(parameter.slice(0, separator), parameter.slice(separator + 1));
  }
  const memoryValue = parameters.get("m");
  const iterationValue = parameters.get("t");
  const parallelismValue = parameters.get("p");
  if (!memoryValue || !iterationValue || !parallelismValue) return null;
  const memoryKiB = Number(memoryValue);
  const iterations = Number(iterationValue);
  const parallelism = Number(parallelismValue);
  if (
    version === null ||
    parameters.size !== 3 ||
    !Number.isInteger(memoryKiB) ||
    memoryKiB < 8 * parallelism ||
    memoryKiB > MAX_ARGON2_MEMORY_KIB ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_ARGON2_ITERATIONS ||
    !Number.isInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > MAX_ARGON2_PARALLELISM
  ) {
    return null;
  }

  const salt = decodeBase64(saltField);
  const hash = decodeBase64(hashField);
  if (salt.length < 8 || hash.length < 4) return null;

  return {
    version,
    memoryKiB,
    iterations,
    parallelism,
    salt,
    hash,
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, "");
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid base64");
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Opaque, URL-safe random token returned to clients. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Only hashes of refresh tokens are stored, so a database leak cannot be replayed. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
