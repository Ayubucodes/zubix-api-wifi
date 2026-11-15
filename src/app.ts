import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "./config/env.js";
import { registerErrorHandler } from "./common/errors.js";
import prismaPlugin from "./plugins/prisma.js";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { packagesRoutes } from "./modules/packages/packages.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { locationsRoutes } from "./modules/locations/locations.routes.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";
import { subscriptionsRoutes } from "./modules/subscriptions/subscriptions.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { vouchersRoutes } from "./modules/vouchers/vouchers.routes.js";
import { networkRoutes } from "./modules/network/network.routes.js";
import { reportsRoutes } from "./modules/reports/reports.routes.js";
import { settingsRoutes } from "./modules/settings/settings.routes.js";
import { publicRoutes } from "./modules/public/public.routes.js";
import { OmadaClient } from "./integrations/omada/omada.client.js";
import { createProviders } from "./integrations/payments/registry.js";
import type { PaymentProvider, ProviderCode } from "./integrations/payments/payment.types.js";
import type { VoucherKeys } from "./modules/vouchers/vouchers.service.js";

declare module "fastify" {
  interface FastifyInstance {
    appEnv: AppEnv["APP_ENV"];
    paymentProviders: Map<ProviderCode, PaymentProvider>;
    voucherKeys: VoucherKeys | null;
    omadaFactory: (() => OmadaClient) | null;
  }
}

export interface BuildAppOptions {
  env: AppEnv;
  prisma: PrismaClient;
  logger?: boolean;
}

export async function buildApp({ env, prisma, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 64 * 1024,
    logger: logger
      ? {
          level: env.APP_ENV === "production" ? "info" : "debug",
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.body.password",
              "req.body.refreshToken",
            ],
            censor: "[REDACTED]",
          },
        }
      : false,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
  });
  await app.register(rateLimit, { global: false });
  await app.register(sensible);

  await app.register(swagger, {
    openapi: {
      info: { title: "Zubix WiFi API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  registerErrorHandler(app);

  await app.register(prismaPlugin, { client: prisma });

  app.decorate("appEnv", env.APP_ENV);
  app.decorate(
    "omadaFactory",
    env.OMADA_CONTROLLER_URL && env.OMADA_USERNAME && env.OMADA_PASSWORD
      ? () =>
          new OmadaClient({
            baseUrl: env.OMADA_CONTROLLER_URL as string,
            operatorName: env.OMADA_USERNAME as string,
            operatorPassword: env.OMADA_PASSWORD as string,
            paths:
              env.OMADA_LOGIN_PATH && env.OMADA_AUTHORIZE_PATH
                ? { login: env.OMADA_LOGIN_PATH, authorize: env.OMADA_AUTHORIZE_PATH }
                : undefined,
          })
      : null,
  );
  app.decorate("paymentProviders", createProviders(env));
  app.decorate(
    "voucherKeys",
    env.VOUCHER_HMAC_KEY && env.VOUCHER_ENCRYPTION_KEY
      ? { hmacKey: env.VOUCHER_HMAC_KEY, encryptionKeyHex: env.VOUCHER_ENCRYPTION_KEY }
      : null,
  );
  await app.register(authPlugin, {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
  });

  app.get("/health", { schema: { tags: ["system"] } }, async () => {
    await app.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", time: new Date().toISOString(), timezone: env.APP_TIMEZONE };
  });

  await app.register(
    async (v1) => {
      await v1.register(authRoutes, {
        prefix: "/auth",
        refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
        accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      });
      await v1.register(packagesRoutes, { prefix: "/packages" });
      await v1.register(dashboardRoutes, { prefix: "/dashboard" });
      await v1.register(locationsRoutes, { prefix: "/locations" });
      await v1.register(customersRoutes, { prefix: "/customers" });
      await v1.register(subscriptionsRoutes, { prefix: "/subscriptions" });
      await v1.register(paymentsRoutes, { prefix: "/payments" });
      await v1.register(vouchersRoutes, { prefix: "/vouchers" });
      await v1.register(networkRoutes, { prefix: "/network" });
      await v1.register(reportsRoutes, { prefix: "/reports" });
      await v1.register(settingsRoutes, { prefix: "/settings" });
      await v1.register(publicRoutes, { prefix: "/public", appName: env.APP_NAME, supportPhone: env.SUPPORT_PHONE });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
