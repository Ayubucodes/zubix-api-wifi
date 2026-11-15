import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../common/errors.js";
import { SubscriptionsService } from "./subscriptions.service.js";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["PENDING", "ACTIVE", "EXPIRED", "SUSPENDED", "CANCELLED"]).optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const cancelBody = z.object({ reason: z.string().trim().min(5).max(200) });

export const subscriptionsRoutes: FastifyPluginAsync = async (app) => {
  const service = new SubscriptionsService(app.prisma);

  app.get("/", { preHandler: [app.authorize("subscriptions:read")], schema: { tags: ["subscriptions"] } }, async (request) =>
    service.list(parseOrThrow(listQuery, request.query)),
  );

  app.get("/:id", { preHandler: [app.authorize("subscriptions:read")], schema: { tags: ["subscriptions"] } }, async (request) =>
    service.detail(parseOrThrow(idParam, request.params).id),
  );

  app.post("/:id/cancel", { preHandler: [app.authorize("subscriptions:manage")], schema: { tags: ["subscriptions"] } }, async (request) => {
    const { id } = parseOrThrow(idParam, request.params);
    const { reason } = parseOrThrow(cancelBody, request.body);
    return service.cancel(id, reason, request.currentUser!.id);
  });
};
