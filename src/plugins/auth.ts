import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { PrismaClient, RoleName } from "@prisma/client";
import { AppError } from "../common/errors.js";
import type { PermissionCode } from "../common/permissions.js";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: RoleName[];
  permissions: PermissionCode[];
}

export interface AccessTokenClaims {
  sub: string;
  typ: "access";
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: AuthUser;
  }
  interface FastifyInstance {
    authenticate: preHandlerAsyncHookHandler;
    authorize: (...required: PermissionCode[]) => preHandlerAsyncHookHandler;
    signAccessToken: (userId: string) => string;
  }
}

export interface AuthPluginOptions {
  accessSecret: string;
  accessTtlSeconds: number;
}

/**
 * Verifies the bearer access token, then loads the user's current roles and permissions
 * from the database. Permissions are never trusted from the token itself, so a role change
 * or deactivation takes effect on the next request.
 */
export default fp<AuthPluginOptions>(
  async (app, options) => {
    await app.register(jwt, {
      secret: options.accessSecret,
      sign: { expiresIn: options.accessTtlSeconds },
    });

    const verifyRequest = async (request: FastifyRequest): Promise<void> => {
      let claims: AccessTokenClaims;
      try {
        claims = await request.jwtVerify<AccessTokenClaims>();
      } catch {
        throw AppError.unauthorized();
      }
      if (claims.typ !== "access") {
        throw AppError.unauthorized();
      }
      const user = await loadAuthUser(app.prisma, claims.sub);
      if (!user) {
        throw AppError.unauthorized();
      }
      request.currentUser = user;
    };

    app.decorate("signAccessToken", (userId: string) => {
      const claims: AccessTokenClaims = { sub: userId, typ: "access" };
      return app.jwt.sign(claims);
    });

    app.decorate("authenticate", async (request: FastifyRequest) => {
      await verifyRequest(request);
    });

    app.decorate("authorize", (...required: PermissionCode[]) => {
      return async (request: FastifyRequest) => {
        await verifyRequest(request);
        const user = request.currentUser;
        if (!user) {
          throw AppError.unauthorized();
        }
        const isSuperAdmin = user.roles.includes("SUPER_ADMIN" as RoleName);
        const allowed = isSuperAdmin || required.every((code) => user.permissions.includes(code));
        if (!allowed) {
          throw AppError.forbidden();
        }
      };
    });
  },
  { name: "auth", dependencies: ["prisma"] },
);

export async function loadAuthUser(prisma: PrismaClient, userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!user || !user.isActive) {
    return null;
  }

  const roles = user.roles.map((userRole: { role: { name: RoleName } }) => userRole.role.name);
  const permissions = new Set<PermissionCode>();
  for (const userRole of user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.code as PermissionCode);
    }
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles,
    permissions: [...permissions],
  };
}
