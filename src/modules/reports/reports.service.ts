import type { PrismaClient } from "@prisma/client";
import { businessDateKey } from "../../common/time.js";

export interface DateRange {
  from: Date;
  to: Date; // exclusive
}

export class ReportsService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Successful payments in range, grouped by business day and by package. Amounts are integer TZS. */
  async revenue(range: DateRange) {
    const payments = await this.prisma.payment.findMany({
      where: { status: "SUCCESS", paidAt: { gte: range.from, lt: range.to } },
      select: { amountTzs: true, paidAt: true, package: { select: { id: true, name: true } } },
    });
    const byDay = new Map<string, { day: string; revenueTzs: number; count: number }>();
    const byPackage = new Map<string, { packageId: string; packageName: string; revenueTzs: number; count: number }>();
    let total = 0;
    for (const p of payments) {
      const amount = p.amountTzs;
      total += amount;
      const day = businessDateKey(p.paidAt ?? range.from);
      const d = byDay.get(day) ?? { day, revenueTzs: 0, count: 0 };
      d.revenueTzs += amount;
      d.count += 1;
      byDay.set(day, d);
      const k = byPackage.get(p.package.id) ?? { packageId: p.package.id, packageName: p.package.name, revenueTzs: 0, count: 0 };
      k.revenueTzs += amount;
      k.count += 1;
      byPackage.set(p.package.id, k);
    }
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      totalRevenueTzs: total,
      paymentCount: payments.length,
      byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      byPackage: [...byPackage.values()].sort((a, b) => b.revenueTzs - a.revenueTzs),
    };
  }

  /** Voucher sales (cash or mobile money) in range. */
  async voucherSales(range: DateRange) {
    const vouchers = await this.prisma.voucher.findMany({
      where: { soldAt: { gte: range.from, lt: range.to } },
      select: { soldChannel: true, soldAmountTzs: true, soldAt: true, package: { select: { name: true } } },
    });
    const byChannel: Record<string, { count: number; amountTzs: number }> = {};
    let total = 0;
    for (const v of vouchers) {
      const channel = v.soldChannel ?? "UNKNOWN";
      byChannel[channel] ??= { count: 0, amountTzs: 0 };
      byChannel[channel].count += 1;
      byChannel[channel].amountTzs += v.soldAmountTzs ?? 0;
      total += v.soldAmountTzs ?? 0;
    }
    return { range: { from: range.from.toISOString(), to: range.to.toISOString() }, soldCount: vouchers.length, totalTzs: total, byChannel };
  }

  /** New customers per business day in range. */
  async customerGrowth(range: DateRange) {
    const customers = await this.prisma.customer.findMany({
      where: { createdAt: { gte: range.from, lt: range.to } },
      select: { createdAt: true },
    });
    const byDay = new Map<string, number>();
    for (const c of customers) {
      const day = businessDateKey(c.createdAt);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      newCustomers: customers.length,
      byDay: [...byDay.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
    };
  }

  /** Flat CSV of payments in range, for the accountant. Phone numbers are masked. */
  async paymentsCsv(range: DateRange): Promise<string> {
    const payments = await this.prisma.payment.findMany({
      where: { paidAt: { gte: range.from, lt: range.to }, status: "SUCCESS" },
      orderBy: { paidAt: "asc" },
      select: { reference: true, paidAt: true, amountTzs: true, currency: true, phoneNumber: true, provider: { select: { code: true } }, package: { select: { name: true } } },
    });
    const header = "reference,paid_at,amount_tzs,currency,provider,package,phone";
    const rows = payments.map((p) =>
      [
        p.reference,
        p.paidAt?.toISOString() ?? "",
        p.amountTzs,
        p.currency,
        p.provider.code,
        csvCell(p.package.name),
        maskPhone(p.phoneNumber),
      ].join(","),
    );
    return [header, ...rows].join("\n") + "\n";
  }
}

export function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 6) return "****";
  return `${phone.slice(0, 5)}${"*".repeat(phone.length - 8)}${phone.slice(-3)}`;
}
