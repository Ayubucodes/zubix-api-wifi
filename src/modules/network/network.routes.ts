import type { FastifyPluginAsync } from "fastify";

/**
 * Read-only network view. Controller passwords are never selected. Live session and AP status
 * come from the database and are only as fresh as the last Omada sync, which is not built yet.
 */
export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/overview",
    {
      preHandler: [app.authorize("network:read")],
      schema: { tags: ["network"], summary: "Controllers, sites, access points, active sessions and recent events (read-only)" },
    },
    async () => {
      const [controllers, sites, accessPoints, activeSessions, events] = await Promise.all([
        app.prisma.omadaController.findMany({
          select: { id: true, name: true, baseUrl: true, isActive: true, lastTestedAt: true, lastTestStatus: true, lastError: true },
          orderBy: { createdAt: "asc" },
        }),
        app.prisma.networkSite.findMany({
          select: { id: true, name: true, omadaSiteId: true, isActive: true, controllerId: true },
          orderBy: { createdAt: "asc" },
        }),
        app.prisma.accessPoint.findMany({
          select: { id: true, name: true, model: true, macAddress: true, status: true, lastSeenAt: true, networkSiteId: true },
          orderBy: { name: "asc" },
        }),
        app.prisma.wifiSession.count({ where: { disconnectedAt: null } }),
        app.prisma.networkEvent.findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, type: true, severity: true, message: true, createdAt: true },
        }),
      ]);
      return {
        dataSource: "database",
        note: "Live controller data is not synced yet. Values reflect the last recorded state.",
        controllers: controllers.map((c) => ({
          ...c,
          lastTestedAt: c.lastTestedAt?.toISOString() ?? null,
        })),
        sites,
        accessPoints: accessPoints.map((ap) => ({ ...ap, lastSeenAt: ap.lastSeenAt?.toISOString() ?? null })),
        activeSessionCount: activeSessions,
        recentEvents: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      };
    },
  );
};
