import type { FastifyPluginAsync } from "fastify";
import { parseOrThrow } from "../../common/errors.js";
import { AuthService } from "./auth.service.js";
import { loginBodySchema, refreshBodySchema } from "./auth.schemas.js";

export interface AuthRoutesOptions {
  refreshTtlSeconds: number;
  accessTtlSeconds: number;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  const service = new AuthService(app.prisma, {
    refreshTtlSeconds: options.refreshTtlSeconds,
    accessTtlSeconds: options.accessTtlSeconds,
    signAccessToken: (userId) => app.signAccessToken(userId),
  });

  app.post(
    "/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: { tags: ["auth"], summary: "Sign in with email and password" },
    },
    async (request) => {
      const body = parseOrThrow(loginBodySchema, request.body);
      return service.login(body.email, body.password, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
    },
  );

  app.post(
    "/refresh",
    {
      config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
      schema: { tags: ["auth"], summary: "Rotate refresh token and issue a new access token" },
    },
    async (request) => {
      const body = parseOrThrow(refreshBodySchema, request.body);
      return service.refresh(body.refreshToken, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
    },
  );

  app.post(
    "/logout",
    { schema: { tags: ["auth"], summary: "Revoke a refresh token" } },
    async (request, reply) => {
      const body = parseOrThrow(refreshBodySchema, request.body);
      await service.logout(body.refreshToken);
      return reply.status(204).send();
    },
  );

  app.get(
    "/me",
    {
      preHandler: [app.authenticate],
      schema: { tags: ["auth"], summary: "Current user with roles and permissions" },
    },
    async (request) => {
      return service.me(request.currentUser!.id);
    },
  );
};
