import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { PaymentProvider } from "../src/integrations/payments/payment.types.js";
import { PaymentsService } from "../src/modules/payments/payments.service.js";

describe("PaymentsService", () => {
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
