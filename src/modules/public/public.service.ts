import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import { OmadaError, type OmadaClient } from "../../integrations/omada/omada.client.js";

export interface ConnectInput {
  subscriptionId: string;
  clientMac: string;
  clientIp: string;
  apMac: string;
  ssidName: string;
  radioId: 0 | 1;
}

export type ConnectResult =
  | { status: "AUTHORIZED"; expiresAt: string }
  | { status: "NOT_CONFIGURED" };

const MAC_PATTERN = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;

export class PublicService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly omadaFactory: (() => OmadaClient) | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Packages a customer can buy. Archived and inactive packages are never listed. */
  async listPackages() {
    const rows = await this.prisma.package.findMany({
      where: { isActive: true, isArchived: false },
      orderBy: [{ priceTzs: "asc" }],
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      durationValue: p.durationValue,
      durationUnit: p.durationUnit,
      priceTzs: p.priceTzs,
      dataLimitMb: p.dataLimitMb,
      downloadKbps: p.downloadKbps,
      uploadKbps: p.uploadKbps,
      maxDevices: p.maxDevices,
    }));
  }

  /** Providers that are switched on AND have credentials on the server. */
  async enabledProviders(registered: ReadonlySet<string>) {
    const rows = await this.prisma.paymentProvider.findMany({ where: { isEnabled: true }, orderBy: { code: "asc" } });
    return rows.filter((p) => registered.has(p.code)).map((p) => ({ code: p.code, name: p.name }));
  }

  /**
   * Lets a device onto the network after a payment or voucher. The subscription id is the proof:
   * it is only handed to the person who paid or redeemed. The pass's device limit is enforced here.
   */
  async connect(input: ConnectInput): Promise<ConnectResult> {
    if (!MAC_PATTERN.test(input.clientMac) || !MAC_PATTERN.test(input.apMac)) {
      throw AppError.badRequest("This page was not opened from the Wi-Fi sign-in screen. Reconnect to the Wi-Fi and try again.");
    }
    if (!this.omadaFactory) return { status: "NOT_CONFIGURED" };

    const now = this.now();
    const sub = await this.prisma.subscription.findUnique({ where: { id: input.subscriptionId }, include: { package: true } });
    if (!sub) throw AppError.notFound("Pass not found");
    if (sub.status !== "ACTIVE" || !sub.expiresAt || sub.expiresAt.getTime() <= now.getTime()) {
      throw AppError.conflict("This pass is no longer active");
    }

    const mac = input.clientMac.toUpperCase().replace(/-/g, ":");
    await this.prisma.$transaction(async (tx) => {
      const device = await tx.customerDevice.upsert({
        where: { macAddress: mac },
        update: { customerId: sub.customerId, lastIpAddress: input.clientIp, lastSeenAt: now },
        create: { macAddress: mac, customerId: sub.customerId, lastIpAddress: input.clientIp, lastSeenAt: now },
      });
      const link = await tx.subscriptionDevice.findUnique({
        where: { subscriptionId_customerDeviceId: { subscriptionId: sub.id, customerDeviceId: device.id } },
      });
      if (link) {
        if (link.removedAt) await tx.subscriptionDevice.update({ where: { id: link.id }, data: { removedAt: null } });
        return;
      }
      const inUse = await tx.subscriptionDevice.count({ where: { subscriptionId: sub.id, removedAt: null } });
      if (inUse >= sub.package.maxDevices) {
        throw AppError.conflict(`This pass allows ${sub.package.maxDevices} device${sub.package.maxDevices === 1 ? "" : "s"}. Ask staff to move it to this one.`);
      }
      await tx.subscriptionDevice.create({ data: { subscriptionId: sub.id, customerDeviceId: device.id } });
    });

    const site = await this.prisma.networkSite.findFirst({ where: { locationId: sub.locationId, isActive: true }, select: { id: true } });
    const record = async (status: "AUTHORIZED" | "FAILED", lastError: string | null) => {
      if (!site) return;
      await this.prisma.networkAuthorization.create({
        data: {
          subscriptionId: sub.id,
          networkSiteId: site.id,
          macAddress: mac,
          status,
          attemptCount: 1,
          lastError,
          authorizedAt: status === "AUTHORIZED" ? now : null,
        },
      });
    };

    try {
      await this.omadaFactory().authorizeClient({
        clientMac: input.clientMac.toUpperCase(),
        clientIp: input.clientIp,
        time: sub.expiresAt.getTime() - now.getTime(),
        apMac: input.apMac.toUpperCase(),
        ssidName: input.ssidName,
        radioId: input.radioId,
        totalTrafficLimitBytes: sub.package.dataLimitMb ? sub.package.dataLimitMb * 1024 * 1024 : undefined,
        downloadRateLimitKbps: sub.package.downloadKbps ?? undefined,
        uploadRateLimitKbps: sub.package.uploadKbps ?? undefined,
      });
    } catch (error) {
      const detail = getOmadaFailureDetail(error);
      await record("FAILED", detail);
      await this.prisma.networkEvent.create({
        data: {
          networkSiteId: site?.id ?? null,
          type: "OMADA_AUTHORIZATION_FAILED",
          severity: "ERROR",
          message: site
            ? detail
            : `${detail}. This attempt could not be linked to a Zubix network site because none is mapped to the pass's location.`,
          metadata: {
            controllerStatus: error instanceof OmadaError ? error.status ?? null : null,
            controllerErrorCode: error instanceof OmadaError ? error.controllerErrorCode ?? null : null,
            networkSiteConfigured: Boolean(site),
          },
        },
      });
      throw AppError.badGateway("We could not connect your device. Try again, or ask staff for help.");
    }
    await record("AUTHORIZED", null);
    return { status: "AUTHORIZED", expiresAt: sub.expiresAt.toISOString() };
  }
}

function getOmadaFailureDetail(error: unknown): string {
  if (!(error instanceof OmadaError)) return "Omada controller unreachable";
  if (error.controllerErrorCode !== undefined) {
    return `Omada rejected the request (controller error ${error.controllerErrorCode})`;
  }
  if (error.status !== undefined) return `Omada returned HTTP ${error.status}`;
  return "Omada request failed before receiving a controller response";
}
