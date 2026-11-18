import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../common/errors.js";
import { PublicService } from "./public.service.js";

const connectBody = z.object({
  subscriptionId: z.string().uuid(),
  clientMac: z.string().min(11).max(17),
  clientIp: z.string().ip(),
  apMac: z.string().min(11).max(17),
  ssidName: z.string().max(64).default(""),
  radioId: z.union([z.literal(0), z.literal(1)]).default(0),
});

/** Unauthenticated endpoints used by the captive portal. Keep responses minimal. */
export const publicRoutes: FastifyPluginAsync<{ appName: string; supportPhone?: string }> = async (app, options) => {
  const service = new PublicService(app.prisma, app.omadaFactory);

  app.get(
    "/config",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { tags: ["public"], summary: "Portal settings" } },
    async () => ({
      appName: options.appName,
      supportPhone: options.supportPhone ?? null,
      providers: await service.enabledProviders(new Set<string>(app.paymentProviders.keys())),
    }),
  );

  app.get(
    "/packages",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { tags: ["public"], summary: "Packages on sale" } },
    async () => service.listPackages(),
  );

  app.post(
    "/connect",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["public"], summary: "Let a paid device onto the Wi-Fi" } },
    async (request) => {
      const input = parseOrThrow(connectBody, request.body);
      return service.connect(input);
    },
  );
};
