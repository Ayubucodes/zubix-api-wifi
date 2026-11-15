import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parseOrThrow } from "../../common/errors.js";
import { PaymentsService } from "./payments.service.js";

const initiateBody = z.object({
  packageId: z.string().uuid(),
  phoneNumber: z.string().min(9).max(20),
  providerCode: z.enum(["MOCK", "CLICKPESA", "SELCOM"]).optional(),
});

const referenceParam = z.object({ reference: z.string().regex(/^[A-Z0-9]{8,20}$/) });
const providerParam = z.object({ provider: z.enum(["MOCK", "CLICKPESA", "SELCOM"]) });
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]).optional(),
  provider: z.enum(["MOCK", "CLICKPESA", "SELCOM"]).optional(),
  search: z.string().trim().max(80).optional(),
});
const devCompleteBody = z.object({ status: z.enum(["SUCCESS", "FAILED"]) });

export const paymentsRoutes: FastifyPluginAsync = async (app) => {
  const service = new PaymentsService(app.prisma, app.paymentProviders);

  // Public: the captive portal starts a payment. The reference is the only handle afterwards.
  app.post(
    "/initiate",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { tags: ["payments"], summary: "Start a mobile money payment for a package" },
    },
    async (request, reply) => {
      const body = parseOrThrow(initiateBody, request.body);
      const idempotencyKey = request.headers["idempotency-key"];
      const payment = await service.initiate({
        packageId: body.packageId,
        phoneNumber: body.phoneNumber,
        providerCode: body.providerCode,
        idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey.slice(0, 100) : undefined,
      });
      return reply.status(201).send(payment);
    },
  );

  // Public, minimal: lets the portal poll status without exposing phone numbers or provider details.
  app.get(
    "/status/:reference",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: { tags: ["payments"], summary: "Poll a payment's status" },
    },
    async (request) => {
      const { reference } = parseOrThrow(referenceParam, request.params);
      const payment = await service.getByReference(reference);
      const subscription =
        payment.status === "SUCCESS"
          ? await app.prisma.subscription.findUnique({ where: { paymentId: payment.id }, select: { id: true, expiresAt: true } })
          : null;
      return {
        reference: payment.reference,
        status: payment.status,
        amountTzs: payment.amountTzs,
        packageName: payment.packageName,
        failureReason: payment.status === "FAILED" ? payment.failureReason : null,
        providerCode: payment.providerCode,
        subscriptionId: subscription?.id ?? null,
        expiresAt: subscription?.expiresAt?.toISOString() ?? null,
      };
    },
  );

  // Provider callbacks. Authenticity is checked by the provider adapter, not by this route.
  app.post(
    "/webhooks/:provider",
    { schema: { tags: ["payments"], summary: "Receive a provider webhook" } },
    async (request, reply) => {
      const { provider } = parseOrThrow(providerParam, request.params);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const outcome = await service.processWebhook(provider, body);
      return reply.status(200).send({ outcome });
    },
  );

  app.get(
    "/",
    {
      preHandler: [app.authorize("payments:read")],
      schema: { tags: ["payments"], summary: "List payments" },
    },
    async (request) => service.list(parseOrThrow(listQuery, request.query)),
  );

  app.get(
    "/:reference",
    {
      preHandler: [app.authorize("payments:read")],
      schema: { tags: ["payments"], summary: "Payment details" },
    },
    async (request) => service.getByReference(parseOrThrow(referenceParam, request.params).reference),
  );

  // Development only. Lets you test the full purchase flow without a real provider.
  if (app.appEnv !== "production") {
    app.post(
      "/dev/mock/:reference/complete",
      { schema: { tags: ["payments"], summary: "DEV ONLY: simulate a mock provider callback" } },
      async (request) => {
        const { reference } = parseOrThrow(referenceParam, request.params);
        const { status } = parseOrThrow(devCompleteBody, request.body);
        const outcome = await service.simulateMockCallback(reference, status);
        return { outcome };
      },
    );
  }
};
