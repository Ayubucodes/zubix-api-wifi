import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import { generateOpaqueToken, hashPassword, sha256Hex, verifyPassword } from "../../common/crypto.js";
import { loadAuthUser, type AuthUser } from "./auth-user.js";

export interface SessionMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export interface AuthServiceOptions {
  refreshTtlSeconds: number;
  accessTtlSeconds: number;
  signAccessToken: (userId: string) => string | Promise<string>;
}

/** Real Argon2 hash of random data, so unknown-email logins take as long as known-email logins. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHashPromise;
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: AuthServiceOptions,
  ) {}

  async login(email: string, password: string, meta: SessionMeta): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordOk = await verifyPassword(user?.passwordHash ?? (await dummyHash()), password);

    if (!user || !user.isActive || !passwordOk) {
      throw AppError.unauthorized("Invalid email or password");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit(user.id, "auth.login", "User", user.id, meta.ipAddress);

    return this.issueTokens(user.id, meta);
  }

  /**
   * Rotates a refresh token. Each token can be used once. If an already-used token is presented,
   * every session for that user is revoked, because the token has probably been copied.
   */
  async refresh(refreshToken: string, meta: SessionMeta): Promise<TokenPair> {
    const tokenHash = sha256Hex(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw AppError.unauthorized("Invalid refresh token");
    }

    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(stored.userId, "auth.refresh_reuse_detected", "User", stored.userId, meta.ipAddress);
      throw AppError.unauthorized("Refresh token was already used. Please sign in again.");
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw AppError.unauthorized("Refresh token has expired");
    }

    const user = await loadAuthUser(this.prisma, stored.userId);
    if (!user) {
      throw AppError.unauthorized("Account is not active");
    }

    const next = generateOpaqueToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Claim the old token atomically. If another request already claimed it, count is 0.
      const claim = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claim.count !== 1) {
        return false;
      }
      const created = await tx.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: sha256Hex(next),
          expiresAt: this.refreshExpiry(),
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
        },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { replacedById: created.id },
      });
      return true;
    });

    if (!rotated) {
      throw AppError.unauthorized("Refresh token was already used. Please sign in again.");
    }

    return {
      accessToken: await this.options.signAccessToken(stored.userId),
      refreshToken: next,
      tokenType: "Bearer",
      expiresIn: this.options.accessTtlSeconds,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    // Idempotent: unknown or already-revoked tokens are ignored.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256Hex(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await loadAuthUser(this.prisma, userId);
    if (!user) {
      throw AppError.unauthorized();
    }
    return user;
  }

  private async issueTokens(userId: string, meta: SessionMeta): Promise<TokenPair> {
    const refreshToken = generateOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: this.refreshExpiry(),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });
    return {
      accessToken: await this.options.signAccessToken(userId),
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.options.accessTtlSeconds,
    };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.options.refreshTtlSeconds * 1000);
  }

  private async audit(
    actorUserId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actorUserId, action, entityType, entityId, ipAddress },
    });
  }
}
