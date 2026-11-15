import fp from "fastify-plugin";
import type { PrismaClient } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface PrismaPluginOptions {
  client: PrismaClient;
}

export default fp<PrismaPluginOptions>(
  async (app, options) => {
    await options.client.$connect();
    app.decorate("prisma", options.client);
    app.addHook("onClose", async () => {
      await options.client.$disconnect();
    });
  },
  { name: "prisma" },
);
