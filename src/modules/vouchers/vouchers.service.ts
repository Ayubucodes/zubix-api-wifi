import type { PrismaClient, VoucherStatus } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import { decryptSecret, encryptSecret, generateVoucherCode, hashVoucherCode, voucherHint } from "../../common/vault.js";
import { normalizeTanzanianPhone } from "../../utils/phone.js";
import { activateSubscription } from "../subscriptions/subscription.activation.js";

export interface VoucherKeys {
  hmacKey: string;
  encryptionKeyHex: string;
}

export interface CreateBatchInput {
  name: string;
  packageId: string;
  quantity: number;
  usageLimit: number;
  expiresAt?: Date;
}

export class VouchersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly keys: VoucherKeys | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private requireKeys(): VoucherKeys {
    if (!this.keys) {
      throw new AppError(503, "NOT_CONFIGURED", "Voucher keys are not configured. Set VOUCHER_HMAC_KEY and VOUCHER_ENCRYPTION_KEY.");
    }
    return this.keys;
  }

  async createBatch(input: CreateBatchInput, actorUserId: string) {
    const keys = this.requireKeys();
    const pkg = await this.prisma.package.findUnique({ where: { id: input.packageId } });
    if (!pkg || pkg.isArchived) throw AppError.notFound("Package not found");

    const rows = Array.from({ length: input.quantity }, () => {
      const code = generateVoucherCode();
      return {
        packageId: pkg.id,
        codeHash: hashVoucherCode(code, keys.hmacKey),
        codeHint: voucherHint(code),
        codeCiphertext: encryptSecret(code, keys.encryptionKeyHex),
        usageLimit: input.usageLimit,
        expiresAt: input.expiresAt ?? null,
        createdByUserId: actorUserId,
      };
    });

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.voucherBatch.create({
        data: { name: input.name, packageId: pkg.id, quantity: input.quantity, usageLimit: input.usageLimit, expiresAt: input.expiresAt ?? null, createdByUserId: actorUserId },
      });
      await tx.voucher.createMany({ data: rows.map((r) => ({ ...r, batchId: created.id })) });
      await tx.auditLog.create({ data: { actorUserId, action: "voucher.batch_create", entityType: "VoucherBatch", entityId: created.id, metadata: { quantity: input.quantity } } });
      return created;
    });
    return this.batchSummary(batch.id);
  }

  async batchSummary(id: string) {
    const batch = await this.prisma.voucherBatch.findUnique({ where: { id }, include: { package: { select: { name: true, priceTzs: true } } } });
    if (!batch) throw AppError.notFound("Batch not found");
    const [sold, redeemed, revoked] = await Promise.all([
      this.prisma.voucher.count({ where: { batchId: id, soldAt: { not: null } } }),
      this.prisma.voucher.count({ where: { batchId: id, usedCount: { gt: 0 } } }),
      this.prisma.voucher.count({ where: { batchId: id, status: "REVOKED" } }),
    ]);
    return {
      id: batch.id,
      name: batch.name,
      packageName: batch.package.name,
      quantity: batch.quantity,
      usageLimit: batch.usageLimit,
      expiresAt: batch.expiresAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      soldCount: sold,
      redeemedCount: redeemed,
      revokedCount: revoked,
    };
  }

  async listBatches(page: number, pageSize: number) {
    const [ids, total] = await Promise.all([
      this.prisma.voucherBatch.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true } }),
      this.prisma.voucherBatch.count(),
    ]);
    const items = await Promise.all(ids.map((b) => this.batchSummary(b.id)));
    return { items, page, pageSize, total };
  }

  /**
   * Returns decrypted codes for printing. Every reveal is audited, because codes are sellable
   * value. Codes never appear in list responses.
   */
  async batchCodes(batchId: string, actorUserId: string, reason: string) {
    const keys = this.requireKeys();
    const batch = await this.prisma.voucherBatch.findUnique({ where: { id: batchId }, select: { id: true, name: true } });
    if (!batch) throw AppError.notFound("Batch not found");
    const vouchers = await this.prisma.voucher.findMany({
      where: { batchId },
      orderBy: { createdAt: "asc" },
      select: { id: true, codeCiphertext: true, usageLimit: true, expiresAt: true, status: true, package: { select: { name: true, priceTzs: true, durationValue: true, durationUnit: true } } },
    });
    await this.prisma.auditLog.create({ data: { actorUserId, action: "voucher.codes_revealed", entityType: "VoucherBatch", entityId: batchId, metadata: { count: vouchers.length, reason } } });
    return {
      batchName: batch.name,
      items: vouchers.map((v) => ({
        id: v.id,
        code: v.codeCiphertext ? decryptSecret(v.codeCiphertext, keys.encryptionKeyHex) : null,
        packageName: v.package.name,
        priceTzs: v.package.priceTzs,
        durationValue: v.package.durationValue,
        durationUnit: v.package.durationUnit,
        usageLimit: v.usageLimit,
        expiresAt: v.expiresAt?.toISOString() ?? null,
        status: v.status,
      })),
    };
  }

  async list(params: { page: number; pageSize: number; status?: VoucherStatus; batchId?: string; sold?: boolean }) {
    const where = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.batchId ? { batchId: params.batchId } : {}),
      ...(params.sold !== undefined ? { soldAt: params.sold ? { not: null } : null } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.voucher.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        include: { package: { select: { name: true } } },
      }),
      this.prisma.voucher.count({ where }),
    ]);
    return {
      items: rows.map((v) => ({
        id: v.id,
        codeHint: v.codeHint,
        packageName: v.package.name,
        status: v.status,
        usageLimit: v.usageLimit,
        usedCount: v.usedCount,
        expiresAt: v.expiresAt?.toISOString() ?? null,
        soldAt: v.soldAt?.toISOString() ?? null,
        soldChannel: v.soldChannel,
        soldAmountTzs: v.soldAmountTzs,
      })),
      page: params.page,
      pageSize: params.pageSize,
      total,
    };
  }

  async detail(id: string) {
    const v = await this.prisma.voucher.findUnique({
      where: { id },
      include: {
        package: { select: { name: true } },
        redemptions: { orderBy: { redeemedAt: "desc" }, take: 100, include: { customer: { select: { phoneNumber: true } } } },
      },
    });
    if (!v) throw AppError.notFound("Voucher not found");
    return {
      id: v.id,
      codeHint: v.codeHint,
      packageName: v.package.name,
      status: v.status,
      usageLimit: v.usageLimit,
      usedCount: v.usedCount,
      expiresAt: v.expiresAt?.toISOString() ?? null,
      soldAt: v.soldAt?.toISOString() ?? null,
      soldChannel: v.soldChannel,
      soldAmountTzs: v.soldAmountTzs,
      revokedAt: v.revokedAt?.toISOString() ?? null,
      revokedReason: v.revokedReason,
      redemptions: v.redemptions.map((r) => ({
        id: r.id,
        status: r.status,
        customerPhone: r.customer?.phoneNumber ?? null,
        macAddress: r.macAddress,
        failureReason: r.failureReason,
        redeemedAt: r.redeemedAt.toISOString(),
      })),
    };
  }

  /** Records a cash or mobile-money sale. Mobile-money sales are recorded manually here, not through the provider. */
  async recordSale(id: string, channel: "CASH" | "MOBILE_MONEY", amountTzs: number, actorUserId: string) {
    const result = await this.prisma.voucher.updateMany({
      where: { id, soldAt: null, status: "ACTIVE" },
      data: { soldAt: this.now(), soldByUserId: actorUserId, soldChannel: channel, soldAmountTzs: amountTzs },
    });
    if (result.count !== 1) throw AppError.conflict("This voucher is already sold, revoked, or not available");
    await this.prisma.auditLog.create({ data: { actorUserId, action: "voucher.sold", entityType: "Voucher", entityId: id, metadata: { channel, amountTzs } } });
    return this.detail(id);
  }

  async revoke(id: string, reason: string, actorUserId: string) {
    const v = await this.prisma.voucher.findUnique({ where: { id } });
    if (!v) throw AppError.notFound("Voucher not found");
    if (v.status === "REVOKED") throw AppError.conflict("Voucher is already revoked");
    await this.prisma.$transaction([
      this.prisma.voucher.update({ where: { id }, data: { status: "REVOKED", revokedAt: this.now(), revokedReason: reason } }),
      this.prisma.auditLog.create({ data: { actorUserId, action: "voucher.revoke", entityType: "Voucher", entityId: id, metadata: { reason } } }),
    ]);
    return this.detail(id);
  }

  /**
   * Redeems a voucher for a phone number. Concurrency: the usage counter is claimed with a
   * conditional update, so two simultaneous redemptions of a single-use voucher cannot both succeed.
   * Activation runs in the same transaction, so a failure rolls back the claim.
   */
  async redeem(codeInput: string, phoneInput: string) {
    const keys = this.requireKeys();
    const phone = normalizeTanzanianPhone(phoneInput);
    if (!phone) throw AppError.badRequest("Enter a valid Tanzanian mobile number");

    const codeHash = hashVoucherCode(codeInput, keys.hmacKey);
    const voucher = await this.prisma.voucher.findUnique({ where: { codeHash }, include: { package: true } });
    const invalid = () => AppError.notFound("Voucher code not found or not valid");
    if (!voucher) throw invalid();
    if (voucher.status !== "ACTIVE") throw AppError.conflict(voucherStatusMessage(voucher.status));
    const now = this.now();
    if (voucher.expiresAt && voucher.expiresAt.getTime() <= now.getTime()) {
      throw AppError.conflict("This voucher has expired");
    }
    if (!voucher.soldAt) throw AppError.conflict("This voucher has not been paid for yet. Please buy it from the cashier.");

    const customer = await this.prisma.customer.upsert({ where: { phoneNumber: phone }, update: {}, create: { phoneNumber: phone } });
    if (customer.status !== "ACTIVE") throw AppError.forbidden("This account cannot redeem vouchers. Contact support.");

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.voucher.updateMany({
        where: { id: voucher.id, status: "ACTIVE", usedCount: { lt: voucher.usageLimit } },
        data: { usedCount: { increment: 1 } },
      });
      if (claim.count !== 1) throw AppError.conflict("This voucher has already been fully used");

      await tx.voucher.updateMany({
        where: { id: voucher.id, status: "ACTIVE", usedCount: { gte: voucher.usageLimit } },
        data: { status: "EXHAUSTED" },
      });

      const { subscription } = await activateSubscription(tx, {
        customerId: customer.id,
        packageId: voucher.packageId,
        durationValue: voucher.package.durationValue,
        durationUnit: voucher.package.durationUnit,
        sourceType: "VOUCHER",
        voucherId: voucher.id,
        now,
      });

      await tx.voucherRedemption.create({
        data: { voucherId: voucher.id, customerId: customer.id, macAddress: "PENDING", status: "SUCCEEDED" },
      });

      return {
        subscriptionId: subscription.id,
        packageName: voucher.package.name,
        expiresAt: subscription.expiresAt?.toISOString() ?? null,
        customerPhone: phone,
      };
    });
  }
}

function voucherStatusMessage(status: VoucherStatus): string {
  switch (status) {
    case "REVOKED":
      return "This voucher has been cancelled";
    case "EXPIRED":
      return "This voucher has expired";
    case "EXHAUSTED":
      return "This voucher has already been fully used";
    default:
      return "This voucher is not available";
  }
}
