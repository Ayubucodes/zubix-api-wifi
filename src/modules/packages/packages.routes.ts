import type { FastifyPluginAsync } from "fastify";
import { parseOrThrow } from "../../common/errors.js";
import { PackagesService } from "./packages.service.js";
import {
  createPackageSchema,
  idParamSchema,
  listPackagesQuerySchema,
  updatePackageSchema,
} from "./packages.schemas.js";

export const packagesRoutes: FastifyPluginAsync = async (app) => {
  const service = new PackagesService(app.prisma);

  app.get(
    "/",
    {
      preHandler: [app.authorize("packages:read")],
      schema: { tags: ["packages"], summary: "List packages" },
    },
    async (request) => service.list(parseOrThrow(listPackagesQuerySchema, request.query)),
  );

  app.get(
    "/:id",
    {
      preHandler: [app.authorize("packages:read")],
      schema: { tags: ["packages"], summary: "Get a package" },
    },
    async (request) => service.get(parseOrThrow(idParamSchema, request.params).id),
  );

  app.post(
    "/",
    {
      preHandler: [app.authorize("packages:manage")],
      schema: { tags: ["packages"], summary: "Create a package" },
    },
    async (request, reply) => {
      const input = parseOrThrow(createPackageSchema, request.body);
      const created = await service.create(input, request.currentUser!.id);
      return reply.status(201).send(created);
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: [app.authorize("packages:manage")],
      schema: { tags: ["packages"], summary: "Update a package" },
    },
    async (request) => {
      const { id } = parseOrThrow(idParamSchema, request.params);
      const input = parseOrThrow(updatePackageSchema, request.body);
      return service.update(id, input, request.currentUser!.id);
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [app.authorize("packages:manage")],
      schema: { tags: ["packages"], summary: "Archive a package (soft delete)" },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(idParamSchema, request.params);
      await service.archive(id, request.currentUser!.id);
      return reply.status(204).send();
    },
  );
};
