import type { PrismaClient, SubscriptionStatus } from "@prisma/client";
import { AppError } from "../../common/errors.js";

export class SubscriptionsService {
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {}

  async list(params: { page: number; pageSize: number; status?: SubscriptionStatus }) {
    const where = params.status ? { status: params.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { customer: { select: { phoneNumber: true, fullName: true } }, package: { select: { name: true } }, location: { select: { name: true } } },
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        customerPhone: s.customer.phoneNumber,
        customerName: s.customer.fullName,
        packageName: s.package.name,
        locationName: s.location.name,
        sourceType: s.sourceType,
        status: s.status,
        startsAt: s.startsAt?.toISOString() ?? null,
        expiresAt: s.expiresAt?.toISOString() ?? null,
      })),
      page: params.page,
      pageSize: params.pageSize,
      total,
    };
  }

  async detail(id: string) {
    const s = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, phoneNumber: true, fullName: true } },
        package: { select: { name: true, dataLimitMb: true, maxDevices: true } },
        location: { select: { name: true } },
        history: { orderBy: { createdAt: "desc" }, take: 50 },
        devices: { include: { device: true } },
        authorizations: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!s) throw AppError.notFound("Subscription not found");
    return {
      id: s.id,
      customer: s.customer,
      packageName: s.package.name,
      dataLimitMb: s.package.dataLimitMb,
      maxDevices: s.package.maxDevices,
      locationName: s.location.name,
      sourceType: s.sourceType,
      status: s.status,
      startsAt: s.startsAt?.toISOString() ?? null,
      expiresAt: s.expiresAt?.toISOString() ?? null,
      history: s.history.map((h) => ({ from: h.fromStatus, to: h.toStatus, reason: h.reason, at: h.createdAt.toISOString() })),
      devices: s.devices.map((d) => ({ macAddress: d.device.macAddress, addedAt: d.addedAt.toISOString(), removedAt: d.removedAt?.toISOString() ?? null })),
      authorizations: s.authorizations.map((a) => ({ macAddress: a.macAddress, status: a.status, lastError: a.lastError, authorizedAt: a.authorizedAt?.toISOString() ?? null })),
    };
  }

  /** Administrative cancel. Time is removed, and the change is recorded in history and the audit log. */
  async cancel(id: string, reason: string, actorUserId: string) {
    const s = await this.prisma.subscription.findUnique({ where: { id } });
    if (!s) throw AppError.notFound("Subscription not found");
    if (s.status === "CANCELLED" || s.status === "EXPIRED") throw AppError.conflict("This subscription has already ended");
    const now = this.now();
    await this.prisma.$transaction([
      this.prisma.subscription.update({ where: { id }, data: { status: "CANCELLED", expiresAt: now } }),
      this.prisma.subscriptionHistory.create({ data: { subscriptionId: id, fromStatus: s.status, toStatus: "CANCELLED", reason, actorUserId } }),
      this.prisma.auditLog.create({ data: { actorUserId, action: "subscription.cancel", entityType: "Subscription", entityId: id, metadata: { reason } } }),
    ]);
    return this.detail(id);
  }
}
