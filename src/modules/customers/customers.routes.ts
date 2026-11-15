import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../common/errors.js";
import { CustomersService } from "./customers.service.js";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(80).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const statusBody = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });

export const customersRoutes: FastifyPluginAsync = async (app) => {
  const service = new CustomersService(app.prisma);

  app.get("/", { preHandler: [app.authorize("customers:read")], schema: { tags: ["customers"] } }, async (request) =>
    service.list(parseOrThrow(listQuery, request.query)),
  );

  app.get("/:id", { preHandler: [app.authorize("customers:read")], schema: { tags: ["customers"] } }, async (request) =>
    service.detail(parseOrThrow(idParam, request.params).id),
  );

  app.patch("/:id/status", { preHandler: [app.authorize("customers:manage")], schema: { tags: ["customers"] } }, async (request) => {
    const { id } = parseOrThrow(idParam, request.params);
    const { status } = parseOrThrow(statusBody, request.body);
    return service.setStatus(id, status, request.currentUser!.id);
  });
};
