import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../common/errors.js";
import { SettingsService } from "./settings.service.js";

const providerParam = z.object({ code: z.enum(["SELCOM", "CLICKPESA", "MOCK"]) });
const providerBody = z.object({ enabled: z.boolean() });
const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  entityType: z.string().trim().max(64).optional(),
});

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const service = new SettingsService(app.prisma, {
    appEnv: app.appEnv,
    registeredProviders: new Set<string>(app.paymentProviders.keys()),
  });

  app.get(
    "/payment-providers",
    { preHandler: [app.authorize("settings:manage")], schema: { tags: ["settings"], summary: "List payment providers" } },
    async () => service.listProviders(),
  );

  app.patch(
    "/payment-providers/:code",
    { preHandler: [app.authorize("settings:manage")], schema: { tags: ["settings"], summary: "Enable or disable a payment provider" } },
    async (request) => {
      const { code } = parseOrThrow(providerParam, request.params);
      const { enabled } = parseOrThrow(providerBody, request.body);
      return service.setProviderEnabled(code, enabled, request.currentUser!.id);
    },
  );

  app.get(
    "/audit-log",
    { preHandler: [app.authorize("audit:read")], schema: { tags: ["settings"], summary: "Audit log" } },
    async (request) => service.auditLog(parseOrThrow(auditQuery, request.query)),
  );
};
