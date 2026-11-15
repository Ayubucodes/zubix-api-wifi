import type { FastifyPluginAsync } from "fastify";
import { DashboardService } from "./dashboard.service.js";

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const service = new DashboardService(app.prisma);

  app.get(
    "/overview",
    {
      preHandler: [app.authorize("reports:read")],
      schema: { tags: ["dashboard"], summary: "Headline statistics and 7-day revenue series" },
    },
    async () => service.overview(),
  );
};
