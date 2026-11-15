import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError, parseOrThrow } from "../../common/errors.js";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createBody = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Use letters, numbers and hyphens (2-20 characters)"),
  address: z.string().trim().max(255).nullable().optional(),
});

export const locationsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      preHandler: [app.authorize("locations:read")],
      schema: { tags: ["locations"], summary: "List locations" },
    },
    async (request) => {
      const query = parseOrThrow(listQuery, request.query);
      const where = { isActive: true };
      const [items, total] = await Promise.all([
        app.prisma.location.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, name: true, code: true, address: true, timezone: true },
        }),
        app.prisma.location.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    },
  );

  app.post(
    "/",
    {
      preHandler: [app.authorize("locations:manage")],
      schema: { tags: ["locations"], summary: "Create a location" },
    },
    async (request, reply) => {
      const body = parseOrThrow(createBody, request.body);
      const existing = await app.prisma.location.findUnique({ where: { code: body.code } });
      if (existing) {
        throw AppError.conflict("A location with this code already exists");
      }
      const actorUserId = request.currentUser!.id;
      const location = await app.prisma.$transaction(async (tx) => {
        const created = await tx.location.create({
          data: { name: body.name, code: body.code, address: body.address ?? null },
          select: { id: true, name: true, code: true, address: true, timezone: true },
        });
        await tx.auditLog.create({
          data: { actorUserId, action: "location.create", entityType: "Location", entityId: created.id },
        });
        return created;
      });
      return reply.status(201).send(location);
    },
  );
};
