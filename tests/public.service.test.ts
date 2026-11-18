import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { OmadaClient, OmadaError } from "../src/integrations/omada/omada.client.js";
import { PublicService } from "../src/modules/public/public.service.js";

describe("PublicService Omada authorization", () => {
  it("records a safe diagnostic when authorization fails without a mapped site", async () => {
    const subscription = {
      id: "subscription-id",
      customerId: "customer-id",
      packageId: "package-id",
      locationId: "location-id",
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      package: { maxDevices: 1, dataLimitMb: null, downloadKbps: null, uploadKbps: null },
    };
    const transaction = {
      customerDevice: { upsert: vi.fn().mockResolvedValue({ id: "device-id" }) },
      subscriptionDevice: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const networkEventCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      subscription: { findUnique: vi.fn().mockResolvedValue(subscription) },
      $transaction: vi.fn((callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(transaction as unknown as Prisma.TransactionClient),
      ),
      networkSite: { findFirst: vi.fn().mockResolvedValue(null) },
      networkEvent: { create: networkEventCreate },
    } as unknown as PrismaClient;
    const omada = {
      authorizeClient: vi.fn().mockRejectedValue(new OmadaError("not found", { retryable: false, status: 404 })),
    };
    const service = new PublicService(prisma, () => omada as unknown as OmadaClient);

    await expect(
      service.connect({
        subscriptionId: subscription.id,
        clientMac: "AA:BB:CC:DD:EE:01",
        clientIp: "192.168.1.25",
        apMac: "AA:BB:CC:DD:EE:02",
        ssidName: "Guest Wi-Fi",
        radioId: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "We could not connect your device. Try again, or ask staff for help.",
    });

    expect(networkEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "OMADA_AUTHORIZATION_FAILED",
        severity: "ERROR",
        message: "Omada returned HTTP 404; no active network site is mapped to this pass's location.",
        metadata: {
          controllerStatus: 404,
          controllerErrorCode: null,
          networkSiteConfigured: false,
        },
      }),
    });
  });
});
