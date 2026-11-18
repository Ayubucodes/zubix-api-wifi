import { randomInt } from "node:crypto";
import type { Prisma, PaymentStatus, PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import { normalizeTanzanianPhone } from "../../utils/phone.js";
import type { PaymentProvider, ProviderCode, NormalizedWebhook } from "../../integrations/payments/payment.types.js";
import { activateSubscription } from "../subscriptions/subscription.activation.js";

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CLAIMABLE_FOR_SUCCESS = ["PENDING", "PROCESSING", "FAILED", "EXPIRED"] as const;

export type WebhookOutcome =
  | "activated"
  | "already_processed"
  | "failed"
  | "pending"
  | "duplicate"
  | "ignored"
  | "unknown_reference"
  | "amount_mismatch";

export interface InitiatePaymentInput {
  packageId: string;
  phoneNumber: string;
  providerCode?: ProviderCode;
  idempotencyKey?: string;
}

/** Shape used by the portal and admin. Never includes provider secrets or raw webhook payloads. */
export function toPaymentDto(payment: {
  id: string;
  reference: string;
  amountTzs: number;
  currency: string;
  phoneNumber: string;
  status: string;
  failureReason: string | null;
  providerTransactionId: string | null;
  initiatedAt: Date;
  paidAt: Date | null;
  failedAt: Date | null;
  package?: { name: string } | null;
  provider?: { code: string; name: string } | null;
}) {
  return {
    id: payment.id,
    reference: payment.reference,
    amountTzs: payment.amountTzs,
    currency: payment.currency,
    phoneNumber: payment.phoneNumber,
    status: payment.status,
    failureReason: payment.failureReason,
    providerTransactionId: payment.providerTransactionId,
    packageName: payment.package?.name ?? null,
    providerCode: payment.provider?.code ?? null,
    providerName: payment.provider?.name ?? null,
    initiatedAt: payment.initiatedAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
    failedAt: payment.failedAt?.toISOString() ?? null,
  };
}

export class PaymentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: Map<ProviderCode, PaymentProvider>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Creates a payment and asks the provider to start it. Amount always comes from the package
   * price in the database, never from the request. Reusing an idempotency key returns the
   * existing payment, so a retried request cannot charge the customer twice.
   */
  async initiate(input: InitiatePaymentInput) {
    const phone = normalizeTanzanianPhone(input.phoneNumber);
    if (!phone) throw AppError.badRequest("Enter a valid Tanzanian mobile number");

    if (input.idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { package: true, provider: true },
      });
      if (existing) return toPaymentDto(existing);
    }

    const pkg = await this.prisma.package.findUnique({ where: { id: input.packageId } });
    if (!pkg || !pkg.isActive || pkg.isArchived) throw AppError.notFound("Package is not available");

    const providerCode = input.providerCode ?? "MOCK";
    const providerRow = await this.prisma.paymentProvider.findUnique({ where: { code: providerCode } });
    if (!providerRow || !providerRow.isEnabled) {
      throw AppError.conflict(`Payment provider ${providerCode} is not enabled`);
    }
    const provider = this.providers.get(providerCode);
    if (!provider) throw AppError.conflict(`Payment provider ${providerCode} is not configured`);

    const customer = await this.prisma.customer.upsert({
      where: { phoneNumber: phone },
      update: {},
      create: { phoneNumber: phone },
    });
    if (customer.status !== "ACTIVE") throw AppError.forbidden("This account cannot make purchases. Contact support.");

    const payment = await this.prisma.payment.create({
      data: {
        reference: generateReference(),
        customerId: customer.id,
        packageId: pkg.id,
        providerId: providerRow.id,
        amountTzs: pkg.priceTzs,
        currency: "TZS",
        phoneNumber: phone,
        status: "PENDING",
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    try {
      const result = await provider.initiatePayment({
        reference: payment.reference,
        amountTzs: payment.amountTzs,
        phoneNumber: phone,
      });
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: result.status === "SUCCESS" ? "PROCESSING" : mapToPaymentStatus(result.status), providerTransactionId: result.providerTransactionId },
        }),
        this.prisma.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            operation: "INITIATE",
            requestSnapshot: { reference: payment.reference, amountTzs: payment.amountTzs, phoneLast4: phone.slice(-4) },
            responseSnapshot: { providerTransactionId: result.providerTransactionId, status: result.status },
            succeeded: true,
          },
        }),
      ]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Provider error";
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: "FAILED", failureReason: reason, failedAt: this.now() },
        }),
        this.prisma.paymentTransaction.create({
          data: { paymentId: payment.id, operation: "INITIATE", succeeded: false, errorMessage: reason },
        }),
      ]);
      throw AppError.badGateway("The payment provider could not start the payment. Please try again.");
    }

    return this.getByReference(payment.reference);
  }

  async getByReference(reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
      include: { package: true, provider: true },
    });
    if (!payment) throw AppError.notFound("Payment not found");
    return toPaymentDto(payment);
  }

  async list(params: { page: number; pageSize: number; status?: string; providerCode?: string; search?: string }) {
    const where: Prisma.PaymentWhereInput = {
      ...(params.status ? { status: params.status as PaymentStatus } : {}),
      ...(params.providerCode ? { provider: { code: params.providerCode as ProviderCode } } : {}),
      ...(params.search
        ? {
            OR: [
              { reference: { contains: params.search, mode: "insensitive" } },
              { phoneNumber: { contains: params.search } },
              { providerTransactionId: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: { package: true, provider: true },
        orderBy: { initiatedAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: rows.map(toPaymentDto), page: params.page, pageSize: params.pageSize, total };
  }

  /** Webhook pipeline: authenticate, record, check amount and currency, then activate exactly once. */
  async processWebhook(providerCode: ProviderCode, body: Record<string, unknown>): Promise<WebhookOutcome> {
    const provider = this.providers.get(providerCode);
    if (!provider) throw AppError.notFound("Unknown payment provider");

    if (!provider.verifyWebhook(body)) {
      await this.prisma.paymentWebhook.create({
        data: { providerCode, signatureValid: false, payload: body as Prisma.InputJsonValue, processingError: "Invalid signature" },
      });
      throw AppError.unauthorized("Webhook signature is invalid");
    }

    const parsed = provider.parseWebhook(body);
    if (!parsed) {
      await this.prisma.paymentWebhook.create({
        data: { providerCode, signatureValid: true, payload: body as Prisma.InputJsonValue, processedAt: this.now(), processingError: "Not a payment event" },
      });
      return "ignored";
    }

    const externalEventId = `${parsed.providerTransactionId}:${parsed.status}`;
    let webhookId: string;
    try {
      const record = await this.prisma.paymentWebhook.create({
        data: { providerCode, externalEventId, signatureValid: true, payload: body as Prisma.InputJsonValue },
      });
      webhookId = record.id;
    } catch (error) {
      if (isUniqueViolation(error)) return "duplicate";
      throw error;
    }

    const payment = await this.prisma.payment.findUnique({ where: { reference: parsed.reference } });
    if (!payment) {
      await this.markWebhook(webhookId, null, "Unknown payment reference");
      return "unknown_reference";
    }
    await this.prisma.paymentWebhook.update({ where: { id: webhookId }, data: { paymentId: payment.id } });

    if (
      parsed.status !== "FAILED" &&
      (parsed.amountTzs !== payment.amountTzs || parsed.currency !== payment.currency)
    ) {
      await this.markWebhook(webhookId, payment.id, `Amount or currency mismatch: got ${parsed.amountTzs} ${parsed.currency}`);
      return "amount_mismatch";
    }

    const outcome = await this.applyStatus(payment.id, parsed);
    await this.markWebhook(webhookId, payment.id, null);
    return outcome;
  }

  /**
   * Development only. Simulates the provider callback for a MOCK payment by building a signed
   * webhook and sending it through the same pipeline as a real callback.
   */
  async simulateMockCallback(reference: string, status: "SUCCESS" | "FAILED"): Promise<WebhookOutcome> {
    const payment = await this.prisma.payment.findUnique({ where: { reference }, include: { provider: true } });
    if (!payment) throw AppError.notFound("Payment not found");
    if (payment.provider.code !== "MOCK") throw AppError.badRequest("Only MOCK payments can be simulated");
    const mock = this.providers.get("MOCK") as PaymentProvider & { buildWebhook(fields: Record<string, unknown>): Record<string, unknown> };
    const body = mock.buildWebhook({
      providerTransactionId: payment.providerTransactionId ?? `MOCK-${reference}`,
      reference,
      status,
      amountTzs: payment.amountTzs,
      failureReason: status === "FAILED" ? "Simulated failure" : undefined,
    });
    return this.processWebhook("MOCK", body);
  }

  private async applyStatus(paymentId: string, parsed: NormalizedWebhook): Promise<WebhookOutcome> {
    if (parsed.status === "SUCCESS") {
      return this.prisma.$transaction(async (tx) => {
        // Atomic claim: only one caller can move the payment to SUCCESS, so activation runs once.
        const claim = await tx.payment.updateMany({
          where: { id: paymentId, status: { in: [...CLAIMABLE_FOR_SUCCESS] } },
          data: { status: "SUCCESS", paidAt: this.now(), providerTransactionId: parsed.providerTransactionId, failureReason: null, failedAt: null },
        });
        if (claim.count !== 1) return "already_processed" as const;

        const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { package: true } });
        await activateSubscription(tx, {
          customerId: payment.customerId,
          packageId: payment.packageId,
          durationValue: payment.package.durationValue,
          durationUnit: payment.package.durationUnit,
          sourceType: "PAYMENT",
          paymentId: payment.id,
          now: this.now(),
        });
        await tx.paymentTransaction.create({
          data: { paymentId, operation: "WEBHOOK_SUCCESS", succeeded: true, responseSnapshot: { providerTransactionId: parsed.providerTransactionId } },
        });
        return "activated" as const;
      });
    }

    if (parsed.status === "FAILED") {
      const result = await this.prisma.payment.updateMany({
        where: { id: paymentId, status: { in: ["PENDING", "PROCESSING"] } },
        data: { status: "FAILED", failureReason: parsed.failureReason ?? "Payment failed", failedAt: this.now() },
      });
      return result.count === 1 ? "failed" : "already_processed";
    }

    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: { in: ["PENDING"] } },
      data: { status: "PROCESSING", providerTransactionId: parsed.providerTransactionId },
    });
    return "pending";
  }

  private async markWebhook(id: string, paymentId: string | null, error: string | null): Promise<void> {
    await this.prisma.paymentWebhook.update({
      where: { id },
      data: { paymentId, processedAt: this.now(), processingError: error },
    });
  }
}

function generateReference(): string {
  let suffix = "";
  for (let i = 0; i < 14; i += 1) suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `ZBX${suffix}`; // 17 characters: alphanumeric and within ClickPesa's 20-character limit
}

function mapToPaymentStatus(status: string): "PENDING" | "PROCESSING" | "FAILED" {
  if (status === "FAILED") return "FAILED";
  if (status === "PENDING") return "PENDING";
  return "PROCESSING";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
