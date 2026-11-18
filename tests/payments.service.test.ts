import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { PaymentProvider } from "../src/integrations/payments/payment.types.js";
import { PaymentsService } from "../src/modules/payments/payments.service.js";

describe("PaymentsService", () => {
  it("reconciles a confirmed ClickPesa payment and activates the subscription once", async () => {
    const payment = {
      id: "payment-id",
      reference: "ZBXTEST1234567890",
      amountTzs: 500,
      currency: "TZS",
      phoneNumber: "255712345678",
      status: "PROCESSING",
      failureReason: null,
      providerTransactionId: "TX1",
      initiatedAt: new Date("2026-01-01T00:00:00.000Z"),
      paidAt: null,
      failedAt: null,
      customerId: "customer-id",
      packageId: "package-id",
      package: { name: "1 Day", durationValue: 1, durationUnit: "DAY" },
      provider: { code: "CLICKPESA", name: "ClickPesa" },
    };
    const tx = {
      payment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(payment),
      },
      packageLocation: { findFirst: vi.fn().mockResolvedValue({ locationId: "location-id" }) },
      location: { findFirst: vi.fn() },
      subscription: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "subscription-id" }),
      },
      subscriptionHistory: { create: vi.fn().mockResolvedValue({}) },
      paymentTransaction: { create: vi.fn().mockResolvedValue({}) },
    };
    const paidPayment = { ...payment, status: "SUCCESS", paidAt: new Date("2026-01-01T00:01:00.000Z") };
    const prisma = {
      payment: {
        findUnique: vi.fn().mockResolvedValueOnce(payment).mockResolvedValueOnce(paidPayment),
      },
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaClient;
    const clickPesa: PaymentProvider = {
      code: "CLICKPESA",
      initiatePayment: vi.fn(),
      queryPaymentStatus: vi.fn().mockResolvedValue({
        reference: payment.reference,
        providerTransactionId: "TX1",
        status: "SUCCESS",
        amountTzs: 500,
        currency: "TZS",
      }),
      verifyWebhook: vi.fn().mockReturnValue(false),
      parseWebhook: vi.fn().mockReturnValue(null),
    };
    const service = new PaymentsService(prisma, new Map([["CLICKPESA", clickPesa]]));

    await expect(service.getCurrentByReference(payment.reference)).resolves.toMatchObject({
      reference: payment.reference,
      status: "SUCCESS",
    });
    expect(clickPesa.queryPaymentStatus).toHaveBeenCalledWith(payment.reference);
    expect(tx.subscription.create).toHaveBeenCalledTimes(1);
  });

  it("does not activate a ClickPesa payment when the queried amount does not match", async () => {
    const payment = {
      id: "payment-id",
      reference: "ZBXTEST1234567890",
      amountTzs: 500,
      currency: "TZS",
      status: "PROCESSING",
      provider: { code: "CLICKPESA", name: "ClickPesa" },
    };
    const prisma = {
      payment: { findUnique: vi.fn().mockResolvedValue(payment), updateMany: vi.fn() },
      paymentTransaction: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;
    const clickPesa: PaymentProvider = {
      code: "CLICKPESA",
      initiatePayment: vi.fn(),
      queryPaymentStatus: vi.fn().mockResolvedValue({
        reference: payment.reference,
        providerTransactionId: "TX1",
        status: "SUCCESS",
        amountTzs: 5_000,
        currency: "TZS",
      }),
      verifyWebhook: vi.fn().mockReturnValue(false),
      parseWebhook: vi.fn().mockReturnValue(null),
    };
    const service = new PaymentsService(prisma, new Map([["CLICKPESA", clickPesa]]));

    await expect(service.getCurrentByReference(payment.reference)).rejects.toMatchObject({
      statusCode: 409,
      message: "ClickPesa payment details did not match this order. Contact support.",
    });
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it("returns an actionable error when ClickPesa rejects a low wallet balance", async () => {
    const reference = "ZBXTEST1234567890";
    const prisma = {
      package: {
        findUnique: vi.fn().mockResolvedValue({
          id: "package-id",
          priceTzs: 500,
          isActive: true,
          isArchived: false,
        }),
      },
      paymentProvider: {
        findUnique: vi.fn().mockResolvedValue({ id: "provider-id", isEnabled: true }),
      },
      customer: {
        upsert: vi.fn().mockResolvedValue({ id: "customer-id", status: "ACTIVE" }),
      },
      payment: {
        create: vi.fn().mockResolvedValue({ id: "payment-id", reference }),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentTransaction: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const clickPesa: PaymentProvider = {
      code: "CLICKPESA",
      initiatePayment: vi.fn().mockRejectedValue(
        new Error("ClickPesa rejected the USSD push request (HTTP 400): Insufficient funds in your Halopesa account."),
      ),
      verifyWebhook: vi.fn().mockReturnValue(false),
      parseWebhook: vi.fn().mockReturnValue(null),
    };
    const service = new PaymentsService(prisma, new Map([["CLICKPESA", clickPesa]]));

    await expect(
      service.initiate({
        packageId: "package-id",
        phoneNumber: "0712345678",
        providerCode: "CLICKPESA",
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "UPSTREAM_ERROR",
      message: "The mobile-money wallet for this phone number appears to have insufficient funds. Top it up or try another number.",
      details: { reference },
    });
  });

  it("keeps other ClickPesa initiation errors generic to customers", async () => {
    const prisma = {
      package: {
        findUnique: vi.fn().mockResolvedValue({
          id: "package-id",
          priceTzs: 500,
          isActive: true,
          isArchived: false,
        }),
      },
      paymentProvider: {
        findUnique: vi.fn().mockResolvedValue({ id: "provider-id", isEnabled: true }),
      },
      customer: {
        upsert: vi.fn().mockResolvedValue({ id: "customer-id", status: "ACTIVE" }),
      },
      payment: {
        create: vi.fn().mockResolvedValue({ id: "payment-id", reference: "ZBXTEST1234567890" }),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentTransaction: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const clickPesa: PaymentProvider = {
      code: "CLICKPESA",
      initiatePayment: vi.fn().mockRejectedValue(new Error("invalid credential")),
      verifyWebhook: vi.fn().mockReturnValue(false),
      parseWebhook: vi.fn().mockReturnValue(null),
    };
    const service = new PaymentsService(prisma, new Map([["CLICKPESA", clickPesa]]));

    await expect(
      service.initiate({
        packageId: "package-id",
        phoneNumber: "0712345678",
        providerCode: "CLICKPESA",
      }),
    ).rejects.toMatchObject({
      name: "AppError",
      message: "The payment provider could not start the payment. Please try again.",
    });
  });
});
