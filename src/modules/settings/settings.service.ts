import type { PaymentProviderCode, PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";

export interface SettingsContext {
  appEnv: string;
  registeredProviders: ReadonlySet<string>;
}

export class SettingsService {
  constructor(private readonly prisma: PrismaClient, private readonly ctx: SettingsContext) {}

  async listProviders() {
    const rows = await this.prisma.paymentProvider.findMany({ orderBy: { code: "asc" } });
    return rows.map((p) => ({
      code: p.code,
      name: p.name,
      isEnabled: p.isEnabled,
      isRegistered: this.ctx.registeredProviders.has(p.code),
      isMockInProduction: p.code === "MOCK" && this.ctx.appEnv === "production",
    }));
  }

  /**
   * Enabling needs a registered adapter, so a provider with no credentials cannot be switched on.
   * MOCK can never be enabled in production.
   */
  async setProviderEnabled(code: PaymentProviderCode, enabled: boolean, actorUserId: string) {
    if (enabled) {
      if (code === "MOCK" && this.ctx.appEnv === "production") {
        throw AppError.forbidden("The mock payment provider cannot be enabled in production");
      }
      if (!this.ctx.registeredProviders.has(code)) {
        throw AppError.conflict(`${code} is not configured. Add its credentials to the environment first.`);
      }
    }
    const row = await this.prisma.paymentProvider.findUnique({ where: { code } });
    if (!row) throw AppError.notFound("Provider not found");
    await this.prisma.$transaction([
      this.prisma.paymentProvider.update({ where: { code }, data: { isEnabled: enabled } }),
      this.prisma.auditLog.create({
        data: { actorUserId, action: enabled ? "payment_provider.enable" : "payment_provider.disable", entityType: "PaymentProvider", entityId: row.id, metadata: { code } },
      }),
    ]);
    return { code, isEnabled: enabled };
  }

  async auditLog(params: { page: number; pageSize: number; entityType?: string }) {
    const where = params.entityType ? { entityType: params.entityType } : {};
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { actor: { select: { email: true, fullName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        actor: r.actor ? { email: r.actor.email, name: r.actor.fullName } : null,
        createdAt: r.createdAt.toISOString(),
      })),
      page: params.page,
      pageSize: params.pageSize,
      total,
    };
  }
}
