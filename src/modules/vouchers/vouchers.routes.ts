import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../common/errors.js";
import { VouchersService } from "./vouchers.service.js";

const idParam = z.object({ id: z.string().uuid() });
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const createBatchBody = z.object({
  name: z.string().trim().min(2).max(120),
  packageId: z.string().uuid(),
  quantity: z.number().int().min(1).max(500),
  usageLimit: z.number().int().min(1).max(50).default(1),
  expiresAt: z.coerce.date().optional(),
});

const listQuery = pageQuery.extend({
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED", "EXHAUSTED"]).optional(),
  batchId: z.string().uuid().optional(),
  sold: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

const codesQuery = z.object({ reason: z.string().trim().min(5, "Give a reason for revealing codes") });
const saleBody = z.object({
  channel: z.enum(["CASH", "MOBILE_MONEY"]),
  amountTzs: z.number().int().min(0).max(100_000_000),
});
const revokeBody = z.object({ reason: z.string().trim().min(5).max(300) });
const redeemBody = z.object({
  code: z.string().trim().min(6).max(64),
  phone: z.string().trim().min(9).max(20),
});

export const vouchersRoutes: FastifyPluginAsync = async (app) => {
  const service = new VouchersService(app.prisma, app.voucherKeys, () => new Date());

  // Public redemption from the captive portal. Rate limited per IP to slow down code guessing.
  app.post(
    "/redeem",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: { tags: ["vouchers"], summary: "Redeem a voucher code for a phone number" },
    },
    async (request) => {
      const input = parseOrThrow(redeemBody, request.body);
      return service.redeem(input.code, input.phone);
    },
  );

  app.get(
    "/batches",
    {
      preHandler: [app.authorize("vouchers:read")],
      schema: { tags: ["vouchers"], summary: "List voucher batches" },
    },
    async (request) => {
      const q = parseOrThrow(pageQuery, request.query);
      return service.listBatches(q.page, q.pageSize);
    },
  );

  app.post(
    "/batches",
    {
      preHandler: [app.authorize("vouchers:manage")],
      schema: { tags: ["vouchers"], summary: "Generate a voucher batch" },
    },
    async (request, reply) => {
      const input = parseOrThrow(createBatchBody, request.body);
      const created = await service.createBatch(input, request.currentUser!.id);
      return reply.status(201).send(created);
    },
  );

  app.get(
    "/batches/:id/codes",
    {
      preHandler: [app.authorize("vouchers:manage")],
      schema: { tags: ["vouchers"], summary: "Reveal batch codes for printing (audited)" },
    },
    async (request) => {
      const { id } = parseOrThrow(idParam, request.params);
      const { reason } = parseOrThrow(codesQuery, request.query);
      return service.batchCodes(id, request.currentUser!.id, reason);
    },
  );

  app.get(
    "/",
    {
      preHandler: [app.authorize("vouchers:read")],
      schema: { tags: ["vouchers"], summary: "List vouchers (codes are never returned)" },
    },
    async (request) => service.list(parseOrThrow(listQuery, request.query)),
  );

  app.get(
    "/:id",
    {
      preHandler: [app.authorize("vouchers:read")],
      schema: { tags: ["vouchers"], summary: "Voucher detail with redemptions" },
    },
    async (request) => service.detail(parseOrThrow(idParam, request.params).id),
  );

  app.post(
    "/:id/sale",
    {
      preHandler: [app.authorize("vouchers:sell")],
      schema: { tags: ["vouchers"], summary: "Record a cash or mobile-money sale" },
    },
    async (request) => {
      const { id } = parseOrThrow(idParam, request.params);
      const input = parseOrThrow(saleBody, request.body);
      return service.recordSale(id, input.channel, input.amountTzs, request.currentUser!.id);
    },
  );

  app.post(
    "/:id/revoke",
    {
      preHandler: [app.authorize("vouchers:manage")],
      schema: { tags: ["vouchers"], summary: "Revoke a voucher" },
    },
    async (request) => {
      const { id } = parseOrThrow(idParam, request.params);
      const { reason } = parseOrThrow(revokeBody, request.body);
      return service.revoke(id, reason, request.currentUser!.id);
    },
  );
};
