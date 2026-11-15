import type { PrismaClient } from "@prisma/client";
import { addDays, businessDateKey, startOfBusinessDay, startOfBusinessMonth } from "../../common/time.js";

export interface RevenuePoint {
  date: string;
  amountTzs: number;
  payments: number;
}

export interface DashboardOverview {
  generatedAt: string;
  timezone: string;
  revenue: { totalTzs: number; todayTzs: number; weekTzs: number; monthTzs: number };
  counts: {
    customers: number;
    activeSubscriptions: number;
    expiredSubscriptions: number;
    activeSessions: number;
    pendingPayments: number;
    vouchersSold: number;
    accessPointsOnline: number;
    accessPointsOffline: number;
  };
  revenueLast7Days: RevenuePoint[];
}

export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async overview(now: Date = new Date()): Promise<DashboardOverview> {
    const todayStart = startOfBusinessDay(now);
    const weekStart = addDays(todayStart, -6);
    const monthStartDate = startOfBusinessMonth(now);

    const successful = { status: "SUCCESS" as const };

    const [
      total,
      today,
      week,
      month,
      customers,
      activeSubscriptions,
      expiredSubscriptions,
      activeSessions,
      pendingPayments,
      vouchersSold,
      accessPointsOnline,
      accessPointsOffline,
      recentPayments,
    ] = await Promise.all([
      this.prisma.payment.aggregate({ where: successful, _sum: { amountTzs: true } }),
      this.prisma.payment.aggregate({ where: { ...successful, paidAt: { gte: todayStart } }, _sum: { amountTzs: true } }),
      this.prisma.payment.aggregate({ where: { ...successful, paidAt: { gte: weekStart } }, _sum: { amountTzs: true } }),
      this.prisma.payment.aggregate({ where: { ...successful, paidAt: { gte: monthStartDate } }, _sum: { amountTzs: true } }),
      this.prisma.customer.count(),
      this.prisma.subscription.count({ where: { status: "ACTIVE" } }),
      this.prisma.subscription.count({ where: { status: "EXPIRED" } }),
      this.prisma.wifiSession.count({ where: { status: "ACTIVE" } }),
      this.prisma.payment.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      this.prisma.voucher.count({ where: { soldAt: { not: null } } }),
      this.prisma.accessPoint.count({ where: { status: "ONLINE" } }),
      this.prisma.accessPoint.count({ where: { status: "OFFLINE" } }),
      this.prisma.payment.findMany({
        where: { ...successful, paidAt: { gte: weekStart } },
        select: { amountTzs: true, paidAt: true },
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      timezone: "Africa/Dar_es_Salaam",
      revenue: {
        totalTzs: total._sum.amountTzs ?? 0,
        todayTzs: today._sum.amountTzs ?? 0,
        weekTzs: week._sum.amountTzs ?? 0,
        monthTzs: month._sum.amountTzs ?? 0,
      },
      counts: {
        customers,
        activeSubscriptions,
        expiredSubscriptions,
        activeSessions,
        pendingPayments,
        vouchersSold,
        accessPointsOnline,
        accessPointsOffline,
      },
      revenueLast7Days: buildRevenueSeries(recentPayments, weekStart),
    };
  }
}

function buildRevenueSeries(
  payments: Array<{ amountTzs: number; paidAt: Date | null }>,
  weekStart: Date,
): RevenuePoint[] {
  const series: RevenuePoint[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = businessDateKey(addDays(weekStart, offset));
    series.push({ date: day, amountTzs: 0, payments: 0 });
  }
  const index = new Map(series.map((point, i) => [point.date, i]));
  for (const payment of payments) {
    if (!payment.paidAt) continue;
    const i = index.get(businessDateKey(payment.paidAt));
    if (i === undefined) continue;
    const point = series[i];
    if (point) {
      point.amountTzs += payment.amountTzs;
      point.payments += 1;
    }
  }
  return series;
}
