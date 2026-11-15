import type { CustomerStatus, Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";

export class CustomersService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(params: { page: number; pageSize: number; search?: string; status?: CustomerStatus }) {
    const where: Prisma.CustomerWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search
        ? { OR: [{ phoneNumber: { contains: params.search.replace(/\D/g, "") || "__none__" } }, { fullName: { contains: params.search, mode: "insensitive" } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { _count: { select: { subscriptions: true, payments: true } } },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return {
      items: rows.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        phoneNumber: c.phoneNumber,
        status: c.status,
        subscriptionCount: c._count.subscriptions,
        paymentCount: c._count.payments,
        createdAt: c.createdAt.toISOString(),
      })),
      page: params.page,
      pageSize: params.pageSize,
      total,
    };
  }

  async detail(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        devices: { orderBy: { lastSeenAt: "desc" }, take: 20 },
        subscriptions: { orderBy: { createdAt: "desc" }, take: 50, include: { package: { select: { name: true } } } },
        payments: { orderBy: { initiatedAt: "desc" }, take: 50, include: { package: { select: { name: true } } } },
        sessions: { where: { status: "ACTIVE" }, take: 20 },
      },
    });
    if (!customer) throw AppError.notFound("Customer not found");
    return {
      id: customer.id,
      fullName: customer.fullName,
      phoneNumber: customer.phoneNumber,
      email: customer.email,
      status: customer.status,
      createdAt: customer.createdAt.toISOString(),
      devices: customer.devices.map((d) => ({ id: d.id, macAddress: d.macAddress, lastIpAddress: d.lastIpAddress, lastSeenAt: d.lastSeenAt?.toISOString() ?? null })),
      subscriptions: customer.subscriptions.map((s) => ({
        id: s.id,
        packageName: s.package.name,
        status: s.status,
        sourceType: s.sourceType,
        startsAt: s.startsAt?.toISOString() ?? null,
        expiresAt: s.expiresAt?.toISOString() ?? null,
      })),
      payments: customer.payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        packageName: p.package.name,
        amountTzs: p.amountTzs,
        status: p.status,
        initiatedAt: p.initiatedAt.toISOString(),
      })),
      activeSessionCount: customer.sessions.length,
    };
  }

  /**
   * Suspending blocks new purchases. Cutting off the network needs the Omada disconnect step,
   * which is not built yet. The UI says so.
   */
  async setStatus(id: string, status: CustomerStatus, actorUserId: string) {
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Customer not found");
    await this.prisma.$transaction([
      this.prisma.customer.update({ where: { id }, data: { status } }),
      this.prisma.auditLog.create({
        data: { actorUserId, action: `customer.${status.toLowerCase()}`, entityType: "Customer", entityId: id, metadata: { from: existing.status, to: status } },
      }),
    ]);
    return this.detail(id);
  }
}
