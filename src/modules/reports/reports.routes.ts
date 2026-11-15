import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../common/errors.js";
import { ReportsService, type DateRange } from "./reports.service.js";

const rangeQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).superRefine((value, ctx) => {
  const days = (value.to.getTime() - value.from.getTime()) / 86_400_000;
  if (days <= 0) ctx.addIssue({ code: "custom", message: "'to' must be after 'from'" });
  if (days > 366) ctx.addIssue({ code: "custom", message: "Range cannot exceed 366 days" });
});

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  const service = new ReportsService(app.prisma);

  const range = (query: unknown): DateRange => {
    const parsed = parseOrThrow(rangeQuery, query);
    return { from: parsed.from, to: parsed.to };
  };

  app.get(
    "/revenue",
    { preHandler: [app.authorize("reports:read")], schema: { tags: ["reports"], summary: "Revenue by day and package" } },
    async (request) => service.revenue(range(request.query)),
  );

  app.get(
    "/vouchers",
    { preHandler: [app.authorize("reports:read")], schema: { tags: ["reports"], summary: "Voucher sales" } },
    async (request) => service.voucherSales(range(request.query)),
  );

  app.get(
    "/customers",
    { preHandler: [app.authorize("reports:read")], schema: { tags: ["reports"], summary: "Customer growth" } },
    async (request) => service.customerGrowth(range(request.query)),
  );

  app.get(
    "/payments.csv",
    { preHandler: [app.authorize("reports:read")], schema: { tags: ["reports"], summary: "Payments CSV export" } },
    async (request, reply) => {
      const csv = await service.paymentsCsv(range(request.query));
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="payments.csv"')
        .send(csv);
    },
  );
};
